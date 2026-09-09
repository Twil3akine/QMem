import { expect, test } from "bun:test";
import { isNewerVersion } from "./updates.js";

test("compares release versions", () => {
  expect(isNewerVersion("1.1.0", "v1.2.0")).toBe(true);
  expect(isNewerVersion("1.1.0", "v1.1.0")).toBe(false);
  expect(isNewerVersion("1.1.0", "v1.0.9")).toBe(false);
  expect(isNewerVersion("1.1.0", "unknown")).toBe(false);
});
