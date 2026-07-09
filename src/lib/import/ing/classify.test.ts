/**
 * Classifier tests against the REAL fixture (same as parse.test.ts).
 * Run: npx tsx src/lib/import/ing/classify.test.ts — exits non-zero on failure.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyStatementRows, type ClassifyReason, type ImportKind } from "./classify";
import { parseIngStatement } from "./parse";

const fixture = readFileSync(
  join(import.meta.dirname, "fixtures", "skyline-2026-06.txt"),
  "utf8",
);
const stmt = parseIngStatement(fixture);
const classified = classifyStatementRows(stmt.rows, { ownerNames: ["Grigore Filimon"] });
const byLineNo = new Map(classified.map((c) => [c.row.lineNo, c]));

let checks = 0;
function ok(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}
function expectKind(
  lineNo: string,
  kind: ImportKind,
  confidence: "high" | "low",
  reasonCode?: ClassifyReason["code"],
) {
  const c = byLineNo.get(lineNo);
  assert.ok(c, `row ${lineNo} missing`);
  assert.equal(c.kind, kind, `row ${lineNo}: expected ${kind}, got ${c.kind} (${c.reason.code})`);
  assert.equal(c.confidence, confidence, `row ${lineNo}: confidence ${c.confidence}, reason: ${c.reason.code}`);
  if (reasonCode) assert.equal(c.reason.code, reasonCode, `row ${lineNo}: reason code`);
}

/* ------------------------------------------------- every row, kind by kind */
ok("all 17 rows classified — nothing falls through", () => {
  assert.equal(classified.length, 17);
  for (const c of classified) {
    assert.notEqual(c.kind, undefined);
    assert.ok(c.reason.code.length > 0, `row ${c.row.lineNo} has no reason code`);
  }
});
ok("no row in the fixture is unknown (loud fallback unused here)", () => {
  assert.equal(classified.filter((c) => c.kind === "unknown").length, 0);
});
ok("revenue: HolyCode incoming credit", () => expectKind("1482", "revenue", "high", "incomingFundsCredit"));
ok("state payments: Trezorerie + CAM via treasury IBANs", () => {
  expectKind("1475", "state_payment", "high", "treasuryIban");
  expectKind("1478", "state_payment", "high", "treasuryIban");
});
ok("owner transfer: Grigore Filimon (context-supplied owner name)", () =>
  expectKind("1465", "owner_transfer", "high", "ownerNameMatch"));
ok("professional services, marked: Expert Contabil + AUDIT-EXPERT", () => {
  expectKind("1462", "professional_services", "high", "professionalMarker");
  expectKind("1466", "professional_services", "high", "professionalMarker");
});
ok("AMBIGUOUS by design — Coman Aktiv Serv SRL: professional_services at LOW", () =>
  expectKind("1464", "professional_services", "low", "businessTransferNoMarker"));
ok("subscriptions: OpenAI, Anthropic, Figma, Orange", () => {
  expectKind("1471", "subscription", "high", "knownRecurringMerchant");
  expectKind("1486", "subscription", "high", "knownRecurringMerchant");
  expectKind("1489", "subscription", "high", "knownRecurringMerchant");
  expectKind("1473", "subscription", "high", "knownRecurringMerchant");
});
ok("card purchases: Rompetrol high-signal POS, ORCT flagged LOW (state fee by card)", () => {
  expectKind("1461", "card_purchase", "low", "unrecognizedPos");
  expectKind("1481", "card_purchase", "low", "unrecognizedPos");
});
ok("bank fees: all four Service Fee rows", () => {
  for (const lineNo of ["1463", "1476", "1479", "1491"]) {
    expectKind(lineNo, "bank_fee", "high", "bankFeeNoCounterparty");
  }
});
ok("FX is a field, not a kind: subscriptions carry row.fx where foreign", () => {
  assert.ok(byLineNo.get("1471")!.row.fx); // OpenAI USD->EUR
  assert.ok(byLineNo.get("1486")!.row.fx); // Anthropic EUR
  assert.equal(byLineNo.get("1473")!.row.fx, null); // Orange is domestic RON
});

/* -------------------------------------- identity inventory (L-0010 material) */
ok("refless rows are exactly the POS + fees + revenue credit (11 of 17)", () => {
  const refless = classified.filter((c) => c.identity.bankReference === null);
  assert.equal(refless.length, 11);
  const kinds = new Set(refless.map((c) => c.kind));
  assert.deepEqual(
    [...kinds].sort(),
    ["bank_fee", "card_purchase", "revenue", "subscription"],
  );
});
ok("POS rows carry authCode + cardDate + masked card number as fallback identity", () => {
  const pos = classified.filter((c) => c.kind === "subscription" || c.kind === "card_purchase");
  assert.equal(pos.length, 6);
  for (const c of pos) {
    assert.ok(c.identity.authCode, `row ${c.row.lineNo} missing authCode`);
    assert.ok(c.identity.cardDate, `row ${c.row.lineNo} missing cardDate`);
    assert.equal(c.identity.cardNumber, "**** 3421");
    assert.equal(c.identity.hasAnyBankIssuedRef, false);
  }
  // card transaction date differs from book date — a real identity component
  assert.equal(byLineNo.get("1461")!.identity.cardDate, "2026-05-31");
  assert.equal(byLineNo.get("1461")!.row.bookDate, "2026-06-02");
});
ok("revenue credit has an internal reference as its only bank-issued ref", () => {
  const rev = byLineNo.get("1482")!;
  assert.equal(rev.identity.bankReference, null);
  assert.equal(rev.identity.internalReference, "954344576");
  assert.equal(rev.identity.hasAnyBankIssuedRef, true);
});
ok("transfer rows carry long ref + IBAN; instant transfer also instant ref", () => {
  const t = byLineNo.get("1462")!;
  assert.ok(t.identity.bankReference);
  assert.ok(t.identity.counterpartyIban);
  assert.equal(t.identity.instantReference, "1780914896626777164009");
});
ok("HARDEST CASE: fee rows have NO identity fields at all", () => {
  for (const lineNo of ["1463", "1476", "1479", "1491"]) {
    const id = byLineNo.get(lineNo)!.identity;
    assert.deepEqual(
      [id.bankReference, id.internalReference, id.instantReference, id.authCode, id.cardDate, id.cardNumber, id.counterpartyIban],
      [null, null, null, null, null, null, null],
      `fee row ${lineNo} unexpectedly has an identity field`,
    );
  }
});
ok("TWIN-FEE COLLISION (Stage-4 must handle): 1476 and 1479 are identical on date+amount+description", () => {
  const a = byLineNo.get("1476")!.row;
  const b = byLineNo.get("1479")!.row;
  assert.equal(a.bookDate, b.bookDate);
  assert.equal(a.amountMinor, b.amountMinor); // both -0.51 on 19.06
  assert.equal(a.description, b.description);
  // Only position-dependent facts distinguish them:
  assert.notEqual(a.lineNo, b.lineNo);
  assert.notEqual(a.balanceAfterMinor, b.balanceAfterMinor);
});

/* --------------------------------------------------------- context knobs */
ok("unknown is loud, not silent: a credit without markers classifies unknown/low", () => {
  const fake = { ...stmt.rows[0], direction: "credit" as const, rawLines: ["MYSTERY GMBH"], counterpartyName: "MYSTERY GMBH" };
  const [c] = classifyStatementRows([fake], { ownerNames: [] });
  assert.equal(c.kind, "unknown");
  assert.equal(c.confidence, "low");
});
ok("extraSubscriptionMerchants extends the built-in matcher set", () => {
  const orange = stmt.rows.find((r) => r.lineNo === "1461")!; // Rompetrol
  const [c] = classifyStatementRows([orange], {
    ownerNames: [],
    extraSubscriptionMerchants: [/ROMPETROL/i],
  });
  assert.equal(c.kind, "subscription");
});

console.log(`\nAll ${checks} checks passed.`);
