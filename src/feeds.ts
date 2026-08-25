/**
 * 収集対象のRSS/Atomフィード。
 *
 * 追加するときは URL が生きているか先に確かめること:
 *   curl -sIL -o /dev/null -w '%{http_code} %{content_type}\n' <URL>
 * 200 かつ content-type が xml 系でないと、フィードではなくHTMLページを掴んでいる。
 */

export type Category = "runtime" | "framework" | "tooling" | "platform" | "community";

/** ダイジェスト内での表示順とラベル。Claude 側のプロンプトもこの並びを前提にしている。 */
export const CATEGORY_LABELS: Record<Category, string> = {
  framework: "⚙️ Framework",
  runtime: "🧩 Runtime / Language",
  tooling: "🔧 Tooling",
  platform: "🌐 Web Platform",
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

export const FEEDS: readonly Feed[] = [
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

  // --- Tooling ---
  { name: "Vite", url: "https://vitejs.dev/blog.rss", category: "tooling" },
  { name: "ESLint", url: "https://eslint.org/feed.xml", category: "tooling" },
  { name: "Vercel", url: "https://vercel.com/atom", category: "tooling", exclude: VERCEL_EXCLUDE, maxItems: 3 },
  { name: "GitHub Changelog", url: "https://github.blog/changelog/feed/", category: "tooling" },

  // --- Web Platform ---
  { name: "web.dev", url: "https://web.dev/static/blog/feed.xml", category: "platform" },
  { name: "Chrome for Developers", url: "https://developer.chrome.com/static/blog/feed.xml", category: "platform" },
  { name: "MDN Blog", url: "https://developer.mozilla.org/en-US/blog/rss.xml", category: "platform" },

  // --- Community ---
  { name: "TkDodo", url: "https://tkdodo.eu/blog/rss.xml", category: "community" },
  { name: "overreacted", url: "https://overreacted.io/rss.xml", category: "community" },
];
