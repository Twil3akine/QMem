import { expect, test } from "bun:test";
import { Autosave } from "./autosave.js";

test("flush saves immediately before debounce and opens an empty note", async () => {
  const writes = [];
  const saver = new Autosave(async (id, body) => { writes.push({ id, body }); return id ?? 1; }, () => {}, 60_000);
  saver.update("終了直前");
  await saver.open();
  expect(writes).toEqual([{ id: null, body: "終了直前" }]);
  expect(saver.note).toEqual({ id: null, body: "", saved: "" });
});

test("edits during an insert are serialized using the returned id", async () => {
  const writes = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const saver = new Autosave(async (id, body) => {
    writes.push({ id, body });
    if (writes.length === 1) await blocked;
    return id ?? 42;
  }, () => {}, 60_000);
  saver.update("最初");
  const saving = saver.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  saver.update("最新の本文");
  const closing = saver.flush();
  release();
  await Promise.all([saving, closing]);
  expect(writes).toEqual([{ id: null, body: "最初" }, { id: 42, body: "最新の本文" }]);
});

test("save failure keeps the current note and can be retried", async () => {
  let fail = true;
  const saver = new Autosave(async () => { if (fail) throw new Error("disk full"); return 3; }, () => {}, 60_000);
  saver.update("失ってはいけない本文");
  await expect(saver.open()).rejects.toThrow("disk full");
  expect(saver.note.body).toBe("失ってはいけない本文");
  expect(saver.note.saved).toBe("");
  fail = false;
  await saver.flush();
  expect(saver.note.id).toBe(3);
  expect(saver.note.saved).toBe(saver.note.body);
});

test("debounced edits automatically save and historical notes retain their id", async () => {
  const writes = [];
  let saved;
  const done = new Promise((resolve) => { saved = resolve; });
  const saver = new Autosave(async (id, body) => { writes.push({ id, body }); saved(); return id; }, () => {}, 5);
  await saver.open({ id: 7, body: "過去" });
  saver.update("過去を編集");
  await done;
  await saver.flush();
  expect(writes).toEqual([{ id: 7, body: "過去を編集" }]);
});

test("deleting all text resets the id before typing a new body", async () => {
  const writes = [];
  const saver = new Autosave(async (id, body) => { writes.push({ id, body }); return body.trim() ? 9 : null; }, () => {}, 60_000);
  await saver.open({ id: 7, body: "過去" });
  saver.update(" ");
  await saver.flush();
  saver.update("新しい本文");
  await saver.flush();
  expect(writes).toEqual([{ id: 7, body: " " }, { id: null, body: "新しい本文" }]);
});
