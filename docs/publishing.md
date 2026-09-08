# ガイドの公開

使い方ガイドは `site/` にある静的HTML/CSSです。JavaScript、外部フォント、追加依存、ビルド処理はありません。
デスクトップアプリの `index.html` や `dist/` とは独立しています。

## Cloudflare Pages

GitHubの `Twil3akine/QMem` を接続し、以下を設定してください。

| 項目 | 設定値 |
| --- | --- |
| Production branch | `master` |
| Framework preset | `None` |
| Root directory | `site` |
| Build command | `exit 0` |
| Build output directory | `.` |

Root directoryを `site` にすることで、アプリ側の依存インストール・Rustビルドは不要です。
`bun run build` はデスクトップアプリ用なので、Pagesのビルドコマンドには指定しません。
Git連携の設定後は、対象ブランチへのpushがPagesの自動デプロイにつながります。
今回はPagesの作成・接続・デプロイを行っていません。

設定の根拠：[Cloudflare Pages — Static HTML](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)。

## ローカルでの確認

`site/index.html` をブラウザーで開くだけで確認できます。既存のViteを使う場合は、リポジトリのルートで以下を実行します。

```bash
bun run dev
```

`http://127.0.0.1:1420/site/` でガイドを表示できます。これは表示確認用で、Pages側のビルドには使いません。

## GitHub Repository Description案

```text
A minimal desktop notepad. Open, write, and auto-save. Built with Tauri, Rust, and SQLite.
```

技術構成より先に「何ができるアプリか」を伝える短い説明です。GitHubのDescription設定自体は変更していません。

配布用リリースを公開したら、`site/index.html` のセットアップ節に導入リンクを追加してください。
公開URLが決まったら、リポジトリのWebsite欄に設定できます。
