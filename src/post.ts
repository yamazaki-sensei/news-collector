/**
 * work/digest.md を Discord の Webhook に投稿する。
 *
 * このリポジトリは public なので Actions のログも公開される。
 * Webhook URL がログに漏れないよう、出力する文字列はすべて redact() を通すこと。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIGEST_PATH = path.join(ROOT, "work", "digest.md");

/** Discord の1メッセージあたりの上限。安全側に少し余裕を残す。 */
const MAX_CHARS = 1900;
/** 連投でレートリミットに当たらないための間隔。 */
const POST_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 15_000;

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

/** 例外メッセージ等に URL が紛れ込んでもログに出さないための伏せ字化。 */
function redact(text: string): string {
  if (!WEBHOOK_URL) return text;
  return text.split(WEBHOOK_URL).join("[webhook]");
}

/**
 * 例外を1行に畳む。
 * fetch の失敗は message が "fetch failed" だけで cause 側に原因が入るため、
 * cause も拾わないと Actions のログから何が起きたか分からない。
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return redact(String(error));
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
  return redact(`${error.message}${cause}`);
}

/**
 * 2000字制限に合わせて分割する。
 * 文字数で機械的に切るとリンクやコードブロックが分断されるので、
 * 段落 → 行 の順に「切ってよい場所」を探して、そこで区切る。
 */
export function splitForDiscord(text: string, maxChars = MAX_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  const append = (piece: string, separator: string): void => {
    if (current && current.length + separator.length + piece.length > maxChars) flush();
    current = current ? current + separator + piece : piece;
  };

  for (const block of text.split(/\n{2,}/)) {
    if (block.trim() === "") continue;

    if (block.length <= maxChars) {
      append(block, "\n\n");
      continue;
    }

    // 段落単体で上限を超える場合は行単位に落とす。
    for (const line of block.split("\n")) {
      if (line.length <= maxChars) {
        append(line, "\n");
        continue;
      }
      // 1行で上限を超えるのは想定外だが、投稿を落とすよりは切って出す。
      flush();
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push(line.slice(i, i + maxChars));
      }
    }
  }

  flush();
  return chunks;
}

async function postChunk(url: string, content: string, attempt = 0): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // 記事タイトルに @everyone 等が含まれていても通知を飛ばさない。
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (res.status === 429 && attempt === 0) {
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    const waitMs = Math.ceil((body.retry_after ?? 1) * 1000) + 250;
    console.warn(`レートリミット。${waitMs}ms 待機して1回だけ再試行します`);
    await sleep(waitMs);
    return postChunk(url, content, attempt + 1);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(redact(`Discord への投稿に失敗しました: HTTP ${res.status} ${detail}`.trim()));
  }
}

async function main(): Promise<void> {
  if (!WEBHOOK_URL) {
    throw new Error("環境変数 DISCORD_WEBHOOK_URL が設定されていません");
  }

  let digest: string;
  try {
    digest = await readFile(DIGEST_PATH, "utf8");
  } catch {
    throw new Error(`${DIGEST_PATH} がありません。先に fetch と Claude のステップを実行してください`);
  }

  if (digest.trim() === "") {
    console.log("ダイジェストが空でした。投稿をスキップします");
    return;
  }

  const chunks = splitForDiscord(digest);
  console.log(`${chunks.length} 通に分割して投稿します（本文 ${digest.length} 文字）`);

  for (const [i, chunk] of chunks.entries()) {
    if (i > 0) await sleep(POST_INTERVAL_MS);
    await postChunk(WEBHOOK_URL, chunk);
    console.log(`  ✓ ${i + 1}/${chunks.length} 通目を投稿（${chunk.length} 文字）`);
  }

  console.log("投稿が完了しました");
}

// テストから import されたときは実行しない。
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  // 生の例外をそのまま投げると Webhook URL を含みうるオブジェクトが
  // ログにダンプされる。1行に畳んで伏せ字化してから出す。
  try {
    await main();
  } catch (error) {
    console.error(`エラー: ${describeError(error)}`);
    process.exitCode = 1;
  }
}
