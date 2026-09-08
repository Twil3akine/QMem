setTimeout(async () => {
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const editor = document.querySelector("#editor");
  const query = document.querySelector("#query");
  const dialog = document.querySelector("dialog");
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
      query.value = "needle"; query.dispatchEvent(new Event("input"));
      await waitFor(() => document.querySelector("#results button"), "full body search");
      check(document.querySelectorAll("#results button").length === 1, "one match");
      document.querySelector("#results button").click();
      await waitFor(() => !dialog.open && editor.value.includes("needle"), "open past note");
      type("過去メモの再編集");
      await waitFor(async () => (await notes())[0]?.body === "過去メモの再編集", "edit past note");
      check((await notes()).length === 1, "same record");
    }
    type("終了直前の本文");
    // Native CloseRequested / ExitRequested must flush the pending debounce.
    await invoke("smoke_done", { result: "ok" });
  } catch (error) {
    await invoke("smoke_done", { result: String(error.stack ?? error) });
  }
}, 100);
