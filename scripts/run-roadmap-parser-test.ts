/**
 * Unit tests for the roadmap markdown parser (src/lib/roadmap/parse.ts).
 * Pure functions only — no database, no environment. Run directly:
 *
 *   npx tsx scripts/run-roadmap-parser-test.ts
 *
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";
import {
  matchStatus,
  parseRoadmap,
  splitInlineCode,
} from "../src/lib/roadmap/parse";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const SAMPLE = `# Finance Tracker — Roadmap

Status board only. Decision detail lives in the parked plan
(\`finance-tracker-parked-plan.md\` in project knowledge).

Statuses: DONE · IN PROGRESS · NEXT · QUEUED · PARKED

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold + schema | DONE |
| 4 | Investments | PARTIAL (core built; CRUD-2 pending) |
| 5 | Reports | PARKED (machinery in place) |

## In progress

- Management UI unit: employees + salary profiles + category index +
  manage page (migration 0012). Checkpoint A approved 2026-07-17;
  implementation running.

## Next

1. Migration 0012 live apply
2. Cross-entity salary edit follow-up

## Queued

- Profile-scoped transaction visibility (\`cee14e1\`)
- Roadmap visualization page
`;

test("title and intro paragraphs", () => {
  const doc = parseRoadmap(SAMPLE);
  assert.equal(doc.title, "Finance Tracker — Roadmap");
  assert.equal(doc.intro.length, 2);
  assert.deepEqual(doc.intro[1], {
    kind: "paragraph",
    text: "Statuses: DONE · IN PROGRESS · NEXT · QUEUED · PARKED",
  });
  // Wrapped intro paragraph joins onto one line.
  assert.ok(
    doc.intro[0].kind === "paragraph" &&
      doc.intro[0].text.includes("parked plan (`finance-tracker-parked-plan.md`"),
  );
});

test("sections split on ## headings", () => {
  const doc = parseRoadmap(SAMPLE);
  assert.deepEqual(
    doc.sections.map((s) => s.heading),
    ["Phases", "In progress", "Next", "Queued"],
  );
});

test("phase table: header, rows, separator dropped", () => {
  const doc = parseRoadmap(SAMPLE);
  const table = doc.sections[0].blocks[0];
  assert.equal(table.kind, "table");
  if (table.kind !== "table") return;
  assert.deepEqual(table.header, ["#", "Phase", "Status"]);
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows[0], ["1", "Scaffold + schema", "DONE"]);
});

test("wrapped list item joins continuation lines", () => {
  const doc = parseRoadmap(SAMPLE);
  const list = doc.sections[1].blocks[0];
  assert.equal(list.kind, "list");
  if (list.kind !== "list") return;
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 1);
  assert.ok(
    list.items[0].includes(
      "category index + manage page (migration 0012). Checkpoint A approved",
    ),
  );
});

test("ordered list detected with numbering", () => {
  const doc = parseRoadmap(SAMPLE);
  const list = doc.sections[2].blocks[0];
  assert.equal(list.kind, "list");
  if (list.kind !== "list") return;
  assert.equal(list.ordered, true);
  assert.deepEqual(list.items, [
    "Migration 0012 live apply",
    "Cross-entity salary edit follow-up",
  ]);
});

test("malformed table rows tolerated, never thrown", () => {
  const doc = parseRoadmap(
    ["## Broken", "| a | b |", "|---|---|", "| only-one-cell |", "| x | y | extra | cells |", "not a pipe line"].join(
      "\n",
    ),
  );
  const table = doc.sections[0].blocks[0];
  assert.equal(table.kind, "table");
  if (table.kind !== "table") return;
  assert.deepEqual(table.rows[0], ["only-one-cell"]);
  assert.deepEqual(table.rows[1], ["x", "y", "extra", "cells"]);
  // Trailing non-table line survives as a paragraph.
  assert.deepEqual(doc.sections[0].blocks[1], { kind: "paragraph", text: "not a pipe line" });
});

test("empty and junk input never crash", () => {
  assert.deepEqual(parseRoadmap(""), { title: null, intro: [], sections: [] });
  // "####" once hung the parser (unconsumed line, infinite loop) — it must
  // come back as plain paragraph text.
  const junk = parseRoadmap("|||\n\n####\n- \n");
  assert.ok(Array.isArray(junk.sections));
  assert.ok(
    junk.intro.some((b) => b.kind === "paragraph" && b.text.includes("####")),
  );
});

test("second H1 falls through as a paragraph, not a new title", () => {
  const doc = parseRoadmap("# First\n\n# Second");
  assert.equal(doc.title, "First");
  assert.deepEqual(doc.intro, [{ kind: "paragraph", text: "Second" }]);
});

test("matchStatus: exact, with note, unknown, word boundary", () => {
  assert.deepEqual(matchStatus("DONE"), { status: "DONE", note: null });
  assert.deepEqual(matchStatus(" IN PROGRESS "), { status: "IN PROGRESS", note: null });
  assert.deepEqual(matchStatus("PARKED (machinery in place)"), {
    status: "PARKED",
    note: "(machinery in place)",
  });
  assert.equal(matchStatus("PARTIAL (core built; CRUD-2 pending)"), null);
  assert.equal(matchStatus("NEXTUP"), null);
  assert.equal(matchStatus(""), null);
});

test("splitInlineCode: balanced pairs and stray backticks", () => {
  assert.deepEqual(splitInlineCode("plain"), [{ code: false, text: "plain" }]);
  assert.deepEqual(splitInlineCode("see `cee14e1` commit"), [
    { code: false, text: "see " },
    { code: true, text: "cee14e1" },
    { code: false, text: " commit" },
  ]);
  // Unpaired backtick stays literal.
  assert.deepEqual(splitInlineCode("odd ` one"), [{ code: false, text: "odd ` one" }]);
  assert.deepEqual(splitInlineCode(""), []);
});

console.log(`\n${passed} tests passed`);
