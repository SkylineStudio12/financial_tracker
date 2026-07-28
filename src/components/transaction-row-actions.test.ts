import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("transaction edit resets mounted draft state on every open", () => {
  const source = readFileSync(
    new URL("./transaction-row-actions.tsx", import.meta.url),
    "utf8",
  );
  const loadEdit = source.slice(
    source.indexOf("const loadEdit = () =>"),
    source.indexOf("const saved = () =>"),
  );
  assert.ok(loadEdit.indexOf("setDraft(null)") < loadEdit.indexOf("setEditOpen(true)"));
  assert.ok(loadEdit.indexOf("setDraft(null)") < loadEdit.indexOf("loadTransactionEditDraftAction("));
});
