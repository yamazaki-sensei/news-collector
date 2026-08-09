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
};

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
  { name: "Vercel", url: "https://vercel.com/atom", category: "tooling" },
  { name: "GitHub Changelog", url: "https://github.blog/changelog/feed/", category: "tooling" },

  // --- Web Platform ---
  { name: "web.dev", url: "https://web.dev/static/blog/feed.xml", category: "platform" },
  { name: "Chrome for Developers", url: "https://developer.chrome.com/static/blog/feed.xml", category: "platform" },
  { name: "MDN Blog", url: "https://developer.mozilla.org/en-US/blog/rss.xml", category: "platform" },

  // --- Community ---
  { name: "TkDodo", url: "https://tkdodo.eu/blog/rss.xml", category: "community" },
  { name: "overreacted", url: "https://overreacted.io/rss.xml", category: "community" },
];
