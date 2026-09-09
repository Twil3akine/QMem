import { describe, expect, test } from "bun:test";
import { formatShortcut, matchesShortcut, shortcutFromEvent } from "./shortcuts.js";

describe("shortcuts", () => {
  test("records and formats a modified key", () => {
    expect(shortcutFromEvent({ key: " ", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false })).toBe("Option+Space");
    expect(shortcutFromEvent({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe("CommandOrControl+Shift+K");
    expect(shortcutFromEvent({ key: "˜", code: "KeyN", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false })).toBe("Option+N");
    expect(formatShortcut("CommandOrControl+Shift+K")).toBe("⌘ ⇧ K");
  });

  test("ignores modifier-only input and lets Escape cancel", () => {
    expect(shortcutFromEvent({ key: "Meta", metaKey: true, ctrlKey: false, altKey: false })).toBeUndefined();
    expect(shortcutFromEvent({ key: "Escape" })).toBeNull();
  });

  test("matches exact modifiers", () => {
    expect(matchesShortcut({ key: "n", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, "CommandOrControl+N")).toBe(true);
    expect(matchesShortcut({ key: "n", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, "CommandOrControl+N")).toBe(false);
    expect(matchesShortcut({ key: "˜", code: "KeyN", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false }, "Option+N")).toBe(true);
  });
});
