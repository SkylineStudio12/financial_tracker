import assert from "node:assert/strict";
import test from "node:test";
import { transactionCategoryDisplay } from "./category-display";

test("category display prioritizes genuine categories over liability descriptors", () => {
  assert.deepEqual(
    transactionCategoryDisplay({
      splitCount: null,
      category: "Revenue",
      hasTaxLiabilityLeg: true,
      kind: "standard",
    }),
    { type: "category" },
  );
});

test("category display labels uncategorized liability rows as tax settlements", () => {
  assert.deepEqual(
    transactionCategoryDisplay({
      splitCount: null,
      category: null,
      hasTaxLiabilityLeg: true,
      kind: "standard",
    }),
    { type: "tax_settlement" },
  );
});

test("category display never exposes standard as a kind fallback", () => {
  assert.deepEqual(
    transactionCategoryDisplay({
      splitCount: null,
      category: null,
      hasTaxLiabilityLeg: false,
      kind: "standard",
    }),
    { type: "empty" },
  );
  assert.deepEqual(
    transactionCategoryDisplay({
      splitCount: null,
      category: null,
      hasTaxLiabilityLeg: false,
      kind: "transfer",
    }),
    { type: "kind", kind: "transfer" },
  );
});
