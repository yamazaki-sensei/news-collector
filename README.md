# news-collector

フロントエンド周辺（Node / Vue / TypeScript / React ほか）の情報を1日1回集約し、Claude が要約して Discord に投稿する bot。

**ランニングコストはゼロ。** Claude API のキーではなく Claude Pro のサブスクリプションを OAuth トークン経由で使うため、API 課金は発生しない。GitHub Actions も public リポジトリなので実行時間は無料。

## 仕組み

```
① fetch (Node)   66本のRSSを並列取得 → 直近72時間 → 既読を除外 → 上限で絞る → work/items.json
                 └ 新着0件ならここで終了（Claude も Discord も呼ばない）
② Claude         work/items.json を読む → 注目3件を選定・分類 → work/digest.md
③ post (Node)    work/digest.md → Discord Webhook（2000字ごとに分割）
④ commit         state/seen.json をコミット（重複排除の記録）
```

判断が要る部分だけを Claude に任せ、取得・期間フィルタ・重複排除はコード側で決定的に処理している。

Discord の Webhook URL は ③ のステップにしか渡していないので、Claude から触れる経路は存在しない。public リポジトリで Actions のログが公開されることを踏まえた分離。

## セットアップ

### 1. Discord の Webhook を作る

投稿したいチャンネル → 「チャンネルの編集」→「連携サービス」→「ウェブフックを作成」→ URL をコピー。

### 2. Claude のトークンを発行する

ローカルで実行する（Claude Pro / Max / Team / Enterprise が必要）:

```sh
claude setup-token
```

サブスクリプションに紐づく長期トークンが表示される。

### 3. Secrets を登録する

```sh
gh secret set CLAUDE_CODE_OAUTH_TOKEN   # 手順2のトークン
gh secret set DISCORD_WEBHOOK_URL       # 手順1のURL
```

### 4. 動作確認

ワークフローは default ブランチに置かれていないと cron が動かない。マージ後に手動実行で確認する:

```sh
gh workflow run daily-digest.yml
gh run watch
```

## 運用

毎日 **07:05 JST**（cron は `5 22 * * *` UTC）に実行される。実行時刻を変えるときは `.github/workflows/daily-digest.yml` の `cron` を編集する。GitHub Actions の scheduled 実行は高負荷時に遅延・スキップされることがあるので、定時性は期待しないこと。

新着が0件の日（週末など）は何も投稿されない。

### ローカルでの確認

```sh
npm ci
npm run typecheck

# フィード取得のみ（Discord にも Claude にも接続しない）
npm run fetch
cat work/items.json

# Discord への投稿のみ
printf '**テスト**\n• [example](https://example.com) — 疎通確認\n' > work/digest.md
DISCORD_WEBHOOK_URL='<URL>' npm run post
```

`npm run fetch` は `state/seen.json` を書き換える点に注意。試したあと元に戻すには:

```sh
git checkout state/seen.json
```

## カスタマイズ

### 収集先を増やす / 減らす

`src/feeds.ts` の `FEEDS` を編集する。追加する前に URL が生きているか確認すること:

```sh
curl -sIL -o /dev/null -w '%{http_code} %{content_type}\n' <URL>
```

200 かつ content-type が xml 系でないと、フィードではなく HTML ページを掴んでいる。

フィードは7カテゴリに分かれていて、この並びがそのままダイジェストのセクション順になる。

| カテゴリ | 中身 | 意図 |
|---|---|---|
| `release` | GitHub の `releases.atom` を18本 | 公式ブログを持たない / ブログはメジャーしか書かないライブラリのバージョン変化を拾う |
| `framework` | React / Vue / Nuxt / Next / Svelte / Astro / TanStack / React Native / Expo / Tauri | |
| `runtime` | Node / TypeScript / Deno / Bun / V8 | |
| `tooling` | Vite / ESLint / Prettier / Biome / Tailwind / pnpm / Vercel / GitHub Changelog | |
| `platform` | web.dev / Chrome / MDN / WebKit / Mozilla Hacks | ブラウザ側の変化 |
| `newsletter` | This Week in React / JavaScript Weekly / Node Weekly / Frontend Focus / React Status | 週1本。公式ブログが静かな日でも「今週何が動いたか」が入る |
| `community` | 個人ブログとメディア | |

`release` と `newsletter` は**偏り対策**として置いている。公式ブログだけを並べていた頃は、React や Vue のように数ヶ月に1回しか書かないソースが実質ヒットせず、毎日投稿している GitHub Changelog と Vercel でダイジェストが埋まっていた（`seen.json` の11件が全部その2社だった）。

`releases.atom` は `release()` ヘルパで追加する。プレリリース（canary / rc / nightly）は共通で落とし、monorepo の周辺パッケージはリポジトリごとに足す:

```ts
release("Angular", "angular/angular", /^zone\.js-/),
```

### フィードの内容を絞り込む

投稿量が多く、その大半が読者と無関係なフィードには `src/feeds.ts` で `exclude`（タイトル/URL に対する正規表現の配列）と `maxItems`（そのフィードだけの上限）を指定できる。現在は Vercel にだけ設定している。

Vercel は1日10件以上出すが、実測（`state/seen.json` の71件）ではその7割が AI Gateway のモデル追加・値下げ、マーケットプレイス連携、Enterprise 向け設定、自社/顧客事例で、フロントエンドの開発者向けではなかった。`exclude` でこれらを落とし、残るのは1日1〜2件（Next.js のセキュリティリリース、Node 非推奨版のアップグレード、Bun ランタイム、CDN の変更など）。

パターンを調整するときは Actions のログを見る。除外が起きたフィードは `✓ Vercel: 2/12 件が対象期間内（除外 8 件）` の形で出る。落としすぎ・残しすぎの判断は `state/seen.json` に貯まった URL を突き合わせるのが早い:

```sh
node -e 'const s=require("./state/seen.json");console.log(s.entries.filter(e=>e.id.includes("vercel.com")).map(e=>e.id).join("\n"))'
```

判断が微妙な記事は `exclude` で落とさず、「今日の注目」に上げるかどうかの判断を Claude に任せる。決定的に落とせるものだけをコード側で切る、という他の処理と同じ方針。

### 要約の内容や書式を変える

`prompts/digest.md` を編集する。ワークフローの YAML を触る必要はない（ワークフローからはこのファイルを読ませているだけ）。

### 主な調整パラメータ

いずれも `src/fetch.ts` の先頭で定義している。

| 定数 | 既定 | 役割 |
|---|---|---|
| `WINDOW_HOURS` | 72 | 収集対象とする記事の新しさ。重複排除は `seen.json` が担うので、広げても再投稿は起きない |
| `MAX_ITEMS_PER_FEED` | 5 | 1フィードから1回に採用する上限（既定値）。GitHub Changelog / Vercel が突出して多いため、これがないとダイジェストが2社で埋まる。フィード側の `maxItems` が優先される |
| `MAX_ITEMS_PER_CATEGORY` | 10 | 1カテゴリから1回に採用する上限。リリースが重なった日に `release` だけで20件並ぶのを防ぐ |
| `SEEN_RETENTION_DAYS` | 30 | `seen.json` に ID を保持する期間 |
| `FEED_TIMEOUT_MS` | 30000 | 1フィードあたりのタイムアウト（web.dev は実測15秒近くかかることがある） |

## 設計上の判断

- **`exclude` で落とした記事は `seen.json` に載せない。** パターンは決定的なので翌日も同じように落ちる。載せないぶん `seen.json` が余計に太らない（上限で溢れたぶんは既読として記録する。こちらは翌日に再浮上させないため）。
- **上限で溢れた記事は翌日に持ち越さず捨てる。** 全記事のアーカイブではなくダイジェストなので、数日遅れの記事が混ざるより「その日の上位N件」で切るほうが読み物として素直。上限はフィード単位 → カテゴリ単位の2段階でかかる。
- **プレリリースは release カテゴリから落とす。** Next.js の canary、Angular の `-next`、Electron の nightly は毎日切られるので、入れると `releases.atom` 系がそれだけで埋まる。逆に vercel/next.js は直近10件が全部 canary で安定版がフィードに残らないため、`releases.atom` を使わずブログで拾っている。
- **`exclude` はタイトル + URL に当たる。** そのためバージョンだけを見たいプレリリース判定は `/releases/tag/` に錨を打っている。素の `-dev\b` にすると、リポジトリ名（`vitest-dev/vitest`、`web-infra-dev/rspack`）に当たって全部落ちる。
- **投稿が成功したときだけ `seen.json` をコミットする。** 途中で失敗した回は既読が記録されないので、次回そのまま再取得される。稀に重複投稿が起きるより、記事を取りこぼすほうが困る。
- **日付が取れない記事は捨てる。** 期間で絞れない記事を入れると毎日再掲されるため。
- **public リポジトリの60日ルール。** GitHub は public リポジトリで60日間活動がないと scheduled workflow を自動停止するが、本 bot は毎日 `state/seen.json` をコミットするので活動が途切れない。

## 制約

- OAuth トークンは発行した個人の契約に紐づく。チームで共有する運用に変えるなら API キー方式（`ANTHROPIC_API_KEY`）への移行が必要。
- フィード URL は移転・廃止される。投稿が急に薄くなったら Actions のログで失敗フィードを確認する（`✗ <フィード名>: <理由>` の形で出る）。
