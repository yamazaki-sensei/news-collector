/**
 * 全フィードを並列取得し、直近24時間の未読記事だけを work/items.json に書き出す。
 *
 * Claude には「判断」だけをさせたいので、取得・期間フィルタ・重複排除といった
 * 決定的にできる処理はすべてここで済ませる。
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";

import { CATEGORY_LABELS, FEEDS, type Category, type Feed } from "./feeds.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORK_DIR = path.join(ROOT, "work");
const ITEMS_PATH = path.join(WORK_DIR, "items.json");
const SEEN_PATH = path.join(ROOT, "state", "seen.json");

/**
 * 取得対象とする記事の新しさ。
 * 重複排除は seen.json が担っているので、ここを広げても再投稿は起きない。
 * 広めに取ることで、cron のドロップや週末を跨いでも記事を取りこぼさない。
 * （狭くしている唯一の理由は、初回実行で過去記事を大量に拾わないため）
 */
const WINDOW_HOURS = 72;
/** seen.json に ID を保持する期間。これを過ぎたら捨てて肥大化を防ぐ。 */
const SEEN_RETENTION_DAYS = 30;
/** 1フィードあたりのタイムアウト。web.dev は実測で15秒近くかかることがある。 */
const FEED_TIMEOUT_MS = 30_000;
/** 一時的な失敗を拾い直す回数。並列取得なので全体の所要時間はほぼ増えない。 */
const FEED_RETRIES = 1;
/**
 * 1フィードから1回で採用する最大件数（既定）。
 * GitHub Changelog / Vercel は1日10件以上出すことがあり、上限がないと
 * ダイジェストがその2つで埋まって他フレームワークの記事が埋もれる。
 * フィード側で maxItems を指定していればそちらが優先される。
 */
const MAX_ITEMS_PER_FEED = 5;
/** Claude に渡す抜粋の長さ。要約の材料としてはこれで足り、入力トークンを抑えられる。 */
const EXCERPT_MAX_CHARS = 500;

const USER_AGENT =
  "news-collector/1.0 (+https://github.com/yamazaki-sensei/news-collector)";

type Item = {
  id: string;
  feed: string;
  category: Category;
  categoryLabel: string;
  title: string;
  link: string;
  publishedAt: string;
  excerpt: string;
};

type SeenEntry = { id: string; seenAt: string };
type SeenState = { entries: SeenEntry[] };

/**
 * RSSの description/content には HTML がそのまま入っている。
 * タグと主要な実体参照を落として、要約の材料になる素のテキストにする。
 */
function toPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

/**
 * フィードごとの除外パターンに当たるか。
 * タイトルとURLの両方を見るのは、タイトルが素っ気なくても URL の slug に
 * 判断材料が残っていることがあるため（Vercel の changelog がこの形）。
 *
 * ここで落とした記事は seen.json に載らない。パターンは決定的なので翌日も
 * 同じように落ちるし、載せないぶん seen.json が余計に太らない。
 */
function isExcluded(item: Item, feed: Feed): boolean {
  if (!feed.exclude) return false;
  const haystack = `${item.title} ${item.link}`;
  return feed.exclude.some((pattern) => pattern.test(haystack));
}

const parser = new Parser({
  customFields: { item: [["content:encoded", "contentEncoded"]] },
});

type RawItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
};

/**
 * 1フィードを取得してパースする。
 * rss-parser 内蔵の取得ではなく fetch を使うのは、タイムアウトと User-Agent を
 * こちら側で確実に制御するため（UA を送らないと弾くフィードがある）。
 */
async function fetchFeed(feed: Feed): Promise<RawItem[]> {
  const res = await fetch(feed.url, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = await parser.parseString(await res.text());
  return parsed.items as RawItem[];
}

/** タイムアウトや一時的な 5xx で1本まるごと落とさないよう、数回だけ試す。 */
async function fetchFeedWithRetry(feed: Feed): Promise<RawItem[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= FEED_RETRIES; attempt++) {
    try {
      return await fetchFeed(feed);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function toItem(raw: RawItem, feed: Feed, cutoff: Date): Item | null {
  const link = raw.link?.trim();
  const title = raw.title?.trim();
  if (!link || !title) return null;

  // 日付が取れない記事は捨てる。期間で絞れない = 毎日再掲されることになるため。
  const dateText = raw.isoDate ?? raw.pubDate;
  if (!dateText) return null;
  const publishedAt = new Date(dateText);
  if (Number.isNaN(publishedAt.getTime()) || publishedAt < cutoff) return null;

  const body = raw.contentSnippet ?? raw.contentEncoded ?? raw.content ?? "";

  return {
    id: raw.guid?.trim() || link,
    feed: feed.name,
    category: feed.category,
    categoryLabel: CATEGORY_LABELS[feed.category],
    title,
    link,
    publishedAt: publishedAt.toISOString(),
    excerpt: truncate(toPlainText(body), EXCERPT_MAX_CHARS),
  };
}

async function loadSeen(): Promise<SeenState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(SEEN_PATH, "utf8"));
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as SeenState).entries)) {
      return parsed as SeenState;
    }
  } catch {
    // 初回実行やファイル破損時は空から始める。ここで落とす価値はない。
  }
  return { entries: [] };
}

async function main(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  const seen = await loadSeen();
  const seenIds = new Set(seen.entries.map((e) => e.id));

  // 1本の失敗で全体を落とさない。落ちたフィードは名前をログに残して次回以降の調査材料にする。
  const results = await Promise.allSettled(FEEDS.map((feed) => fetchFeedWithRetry(feed)));

  const collected: Item[] = [];
  const failures: string[] = [];

  results.forEach((result, i) => {
    const feed = FEEDS[i];
    if (!feed) return;
    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push(`${feed.name} (${reason})`);
      console.warn(`  ✗ ${feed.name}: ${reason}`);
      return;
    }
    const fresh = result.value
      .map((raw) => toItem(raw, feed, cutoff))
      .filter((item): item is Item => item !== null);
    const kept = fresh.filter((item) => !isExcluded(item, feed));
    const excluded = fresh.length - kept.length;
    console.log(
      `  ✓ ${feed.name}: ${kept.length}/${result.value.length} 件が対象期間内` +
        (excluded > 0 ? `（除外 ${excluded} 件）` : ""),
    );
    collected.push(...kept);
  });

  // 同じ記事が複数フィードに現れることがあるので id で一意化してから既読を除く。
  const byId = new Map(collected.map((item) => [item.id, item]));
  const unseen = [...byId.values()].filter((item) => !seenIds.has(item.id));

  // GitHub Changelog や Vercel は投稿頻度が突出して高く、放っておくとダイジェストが
  // その2つで埋まって Vue / TypeScript の記事が埋もれる。フィードごとに新しい順で
  // 上限をかけ、静かなフィードの記事が押し流されないようにする。
  // 溢れたぶんは翌日に持ち越さず捨てる（後段で既読として記録する）。ここは
  // 全記事のアーカイブではなくダイジェストなので、数日遅れの記事が混ざるより
  // 「その日の上位5件」で切るほうが読み物として素直。
  const perFeed = new Map<string, Item[]>();
  for (const item of unseen) {
    const bucket = perFeed.get(item.feed);
    if (bucket) bucket.push(item);
    else perFeed.set(item.feed, [item]);
  }

  const feedByName = new Map(FEEDS.map((feed) => [feed.name, feed]));
  const newItems: Item[] = [];
  for (const [feedName, items] of perFeed) {
    const limit = feedByName.get(feedName)?.maxItems ?? MAX_ITEMS_PER_FEED;
    items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    if (items.length > limit) {
      console.log(`  … ${feedName}: ${items.length} 件中 ${limit} 件に絞り込み`);
    }
    newItems.push(...items.slice(0, limit));
  }
  newItems.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  await mkdir(WORK_DIR, { recursive: true });
  await writeFile(
    ITEMS_PATH,
    `${JSON.stringify({ generatedAt: now.toISOString(), count: newItems.length, items: newItems }, null, 2)}\n`,
  );

  // 保持期間を過ぎた ID を落としつつ、今回ぶんを追記する。
  const retentionCutoff = new Date(now.getTime() - SEEN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const keptEntries = seen.entries.filter((e) => {
    const seenAt = new Date(e.seenAt);
    return !Number.isNaN(seenAt.getTime()) && seenAt >= retentionCutoff;
  });
  // 上限で切ったぶんも含めて既読にする。そうしないと翌日また候補に上がってくる。
  const nextSeen: SeenState = {
    entries: [
      ...keptEntries,
      ...unseen.map((item) => ({ id: item.id, seenAt: now.toISOString() })),
    ],
  };
  await writeFile(SEEN_PATH, `${JSON.stringify(nextSeen, null, 2)}\n`);

  console.log(
    `\n新着 ${newItems.length} 件 / 取得成功 ${FEEDS.length - failures.length}・失敗 ${failures.length} フィード`,
  );
  if (failures.length > 0) console.log(`失敗したフィード: ${failures.join(", ")}`);

  // 後続ステップ（Claude・Discord投稿）を新着0件のときスキップさせるための出力。
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `count=${newItems.length}\n`);
  }
}

await main();
