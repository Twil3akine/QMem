# QMem

開く → 書く → 自動保存、だけのTauri 2デスクトップメモアプリです。
通常画面はプレーンテキストのエディタだけです。起動時には必ず新しい空の本文にフォーカスします。

[使い方ガイドのソース](site/index.html) · [ガイドの公開手順](docs/publishing.md) · [MIT License](LICENSE)

## 起動とビルド

Bun 1.3.10、Rust、各OSの[Tauri開発環境](https://v2.tauri.app/start/prerequisites/)が必要です。
macOSではXcode Command Line Toolsが必要です。JavaScriptのパッケージ管理はBunのみを使用します。

```bash
bun install
bun run tauri dev
```

フロントエンドをビルドする場合です。

```bash
bun run build
```

macOSアプリを生成する場合です。

```bash
bun run tauri build
```

生成先は `src-tauri/target/release/bundle/macos/QMem.app` です。
`bun run dev` はフロントエンド開発サーバーのみで、SQLite操作にはTauri内での起動が必要です。

## 操作

- `Cmd+N`：現在の本文を保存して、新しい空のメモへ移ります。
- `Cmd+W`：本文を保存してウィンドウを閉じます。アプリはDockに残ります。Dockから開き直すと新しい空のメモになります。
- `Cmd+Q`：本文を保存してアプリを完全終了します。
- `Shift+Cmd+Space`：アプリ常駐中は、ほかのアプリからでも現在の本文を保存して新しい空のメモを開きます。完全終了後はFinderなどから起動してください。
- `Cmd+K`：過去メモの本文検索を開きます。空の検索語では全件を作成日時の降順で表示します。
  - 検索結果の `↑` / `↓`：結果間を移動します。`Enter`：選択したメモを開きます。
- `Esc`：検索欄・検索結果のどちらからでも検索を閉じ、本文へフォーカスを戻します。IME変換中のキーイベントは処理しません。

通常のテキスト編集ショートカットは標準textareaとOSの編集メニューを使用します。
Markdownは文字列として入力できますが、解釈しません。

## 保存

RustのrusqliteからローカルSQLiteへ保存します。テーブルは `notes` のみで、
`id`、`body`、`created_at`、`updated_at` を保持します。日時はUnix epochからのミリ秒です。
macOSの保存先は `~/Library/Application Support/app.qmem.desktop/notes.sqlite3` です。
SQLiteのWALと `synchronous=FULL` を使用します。

入力後180msで自動保存します。新規メモへの切り替え、検索を開く操作、通常のウィンドウ閉鎖・
アプリ終了では、保留中の入力も保存完了を待ちます。書き込みを直列化し、保存中の追加入力も反映します。
保存に失敗した場合は本文とウィンドウを保持し、エラー時だけ通知します。追加入力や終了操作で再試行できます。

空・空白のみの本文は保存しません。既存メモの本文をすべて消した場合も、そのレコードを削除します。
本文検索は文字列の部分一致です。`%` や `_` を検索構文として解釈しません。
ASCII英字の大文字・小文字を区別せず、日本語はそのまま照合します。
