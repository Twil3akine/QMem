// 保存を常に1件ずつ実行し、新規作成と、その直後の更新の順序を保証する。
export class Autosave {
  constructor(save, onError, delay = 180) {
    // saveは永続化処理、onErrorは自動保存失敗時の通知処理として外から受け取る。
    this.save = save;
    this.onError = onError;
    this.delay = delay;
    this.note = { id: null, body: "", saved: "" };
    // 完了済みPromiseを起点に、後続の保存を順番につなぐ。
    this.pending = Promise.resolve();
  }

  update(body) {
    this.note.body = body;
    // 入力のたびにタイマーを戻し、入力が止まってから保存する。
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(this.onError), this.delay);
  }

  flush() {
    clearTimeout(this.timer);
    // openでthis.noteが切り替わっても、切り替え前のメモを最後まで保存できるよう参照を保持する。
    const note = this.note;
    const write = async () => {
      // 保存中に本文が更新された場合は、最新の本文になるまで続けて保存する。
      while (note.body !== note.saved) {
        const body = note.body;
        note.id = await this.save(note.id, body);
        note.saved = body;
      }
    };
    // 前回の失敗は次回の再試行を妨げないが、今回の失敗は呼び出し元へ返す。
    this.pending = this.pending.catch(() => {}).then(write);
    return this.pending;
  }

  async open(note = { id: null, body: "" }) {
    // 現在のメモを保存できた場合だけ、表示対象を次のメモへ切り替える。
    await this.flush();
    this.note = { ...note, saved: note.body };
    return this.note.body;
  }
}
