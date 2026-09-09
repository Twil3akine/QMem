const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);

export function shortcutFromEvent(event) {
  if (event.key === "Escape") return null;
  if (MODIFIER_KEYS.has(event.key) || !(event.metaKey || event.ctrlKey || event.altKey)) return undefined;
  const parts = [];
  if (event.metaKey || event.ctrlKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Option");
  if (event.shiftKey) parts.push("Shift");
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...parts, key].join("+");
}

export function matchesShortcut(event, shortcut) {
  const parts = shortcut.split("+");
  const key = parts.at(-1);
  const command = parts.includes("CommandOrControl");
  const option = parts.includes("Option");
  const shift = parts.includes("Shift");
  const eventKey = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return eventKey === key
    && (event.metaKey || event.ctrlKey) === command
    && event.altKey === option
    && event.shiftKey === shift;
}

export function formatShortcut(shortcut) {
  return shortcut.split("+").map((part) => ({
    CommandOrControl: "⌘",
    Option: "⌥",
    Shift: "⇧",
    Space: "Space",
  })[part] ?? part).join(" ");
}
