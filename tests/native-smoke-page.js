setTimeout(async () => {
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const editor = document.querySelector("#editor");
  const query = document.querySelector("#query");
  const dialog = document.querySelector("dialog");
  const settingsDialog = document.querySelector("#settings-dialog");
  const check = (value, message) => { if (!value) throw Error(message); };
  const waitFor = async (predicate, message) => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error(message);
  };
  const type = (body) => { editor.value = body; editor.dispatchEvent(new Event("input", { bubbles: true })); };
  const key = (value) => document.dispatchEvent(new KeyboardEvent("keydown", { key: value, metaKey: true, bubbles: true, cancelable: true }));
  const notes = () => invoke("search_notes", { query: "" });
  try {
    check(editor.value === "" && document.activeElement === editor, "startup blank and focused");
    key(",");
    await waitFor(() => settingsDialog.open, "Cmd+, opens settings");
    check(document.querySelectorAll(".shortcut-input").length === 3, "three configurable shortcuts");
    const newNoteShortcut = document.querySelector('[data-shortcut="new_note_shortcut"]');
    newNoteShortcut.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "N", code: "KeyN", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await waitFor(async () => (await invoke("load_settings")).new_note_shortcut === "CommandOrControl+Shift+N", "shortcut persists");
    check(newNoteShortcut.textContent === "⌘ ⇧ N", "updated shortcut is shown");
    newNoteShortcut.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", metaKey: true, bubbles: true, cancelable: true }));
    await waitFor(async () => (await invoke("load_settings")).new_note_shortcut === "CommandOrControl+N", "shortcut restores");
    const size = document.querySelector("#font-size");
    size.value = "20"; size.dispatchEvent(new Event("input", { bubbles: true })); size.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(async () => (await invoke("load_settings")).font_size === 20, "font size persists");
    check(getComputedStyle(editor).fontSize === "20px", "font size applies");
    size.value = "18"; size.dispatchEvent(new Event("change", { bubbles: true }));
    settingsDialog.close();
    await waitFor(() => document.activeElement === editor, "settings returns focus");
    const previous = await notes();
    // The second run verifies a fresh editor even when the database has a note.
    if (previous.length) {
      check(previous.length === 1 && previous[0].body === "終了直前の本文", "previous shutdown persisted");
      key("k");
      await waitFor(() => document.querySelector("#results button"), "search previous");
      document.querySelector("#results button").click();
      await waitFor(() => !dialog.open && editor.value === "終了直前の本文", "open previous");
    } else {
      type(" \n\t　"); key("n");
      await waitFor(() => editor.value === "", "new blank");
      check((await notes()).length === 0, "no empty rows");
      type("先頭\n本文末尾needle");
      await waitFor(async () => (await notes()).length === 1, "automatic save");
      type("先頭\n本文末尾needle 直前"); key("n");
      await waitFor(() => editor.value === "", "Cmd+N");
      check((await notes())[0].body.endsWith("直前"), "flush before new note");
      check(document.activeElement === editor, "focus after new");
      key("k");
      await waitFor(() => dialog.open && document.activeElement === query, "Cmd+K focus");
      check(getComputedStyle(query).borderRadius === "0px", "square search field");
      query.value = "needle"; query.dispatchEvent(new Event("input"));
      await waitFor(() => document.querySelector("#results button"), "full body search");
      check(document.querySelectorAll("#results button").length === 1, "one match");
      check(document.querySelector("#results span").textContent === "先頭...", "result shows only the first line");
      check(document.activeElement === query && dialog.classList.contains("suppress-hover"), "search opens without highlighting a result");
      dialog.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
      check(!dialog.classList.contains("suppress-hover"), "result hover enabled after pointer movement");
      query.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }));
      check(dialog.open, "IME Escape does not dismiss search");
      const queryClosed = new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
      query.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await queryClosed;
      await waitFor(() => !dialog.open && document.activeElement === editor && !editor.readOnly, "Escape from query returns focus");
      check(editor.value === "", "Escape preserves current note");
      key("k");
      await waitFor(() => dialog.open && document.querySelector("#results button"), "reopen after Escape");
      const result = document.querySelector("#results button");
      result.focus();
      const resultClosed = new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
      result.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await resultClosed;
      await waitFor(() => !dialog.open && document.activeElement === editor && !editor.readOnly, "Escape from result returns focus");
      check((await notes())[0].body.endsWith("直前"), "Escape preserves saved note");
      key("k");
      await waitFor(() => dialog.open && document.querySelector("#results button"), "reopen after result Escape");
      document.querySelector("#results button").click();
      await waitFor(() => !dialog.open && editor.value.includes("needle"), "open past note");
      type("過去メモの再編集");
      await waitFor(async () => (await notes())[0]?.body === "過去メモの再編集", "edit past note");
      check((await notes()).length === 1, "same record");
    }
    type("終了直前の本文");
    // CloseRequested hides after saving; the native harness then reopens via the Dock handler.
    const mode = await invoke("smoke_done", { result: "ok" });
    if (mode === "window") {
      await waitFor(() => editor.value === "" && document.activeElement === editor && !editor.readOnly, "fresh focused note after reopening");
      check((await notes())[0].body === "終了直前の本文", "hide persisted final input");
      await invoke("smoke_done", { result: "reopened" });
    }
  } catch (error) {
    await invoke("smoke_done", { result: `${String(error)}\n${error.stack ?? ""}` });
  }
}, 100);
