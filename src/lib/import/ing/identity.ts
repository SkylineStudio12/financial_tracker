/**
 * Import identity resolution — the Stage-4 answer to L-0010 and the
 * REFLESS-ROW IDENTITY CONSTRAINT (docs/parked-plan.md).
 *
 * Two-class external_ref:
 * - Ref-bearing rows (6/17 in the fixture) use the ING long bank reference,
 *   raw — the Stage-1 design, unchanged.
 * - Refless rows (POS, fees, the revenue credit) get a SYNTHETIC,
 *   STATEMENT-SCOPED key: ING:{accountIban}:{statementNumber}:{lineNo}.
 *
 * Why this and not a content composite or the fallback identifiers:
 * - Position-aware by construction: lineNo is unique within one statement,
 *   so the twin fees (1476/1479 — identical on every content field) stay
 *   distinct. Fee rows have NOTHING content-based; position is all there is.
 * - Deterministic across re-imports of the SAME document (the actual dedup
 *   scenario): same statement number + same lineNos → same keys → the
 *   partial unique index dedups with no new machinery.
 * - No new stability assumptions (L-0010): auth codes / internal refs are
 *   unverified for uniqueness and stay forensic metadata in the inbox
 *   payload, not keys.
 *
 * KNOWN LIMIT (stated, not hidden): a refless row reappearing in a
 * DIFFERENT, overlapping statement export gets a different key and cannot
 * hard-dedup. That case is handled at the batch level (overlap-suspect
 * flagging — see the import actions), never silently.
 */
import { IngParseError, type IngStatement, type IngStatementRow } from "./types";

/** "Nr.6 / 30.06.2026" → "Nr.6/30.06.2026" (whitespace is print layout,
 * not identity — normalize it so re-extractions agree). */
export function normalizeStatementNumber(statementNumber: string): string {
  return statementNumber.replace(/\s+/g, "");
}

/** The import identity for one row: the long bank reference where the bank
 * printed one, else the synthetic statement-scoped key. */
export function resolveExternalRef(row: IngStatementRow, stmt: IngStatement): string {
  if (row.bankReference) return row.bankReference;
  return `ING:${stmt.accountIban}:${normalizeStatementNumber(stmt.statementNumber)}:${row.lineNo}`;
}

const PERIOD_RANGE = /^(\d{2})(?:\.(\d{2})\.(\d{4}))?\s*-\s*(\d{2})\.(\d{2})\.(\d{4})$/;

/**
 * The printed period ("01 - 30.06.2026", short form shares the end's
 * month/year) as ISO dates — the batch-overlap check needs real dates.
 * Throws on anything unrecognized rather than guessing a window.
 */
export function parseStatementPeriod(period: string): { start: string; end: string } {
  const m = period.trim().match(PERIOD_RANGE);
  if (!m) throw new IngParseError(`Unrecognized statement period: "${period}"`);
  const [, startDay, startMonth, startYear, endDay, endMonth, endYear] = m;
  return {
    start: `${startYear ?? endYear}-${startMonth ?? endMonth}-${startDay}`,
    end: `${endYear}-${endMonth}-${endDay}`,
  };
}
