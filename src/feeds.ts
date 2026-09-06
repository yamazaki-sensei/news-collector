/**
 * 収集対象のRSS/Atomフィード。
 *
 * 追加するときは URL が生きているか先に確かめること:
 *   curl -sIL -o /dev/null -w '%{http_code} %{content_type}\n' <URL>
 * 200 かつ content-type が xml 系でないと、フィードではなくHTMLページを掴んでいる。
 *
 * 選定の方針:
 * - 公式ブログだけを並べると、更新頻度の高い企業ブログ（GitHub Changelog / Vercel）ばかりが
 *   毎日ヒットし、React や Vue のような「たまにしか書かない」ソースが埋もれる。
 *   そのため release（GitHub の releases.atom）と newsletter（週刊まとめ）を足して、
 *   静かな日でも「今どのライブラリが動いているか」が拾えるようにしている。
 * - 多産なフィードには maxItems / exclude を個別に設定して、1社で埋まるのを防ぐ。
 */

export type Category =
  | "release"
  | "framework"
  | "runtime"
  | "tooling"
  | "platform"
  | "newsletter"
  | "community";

/**
 * ダイジェスト内での表示順とラベル。Claude 側のプロンプトもこの並びを前提にしている。
 * 「対応が要るもの」から「読み物」の順に並べている。
 */
export const CATEGORY_LABELS: Record<Category, string> = {
  release: "📦 Release",
  framework: "⚙️ Framework",
  runtime: "🧩 Runtime / Language",
  tooling: "🔧 Tooling",
  platform: "🌐 Web Platform",
  newsletter: "📬 Weekly / Curation",
  community: "✍️ Community",
};

export type Feed = {
  name: string;
  url: string;
  category: Category;
  /**
   * タイトルまたはURLがどれかにマッチした記事を捨てる。
   * 投稿量が多く、その大半が読者（フロントエンドエンジニア）と無関係なフィード用。
   * 判断が微妙なものはここで落とさず、Claude 側の選定に任せる。
   */
  exclude?: readonly RegExp[];
  /** このフィードから1回に採用する上限。省略時は fetch.ts の MAX_ITEMS_PER_FEED。 */
  maxItems?: number;
};

/**
 * Vercel は1日10件以上出すが、実測ではその7割がフロントエンドの開発者向けではない。
 * プラットフォーム側の変更（ランタイム・CDN・ビルド・CLI・セキュリティ・非推奨化）
 * だけを残し、以下は捨てる。
 *
 * 追加・調整するときは実行ログの「除外 N 件」と state/seen.json を突き合わせること。
 */
const VERCEL_EXCLUDE: readonly RegExp[] = [
  // AI Gateway のモデル追加・値下げ、エージェント/AI SDK 関連。最も件数が多い。
  /ai[- ]gateway|\bllm\b|\bai[- ]sdk\b|agents?\b|harness|\bmodels?\b/i,
  /deepseek|grok|gemini|gpt-|claude|glm-|minimax|wan-|fish[- ]audio/i,
  // マーケットプレイス・他社サービス連携。使っていなければ関係がない。
  /marketplace|vercel[- ]connect|chat[- ]sdk|\bslack\b|notion|instagram|xchat/i,
  /algolia|snowflake|cursor|cline|\bv0\b/i,
  // 期間限定の値下げ・無料化などの販促。
  /\d+[- ]?(?:%|percent)[- ]?off|\bfree\b|\bpricing\b/i,
  // Enterprise 契約・組織管理まわり。個人やチームの日常の開発には効かない。
  /enterprise|compliance|\bsso\b|\bsaml\b|audit[- ]log|managed[- ]users|team[- ]settings|onboarding/i,
  // 自社PR・採用・顧客事例。
  /intern|hiring|careers|challenge|hackable|inside[- ]the[- ]vercel|how[- ]we[- ]|how[- ]\w+[- ](?:uses|benchmarks|authenticates)/i,
];

/**
 * releases.atom のプレリリース。Angular の -next、Electron の nightly、
 * Next.js の canary は毎日切られるので、release カテゴリからは落とす。
 *
 * exclude は「タイトル + URL」に対して当てるので、バージョン部分だけを見るために
 * タグの URL に錨を打っている。素の `-dev\b` などにすると、リポジトリ名
 * （vitest-dev/vitest、web-infra-dev/rspack）に当たって全部落ちてしまう。
 */
const PRERELEASE =
  /\/releases\/tag\/\S*-(?:canary|alpha|beta|rc|next|nightly|experimental|preview|pre|dev|insiders)\b/i;

/**
 * GitHub の releases.atom は「リリースそのものが告知」なライブラリ向け。2件までに抑える。
 *
 * monorepo のリポジトリは周辺パッケージのリリースも同じフィードに流れてきて、
 * 本体のリリースを押し出す（Angular の zone.js、Vite の create-vite など）。
 * noise はタイトルの先頭に錨を打って落とす。
 */
function release(name: string, repo: string, ...noise: RegExp[]): Feed {
  return {
    name,
    url: `https://github.com/${repo}/releases.atom`,
    category: "release",
    maxItems: 2,
    exclude: [PRERELEASE, ...noise],
  };
}

export const FEEDS: readonly Feed[] = [
  // --- Release（GitHub の releases.atom。ブログを持たない / ブログはメジャーしか書かないもの） ---
  release("React", "facebook/react"),
  release("Vue", "vuejs/core"),
  release("Angular", "angular/angular", /^zone\.js-/),
  release("Nuxt", "nuxt/nuxt"),
  release("SvelteKit", "sveltejs/kit", /^@sveltejs\/adapter-/),
  release("Astro", "withastro/astro", /^@astrojs\//),
  release("React Router", "remix-run/react-router"),
  // 「latest」という移動タグを毎回打つので、それだけ落とす。
  release("React Native", "facebook/react-native", /\/releases\/tag\/latest$/),
  release("Electron", "electron/electron"),
  release("Vite", "vitejs/vite", /^create-vite@/),
  release("Rspack", "web-infra-dev/rspack", /^crates@/),
  release("Vitest", "vitest-dev/vitest"),
  release("Playwright", "microsoft/playwright"),
  release("Storybook", "storybookjs/storybook"),
  release("Biome", "biomejs/biome"),
  release("pnpm", "pnpm/pnpm"),
  release("Tailwind CSS", "tailwindlabs/tailwindcss"),
  release("Zod", "colinhacks/zod"),
  // 入れていないもの:
  //   vercel/next.js  — 直近10件が canary で埋まり、安定版がフィードに残らない（ブログで拾う）
  //   expo/expo       — releases.atom がそもそも空（Expo Changelog で拾う）
  //   TanStack/*      — タイトルが「Release 2026-09-04 22:28」形式で、中身は
  //                     周辺パッケージの RC がほとんど（tanstack.com のブログで拾う）

  // --- Runtime / Language ---
  { name: "Node.js", url: "https://nodejs.org/en/feed/blog.xml", category: "runtime" },
  { name: "TypeScript", url: "https://devblogs.microsoft.com/typescript/feed/", category: "runtime" },
  { name: "Deno", url: "https://deno.com/feed", category: "runtime" },
  { name: "Bun", url: "https://bun.sh/rss.xml", category: "runtime" },
  { name: "V8", url: "https://v8.dev/blog.atom", category: "runtime" },

  // --- Framework ---
  { name: "React", url: "https://react.dev/rss.xml", category: "framework" },
  { name: "Vue", url: "https://blog.vuejs.org/feed.rss", category: "framework" },
  { name: "Next.js", url: "https://nextjs.org/feed.xml", category: "framework" },
  { name: "Angular", url: "https://blog.angular.dev/feed", category: "framework" },
  { name: "Svelte", url: "https://svelte.dev/blog/rss.xml", category: "framework" },
  { name: "Astro", url: "https://astro.build/rss.xml", category: "framework" },
  { name: "Remix", url: "https://remix.run/blog/rss.xml", category: "framework" },
  { name: "Nuxt", url: "https://nuxt.com/blog/rss.xml", category: "framework" },
  { name: "TanStack", url: "https://tanstack.com/rss.xml", category: "framework" },
  { name: "React Native", url: "https://reactnative.dev/blog/rss.xml", category: "framework" },
  { name: "Expo Changelog", url: "https://expo.dev/changelog/rss.xml", category: "framework" },
  { name: "Tauri", url: "https://v2.tauri.app/blog/rss.xml", category: "framework" },

  // --- Tooling ---
  { name: "Vite", url: "https://vitejs.dev/blog.rss", category: "tooling" },
  { name: "ESLint", url: "https://eslint.org/feed.xml", category: "tooling" },
  { name: "Vercel", url: "https://vercel.com/atom", category: "tooling", exclude: VERCEL_EXCLUDE, maxItems: 3 },
  // Vercel ほどではないが1日5件以上出る日があるので上限をかける。
  { name: "GitHub Changelog", url: "https://github.blog/changelog/feed/", category: "tooling", maxItems: 2 },
  { name: "Prettier", url: "https://prettier.io/blog/rss.xml", category: "tooling" },
  { name: "Biome", url: "https://biomejs.dev/blog/rss.xml", category: "tooling" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com/feeds/feed.xml", category: "tooling" },
  { name: "pnpm", url: "https://pnpm.io/blog/rss.xml", category: "tooling" },

  // --- Web Platform ---
  { name: "web.dev", url: "https://web.dev/static/blog/feed.xml", category: "platform" },
  { name: "Chrome for Developers", url: "https://developer.chrome.com/static/blog/feed.xml", category: "platform" },
  { name: "MDN Blog", url: "https://developer.mozilla.org/en-US/blog/rss.xml", category: "platform" },
  { name: "WebKit", url: "https://webkit.org/feed/", category: "platform" },
  { name: "Mozilla Hacks", url: "https://hacks.mozilla.org/feed/", category: "platform" },

  // --- Weekly / Curation（週1本。公式ブログが静かな日でも「今週何が動いたか」が入る） ---
  { name: "This Week in React", url: "https://thisweekinreact.com/newsletter/rss.xml", category: "newsletter" },
  { name: "JavaScript Weekly", url: "https://javascriptweekly.com/rss", category: "newsletter" },
  { name: "Node Weekly", url: "https://nodeweekly.com/rss", category: "newsletter" },
  { name: "Frontend Focus", url: "https://frontendfoc.us/rss", category: "newsletter" },
  { name: "React Status", url: "https://react.statuscode.com/rss", category: "newsletter" },

  // --- Community ---
  { name: "TkDodo", url: "https://tkdodo.eu/blog/rss.xml", category: "community" },
  { name: "overreacted", url: "https://overreacted.io/rss.xml", category: "community" },
  { name: "Josh Comeau", url: "https://www.joshwcomeau.com/rss.xml", category: "community" },
  { name: "Kent C. Dodds", url: "https://kentcdodds.com/blog/rss.xml", category: "community" },
  { name: "Robin Wieruch", url: "https://www.robinwieruch.de/index.xml", category: "community" },
  { name: "Nolan Lawson", url: "https://nolanlawson.com/feed/", category: "community" },
  { name: "Jake Archibald", url: "https://jakearchibald.com/posts.rss", category: "community" },
  { name: "Addy Osmani", url: "https://addyosmani.com/rss.xml", category: "community" },
  { name: "Stefan Judis", url: "https://www.stefanjudis.com/rss.xml", category: "community" },
  { name: "Ryan Carniato", url: "https://dev.to/feed/ryansolid", category: "community" },
  // メディアは毎日出るので上限をかける。
  { name: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", category: "community", maxItems: 2 },
  { name: "CSS-Tricks", url: "https://css-tricks.com/feed/", category: "community", maxItems: 2 },
  { name: "Frontend Masters", url: "https://frontendmasters.com/blog/feed/", category: "community", maxItems: 2 },
];
