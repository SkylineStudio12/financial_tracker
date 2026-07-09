/**
 * Enum-label completeness suite (i18n Stage 3b). Every enum value that
 * renders to a user must have a label in BOTH catalogs, and the catalogs
 * must not carry stale keys for removed values. Guards future enum
 * widenings (schema/enums.ts widenings are one-way in Postgres — see the
 * accountType comment there): widen the enum, and this test fails until
 * both catalogs learn the new label.
 * Run: npx tsx src/lib/enum-labels.test.ts
 */
import assert from "node:assert/strict";
import { accountType, taxRuleType, transactionKind } from "../db/schema/enums";
import en from "../../messages/en.json";
import ro from "../../messages/ro.json";

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const ENUMS: Array<{ key: keyof typeof en.enums; values: readonly string[] }> = [
  { key: "transactionKind", values: transactionKind.enumValues },
  { key: "accountType", values: accountType.enumValues },
  { key: "taxRuleType", values: taxRuleType.enumValues },
];

for (const { key, values } of ENUMS) {
  for (const [locale, catalog] of [["en", en], ["ro", ro]] as const) {
    const labels = catalog.enums[key] as Record<string, string>;
    const labelKeys = Object.keys(labels).sort();
    const enumValues = [...values].sort();
    assert.deepEqual(
      labelKeys,
      enumValues,
      `${locale}: enums.${key} keys must exactly match the schema enum values`,
    );
    for (const value of values) {
      assert.ok(labels[value].trim().length > 0, `${locale}: enums.${key}.${value} label is empty`);
      assert.notEqual(
        labels[value],
        value,
        `${locale}: enums.${key}.${value} label is the raw enum value`,
      );
    }
    ok(`${locale} enums.${key}: all ${values.length} values labeled, no extras, none raw`);
  }
}

console.log(`\nenum-labels.test: ${checks} checks passed`);
