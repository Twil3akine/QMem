// One in-flight write per note keeps inserts and subsequent updates in order.
export class Autosave {
  constructor(save, onError, delay = 180) {
    this.save = save;
    this.onError = onError;
    this.delay = delay;
    this.note = { id: null, body: "", saved: "" };
    this.pending = Promise.resolve();
  }

  update(body) {
    this.note.body = body;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(this.onError), this.delay);
  }

  flush() {
    clearTimeout(this.timer);
    const note = this.note;
    const write = async () => {
      while (note.body !== note.saved) {
        const body = note.body;
        note.id = await this.save(note.id, body);
        note.saved = body;
      }
    };
    this.pending = this.pending.catch(() => {}).then(write);
    return this.pending;
  }

  async open(note = { id: null, body: "" }) {
    await this.flush();
    this.note = { ...note, saved: note.body };
    return this.note.body;
  }
}
