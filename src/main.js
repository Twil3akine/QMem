import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Autosave } from "./autosave.js";
import { formatShortcut, matchesShortcut, shortcutFromEvent } from "./shortcuts.js";
import { isNewerVersion } from "./updates.js";
import "./style.css";

// 画面はメモ本文、検索ダイアログ、エラー表示の3要素で構成する。
const editor = document.querySelector("#editor");
const dialog = document.querySelector("#search-dialog");
const query = document.querySelector("#query");
const results = document.querySelector("#results");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsClose = document.querySelector("#settings-close");
const shortcutHelp = document.querySelector("#shortcut-help");
const shortcutInputs = [...document.querySelectorAll(".shortcut-input")];
const fontSize = document.querySelector("#font-size");
const fontSizeValue = document.querySelector("#font-size-value");
const autostart = document.querySelector("#autostart");
const menuBarMode = document.querySelector("#menu-bar-mode");
const settingsStatus = document.querySelector("#settings-status");
const checkUpdate = document.querySelector("#check-update");
const updateResult = document.querySelector("#update-result");
const openReleases = document.querySelector("#open-releases");
const error = document.querySelector("#error");
let busy = false;
let searchVersion = 0;
let searchTimer;
let settings;

// 保存と読み込みのエラーは本文を消さず、画面下部に通知する。
function reportError(cause) {
  error.textContent = `保存・読み込みに失敗しました。内容を残したまま再試行できます。${String(cause)}`;
  error.hidden = false;
}

// 実際の永続化はRust側のsave_noteコマンドに任せる。
const autosave = new Autosave(async (id, body) => {
  const result = await invoke("save_note", { id, body });
  error.hidden = true;
  return result;
}, reportError);

editor.addEventListener("input", () => autosave.update(editor.value));

// メモ移動と終了処理を直列化し、保存に失敗した本文を破棄しないようにする。
let actions = Promise.resolve();
function action(work) {
  actions = actions.then(async () => {
    busy = true;
    editor.readOnly = true;
    autosave.update(editor.value);
    try { await work(); } catch (cause) { reportError(cause); }
    finally { busy = false; editor.readOnly = false; if (!dialog.open && !settingsDialog.open) editor.focus(); }
  });
  return actions;
}

// 現在の本文を保存してから、指定された過去メモまたは新規メモへ切り替える。
function openNote(note) {
  return action(async () => {
    editor.value = await autosave.open(note);
    dialog.close();
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}

async function search() {
  // 入力のたびに世代番号を進め、遅れて返った古い検索結果を画面へ反映しない。
  const version = ++searchVersion;
  try {
    const notes = await invoke("search_notes", { query: query.value });
    if (version !== searchVersion || !dialog.open) return;
    results.replaceChildren();
    if (!notes.length) { results.textContent = "メモが見つかりません"; return; }
    // 本文の1行目だけをタイトルとして表示し、続きがあることは省略記号で示す。
    for (const note of notes) {
      const button = document.createElement("button");
      const time = document.createElement("time");
      time.dateTime = new Date(note.created_at).toISOString();
      time.textContent = new Date(note.created_at).toLocaleString();
      const preview = document.createElement("span");
      const firstLine = note.body.split(/\r?\n/, 1)[0];
      const title = firstLine.slice(0, 140);
      preview.textContent = title + (note.body.length > title.length ? "..." : "");
      button.append(time, preview);
      button.addEventListener("click", () => { if (!busy) openNote(note); });
      results.append(button);
    }
  } catch (cause) { if (version === searchVersion) reportError(cause); }
}

function openSearch() {
  return action(async () => {
    // 検索に入る前の入力も検索対象になるよう、保留中の保存を完了させる。
    await autosave.flush();
    query.value = "";
    // ダイアログが静止中のポインター下へ開いても、検索結果を選択済みに見せない。
    dialog.classList.add("suppress-hover");
    if (settingsDialog.open) settingsDialog.close();
    dialog.showModal();
    query.focus();
    await search();
  });
}

function applySettings(value) {
  document.documentElement.style.setProperty("--editor-font-size", `${value.font_size}px`);
  fontSize.value = String(value.font_size);
  fontSizeValue.value = `${value.font_size}px`;
  menuBarMode.checked = value.menu_bar_mode;
  for (const input of shortcutInputs) input.textContent = formatShortcut(value[input.dataset.shortcut]);
}

async function persistSettings(next) {
  const previous = settings;
  settings = next;
  applySettings(settings);
  shortcutHelp.textContent = "変更する項目を押して、キーを入力します。";
  shortcutHelp.classList.remove("error");
  try {
    await invoke("save_app_settings", { settings });
  } catch (cause) {
    settings = previous;
    applySettings(settings);
    shortcutHelp.textContent = String(cause);
    shortcutHelp.classList.add("error");
  }
}

function openSettings() {
  return action(async () => {
    await autosave.flush();
    if (dialog.open) dialog.close();
    settingsDialog.showModal();
    shortcutInputs[0].focus();
  });
}

for (const input of shortcutInputs) {
  input.addEventListener("click", () => {
    input.classList.add("recording");
    input.textContent = "キーを入力";
    shortcutHelp.textContent = "Escで変更をキャンセルします。";
    shortcutHelp.classList.remove("error");
  });
  input.addEventListener("blur", () => {
    input.classList.remove("recording");
    if (settings) input.textContent = formatShortcut(settings[input.dataset.shortcut]);
  });
  input.addEventListener("keydown", async (event) => {
    if (!input.classList.contains("recording")) return;
    event.preventDefault();
    event.stopPropagation();
    const shortcut = shortcutFromEvent(event);
    if (shortcut === null) { input.blur(); input.focus(); return; }
    if (!shortcut) return;
    if (Object.entries(settings).some(([name, value]) => name !== input.dataset.shortcut && name.endsWith("_shortcut") && value === shortcut)) {
      shortcutHelp.textContent = "同じショートカットは複数の操作に設定できません。";
      shortcutHelp.classList.add("error");
      return;
    }
    input.classList.remove("recording");
    await persistSettings({ ...settings, [input.dataset.shortcut]: shortcut });
  });
}

fontSize.addEventListener("input", () => {
  const value = Number(fontSize.value);
  document.documentElement.style.setProperty("--editor-font-size", `${value}px`);
  fontSizeValue.value = `${value}px`;
});
fontSize.addEventListener("change", () => persistSettings({ ...settings, font_size: Number(fontSize.value) }));
settingsClose.addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("click", (event) => { if (event.target === settingsDialog) settingsDialog.close(); });
settingsDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.isComposing && !document.activeElement?.classList.contains("recording")) {
    event.preventDefault();
    settingsDialog.close();
  }
});
settingsDialog.addEventListener("close", () => editor.focus());
autostart.addEventListener("change", async () => {
  const enabled = autostart.checked;
  autostart.disabled = true;
  settingsStatus.hidden = true;
  try {
    await invoke("set_autostart", { enabled });
  } catch (cause) {
    autostart.checked = !enabled;
    settingsStatus.textContent = `ログイン時起動を変更できませんでした。${String(cause)}`;
    settingsStatus.hidden = false;
  } finally {
    autostart.disabled = false;
  }
});
menuBarMode.addEventListener("change", () => persistSettings({ ...settings, menu_bar_mode: menuBarMode.checked }));
checkUpdate.addEventListener("click", async () => {
  checkUpdate.disabled = true;
  openReleases.hidden = true;
  updateResult.textContent = "更新を確認しています…";
  try {
    const [current, response] = await Promise.all([
      invoke("app_version"),
      fetch("https://api.github.com/repos/Twil3akine/QMem/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
      }),
    ]);
    if (!response.ok) throw new Error(`GitHubから応答を取得できませんでした（${response.status}）`);
    const release = await response.json();
    if (isNewerVersion(current, release.tag_name)) {
      updateResult.textContent = `QMem ${release.tag_name}を利用できます。`;
      openReleases.hidden = false;
    } else {
      updateResult.textContent = `最新版です（QMem v${current}）。`;
    }
  } catch (cause) {
    updateResult.textContent = `更新を確認できませんでした。${String(cause)}`;
  } finally {
    checkUpdate.disabled = false;
  }
});
openReleases.addEventListener("click", () => openUrl("https://github.com/Twil3akine/QMem/releases"));

query.addEventListener("input", () => {
  // 連続入力中の検索回数を抑えるため、最後の入力から100ms後に検索する。
  ++searchVersion;
  results.replaceChildren();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 100);
});
query.addEventListener("keydown", (event) => {
  // 検索欄からキーボードだけで先頭の検索結果へ移動・決定できるようにする。
  if (!event.isComposing && ["ArrowDown", "Enter"].includes(event.key)) {
    event.preventDefault();
    const first = results.querySelector("button");
    if (event.key === "Enter") first?.click(); else first?.focus();
  }
});
results.addEventListener("keydown", (event) => {
  // 検索結果間を上下キーで移動し、先頭より上では検索欄へ戻す。
  if (event.key === "ArrowDown") { event.preventDefault(); event.target.nextElementSibling?.focus(); }
  if (event.key === "ArrowUp") { event.preventDefault(); (event.target.previousElementSibling ?? query).focus(); }
});
dialog.addEventListener("keydown", (event) => {
  // IMEの変換キャンセルに使われたEscapeではダイアログを閉じない。
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault();
    dialog.close();
  }
});
dialog.addEventListener("close", () => { ++searchVersion; clearTimeout(searchTimer); editor.focus(); });
dialog.addEventListener("pointermove", () => dialog.classList.remove("suppress-hover"));
window.addEventListener("focus", () => { if (!dialog.open) editor.focus(); });

// macOSのCmdと他OSのCtrlのどちらでも、新規メモと検索を操作できるようにする。
document.addEventListener("keydown", (event) => {
  if (event.isComposing || !settings || settingsDialog.open) return;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === ",") {
    event.preventDefault();
    if (!busy) openSettings();
    return;
  }
  if (matchesShortcut(event, settings.new_note_shortcut) || matchesShortcut(event, settings.search_shortcut)) {
    event.preventDefault();
    if (busy) return;
    if (matchesShortcut(event, settings.new_note_shortcut)) openNote(); else openSearch();
  }
});

async function start() {
  // ウィンドウを閉じる要求では、保存完了後にRust側へ非表示の許可を返す。
  await listen("qmem-hide", () => action(async () => {
    await autosave.flush();
    await invoke("finish_hide");
  }));
  // Dockからの再表示やグローバルショートカットでは、新しい空のメモを開く。
  await listen("qmem-open", () => action(async () => {
    editor.value = await autosave.open();
    dialog.close();
    await invoke("show_editor");
  }));
  // アプリ終了要求でも、保留中の入力を保存してから実際に終了する。
  await listen("qmem-close", () => action(async () => {
    await autosave.flush();
    await invoke("finish_exit");
  }));
  // イベント受信の準備後にRust側へ通知し、ウィンドウとショートカットを有効にする。
  const shortcutError = await invoke("ready");
  if (shortcutError) {
    error.textContent = shortcutError;
    error.hidden = false;
  }
  settings = await invoke("load_settings");
  applySettings(settings);
  autostart.checked = await invoke("autostart_enabled");
  editor.focus();
}
start().catch(reportError);
