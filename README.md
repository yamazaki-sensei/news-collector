# news-collector

フロントエンド周辺（Node / Vue / TypeScript / React ほか）の情報を1日1回集約し、Claude が要約して Discord に投稿する bot。

**ランニングコストはゼロ。** Claude API のキーではなく Claude Pro のサブスクリプションを OAuth トークン経由で使うため、API 課金は発生しない。GitHub Actions も public リポジトリなので実行時間は無料。

## 仕組み

```
① fetch (Node)   21本のRSSを並列取得 → 直近72時間 → 既読を除外 → work/items.json
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

毎日 **08:05 JST**（cron は `5 23 * * *` UTC）に実行される。実行時刻を変えるときは `.github/workflows/daily-digest.yml` の `cron` を編集する。GitHub Actions の scheduled 実行は高負荷時に遅延・スキップされることがあるので、定時性は期待しないこと。

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

### 要約の内容や書式を変える

`prompts/digest.md` を編集する。ワークフローの YAML を触る必要はない（ワークフローからはこのファイルを読ませているだけ）。

### 主な調整パラメータ

いずれも `src/fetch.ts` の先頭で定義している。

| 定数 | 既定 | 役割 |
|---|---|---|
| `WINDOW_HOURS` | 72 | 収集対象とする記事の新しさ。重複排除は `seen.json` が担うので、広げても再投稿は起きない |
| `MAX_ITEMS_PER_FEED` | 5 | 1フィードから1回に採用する上限。GitHub Changelog / Vercel が突出して多いため、これがないとダイジェストが2社で埋まる |
| `SEEN_RETENTION_DAYS` | 30 | `seen.json` に ID を保持する期間 |
| `FEED_TIMEOUT_MS` | 30000 | 1フィードあたりのタイムアウト（web.dev は実測15秒近くかかることがある） |

## 設計上の判断

- **上限で溢れた記事は翌日に持ち越さず捨てる。** 全記事のアーカイブではなくダイジェストなので、数日遅れの記事が混ざるより「その日の上位5件」で切るほうが読み物として素直。
- **投稿が成功したときだけ `seen.json` をコミットする。** 途中で失敗した回は既読が記録されないので、次回そのまま再取得される。稀に重複投稿が起きるより、記事を取りこぼすほうが困る。
- **日付が取れない記事は捨てる。** 期間で絞れない記事を入れると毎日再掲されるため。
- **public リポジトリの60日ルール。** GitHub は public リポジトリで60日間活動がないと scheduled workflow を自動停止するが、本 bot は毎日 `state/seen.json` をコミットするので活動が途切れない。

## 制約

- OAuth トークンは発行した個人の契約に紐づく。チームで共有する運用に変えるなら API キー方式（`ANTHROPIC_API_KEY`）への移行が必要。
- フィード URL は移転・廃止される。投稿が急に薄くなったら Actions のログで失敗フィードを確認する（`✗ <フィード名>: <理由>` の形で出る）。
