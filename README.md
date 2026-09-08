# QMem

開く → 書く → 自動保存、だけのTauri 2デスクトップメモアプリです。
通常画面はプレーンテキストのエディタだけです。起動時には必ず新しい空の本文にフォーカスします。

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
- `Cmd+K`：過去メモの本文検索を開きます。空の検索語では全件を作成日時の降順で表示します。
- 検索欄の `↓`：検索結果へ移動します。`Enter`：先頭の結果を開きます。
- 検索結果の `↑` / `↓`：結果間を移動します。`Enter`：選択したメモを開きます。
- `Esc`：検索を閉じて本文へ戻ります。

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

## 検証

```bash
bun test
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
bun run test:native
```

`test:native` はmacOSのGUIセッションで実行してください。一時ディレクトリにテスト用ソースとDBを作り、
実際のTauri／WebKitでDOM操作と本物のIPC・SQLiteを検証します。本番アプリにテストコマンドは含めません。
一時DBの場所は標準出力に表示します。実際の利用者のDBには触れません。

2026-09-08、macOSで以下を確認しました。

| 検証 | 結果 |
| --- | --- |
| JavaScript保存テスト | 5件成功：終了前flush、保存中の追加入力、失敗後の再試行、過去メモ編集、空本文への更新 |
| Rust保存テスト | 2件成功：空メモ除外、同じIDの更新、本文検索、DB再接続後の永続化 |
| ネイティブ統合テスト | 起動時の空本文・フォーカス、自動保存、Cmd+N/Kハンドラー、本文検索、再編集が成功 |
| ネイティブ終了テスト | CloseRequestedとExitRequestedの両方で終了直前の本文が残ることをDB再接続で確認 |
| 再起動 | 既存データがあっても空のエディタを表示し、過去メモを検索で開けることを確認 |
| ブラウザーUI検証 | 代替保存APIによる10項目成功。保存失敗時に本文を残し、終了しないことも確認 |
| クリーンインストール | node_modulesを一時ディレクトリへ退避し、bun install → bun run build が成功 |
| アプリビルド | bun run tauri build でQMem.appを生成 |
| Rust静的チェック | fmtとclippy（警告をエラー扱い）が成功 |

ネイティブ統合テストのキーボード操作はDOMイベントで実行しています。
物理キーボード操作、日本語IMEの変換中の終了、Windows/Linuxでの動作は未検証です。
強制終了や電源断は、通常の終了時の保存待ち処理の対象外です。

## 範囲

タイトル、管理用の常設UI、タグ、フォルダ、Markdown描画、アカウント、同期などは実装していません。
配布向けのコード署名・公証、グローバルショートカット、エクスポートも今回の範囲外です。

作業開始時のディレクトリは空で、Gitリポジトリはありませんでした。Git初期化・コミットは行っていません。
