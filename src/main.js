import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Autosave } from "./autosave.js";
import "./style.css";

const editor = document.querySelector("#editor");
const dialog = document.querySelector("#search-dialog");
const query = document.querySelector("#query");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
let busy = false;
let searchVersion = 0;
let searchTimer;

function reportError(cause) {
  error.textContent = `保存・読み込みに失敗しました。内容を残したまま再試行できます。${String(cause)}`;
  error.hidden = false;
}

const autosave = new Autosave(async (id, body) => {
  const result = await invoke("save_note", { id, body });
  error.hidden = true;
  return result;
}, reportError);

editor.addEventListener("input", () => autosave.update(editor.value));

// Serialize navigation and shutdown; never discard a note after a failed save.
let actions = Promise.resolve();
function action(work) {
  actions = actions.then(async () => {
    busy = true;
    editor.readOnly = true;
    autosave.update(editor.value);
    try { await work(); } catch (cause) { reportError(cause); }
    finally { busy = false; editor.readOnly = false; if (!dialog.open) editor.focus(); }
  });
  return actions;
}

function openNote(note) {
  return action(async () => {
    editor.value = await autosave.open(note);
    dialog.close();
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}

async function search() {
  const version = ++searchVersion;
  try {
    const notes = await invoke("search_notes", { query: query.value });
    if (version !== searchVersion || !dialog.open) return;
    results.replaceChildren();
    if (!notes.length) { results.textContent = "メモが見つかりません"; return; }
    for (const note of notes) {
      const button = document.createElement("button");
      const time = document.createElement("time");
      time.dateTime = new Date(note.created_at).toISOString();
      time.textContent = new Date(note.created_at).toLocaleString();
      const preview = document.createElement("span");
      preview.textContent = note.body.slice(0, 140);
      button.append(time, preview);
      button.addEventListener("click", () => { if (!busy) openNote(note); });
      results.append(button);
    }
  } catch (cause) { if (version === searchVersion) reportError(cause); }
}

function openSearch() {
  return action(async () => {
    await autosave.flush();
    query.value = "";
    dialog.showModal();
    query.focus();
    await search();
  });
}

query.addEventListener("input", () => {
  ++searchVersion;
  results.replaceChildren();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 100);
});
query.addEventListener("keydown", (event) => {
  if (!event.isComposing && ["ArrowDown", "Enter"].includes(event.key)) {
    event.preventDefault();
    const first = results.querySelector("button");
    if (event.key === "Enter") first?.click(); else first?.focus();
  }
});
results.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); event.target.nextElementSibling?.focus(); }
  if (event.key === "ArrowUp") { event.preventDefault(); (event.target.previousElementSibling ?? query).focus(); }
});
dialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault();
    dialog.close();
  }
});
dialog.addEventListener("close", () => { ++searchVersion; clearTimeout(searchTimer); editor.focus(); });
window.addEventListener("focus", () => { if (!dialog.open) editor.focus(); });

document.addEventListener("keydown", (event) => {
  if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === "n" || key === "k") {
    event.preventDefault();
    if (busy) return;
    if (key === "n") openNote(); else openSearch();
  }
});

async function start() {
  await listen("qmem-hide", () => action(async () => {
    await autosave.flush();
    await invoke("finish_hide");
  }));
  await listen("qmem-open", () => action(async () => {
    editor.value = await autosave.open();
    dialog.close();
    await invoke("show_editor");
  }));
  await listen("qmem-close", () => action(async () => {
    await autosave.flush();
    await invoke("finish_exit");
  }));
  await invoke("ready");
  editor.focus();
}
start().catch(reportError);
