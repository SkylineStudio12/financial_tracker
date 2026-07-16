# Salary payment date + two-step modal - Checkpoint A

**Status:** Tier-3 Checkpoint A approved 2026-07-16. Implementation follows the
approved design and resolved payment-date default below. No booking or live-data
write is part of this unit. Checkpoint A and B review-log rows will land with
the future implementation commit per L-0019.

## 1. Current-state investigation

### 1.1 How the salary transaction date is constructed

`src/lib/ledger/flow-actions.ts` currently accepts only a pay `month`
(`YYYY-MM`). The private helper `monthEndDate(month)` validates the month,
calculates its final calendar day, and returns a `YYYY-MM-DD` string.

Both salary paths call that helper:

```ts
// previewSalary
const date = monthEndDate(payload.month);

// saveSalary
const date = monthEndDate(payload.month);
```

`saveSalary` then uses the same derived `date` for three distinct meanings:

1. it selects the date-active legacy `tax_rules` rows;
2. it derives `tax_accruals.year` and `tax_accruals.quarter`; and
3. it writes `transactions.date`.

```ts
const rules = await loadSalaryRuleIds(date);

year: yearOf(date),
quarter: quarterOf(date),

const input = {
  date,
  description: `Salary ${employee} ${payload.month}`,
  // ...
};
```

The ledger service receives only the resulting transaction date. It validates
the `YYYY-MM-DD` shape, uses it as the transaction's stored date, and would use
it for transaction-date FX resolution if a posting needed conversion. Salary
postings are all RON, so the current salary path creates no FX dependency.

### 1.2 How salary accrual periods are derived

Salary accrual year and quarter are currently derived from the synthetic
month-end transaction date:

```text
payload.month
  -> monthEndDate(month)
  -> date
  -> yearOf(date) / quarterOf(date)
  -> tax_accruals.year / tax_accruals.quarter
```

This happens to put June in Q2 while the transaction is also dated 30 June.
Once the transaction date becomes the real 10 July payment date, leaving this
code unchanged would incorrectly put June salary accruals in Q3.

The coupling also affects legacy rule identity. `loadSalaryRuleIds(date)`
currently resolves the rule IDs using the same month-end date. Even though the
payslip-entered flow does not read `rate_bps`, the accrual links should continue
to point at the rule rows active for the fiscal pay period, not rule rows that
became active by the later cash-payment date.

### 1.3 Downstream readers and assumptions

The following readers consume `transactions.date`:

- transaction list ordering and from/to filters;
- transaction-list date display;
- transaction-detail date display;
- repeat-last ordering (`transactions.date DESC`);
- salary edit reconstruction, which currently derives
  `month = transaction.date.slice(0, 7)`; and
- the ledger's general transaction-date validation and historical FX behavior.

Only the salary edit adapter explicitly assumes that transaction month equals
pay month. Repeat-last does not reconstruct the month directly, but it calls
that edit adapter and therefore inherits the same assumption.

Current reporting behavior:

- account balances and the household net-cash position sum live postings and
  do not derive a salary fiscal period from transaction date;
- the tax dashboard groups by the already stored `tax_accruals.year` and
  `tax_accruals.quarter`, not by transaction date;
- transaction list filters and ordering use transaction date. Under the new
  model this correctly becomes cash-payment chronology;
- transaction detail shows the transaction date. Under the new model this
  correctly becomes the payment date; and
- `src/db/verify-schema.ts` contains a synthetic salary-like schema check with
  a hardcoded date and quarter, but it is not a production report and does not
  infer one from the other.

No production dashboard or report was found that requires salary transaction
date to equal month-end. The only required read-path changes are salary
edit/repeat reconstruction and any labels that currently present the derived
date without distinguishing payment date from fiscal month.

### 1.4 Live salary history

Read-only inspection of live `financial_tracker` on 2026-07-16 found:

- salary transactions: 1 total, 0 live, 1 soft-deleted;
- transaction `552c06f3-3d51-4f41-a04a-fc4a638e150c`;
- stored date `2026-06-30`;
- description `Salary Maria Grigore 2026-06`;
- revision 1, created 2026-07-04, soft-deleted 2026-07-05;
- four current-revision accruals attributed to 2026 Q2; and
- no `salary_transaction_details` row.

This is consistent with the old month-end construction. It is not classified
or changed by this unit. There are no live salary rows whose display or
balances change when the new model ships.

The old row keeps its exact stored date. If it were restored and edited later,
the legacy adapter would prefill pay month `2026-06` and payment date
`2026-06-30`, making the old synthetic date visible rather than silently
inventing a historical cash date.

## 2. Settled semantic model

Salary carries two independent dates:

| Meaning | Input/storage | Drives |
|---|---|---|
| Pay month | `YYYY-MM`, stored as the first day of that month in salary metadata | fiscal year/quarter, legacy tax-rule identity, description |
| Payment date | real `YYYY-MM-DD`, stored as `transactions.date` | cash chronology, transaction list/filter/detail |

The invariant is:

```text
tax period = period(pay month)
transaction date = entered payment date
```

No code may derive salary accrual year, accrual quarter, or salary rule identity
from the payment date.

For June 2026 paid on 10 July 2026:

```text
pay month       2026-06
payment date    2026-07-10
transaction     dated 2026-07-10
accrual period  2026 Q2
rule anchor     2026-06-30
```

## 3. Durable pay-month storage

`transactions.date` cannot continue doubling as pay month. The existing
revision-keyed `salary_transaction_details` table is the correct ownership
boundary because pay month is salary-only metadata and must follow CRUD
revision history.

The implementation unit should generate migration `0011` adding:

```text
salary_transaction_details.pay_month DATE NOT NULL
```

Storage convention: `2026-06` is stored as `2026-06-01`. Add a database check
that the stored date is the first day of its month. TypeScript/UI payloads use
the semantic `YYYY-MM` value; the write path canonicalizes it to the first-day
DATE representation.

The column is revision-keyed with the existing detail row:

- create writes deduction + pay month at revision 1;
- edit appends both values for the new revision;
- soft-delete/restore leave the detail untouched;
- purge removes it through the existing cascade; and
- `snapshotTransaction` already selects the full detail row, so the new column
  enters audit snapshots without a second dependent-row query.

There is no legacy-row backfill. Live currently has zero detail rows and the
only historical salary has no detail row. Before applying `0011` to live, the
separate migration-apply gate must reconfirm `salary_transaction_details` is
still empty. If it is not empty, apply stops for owner review; implementation
must not silently infer or backfill pay months.

Legacy salary transactions without a detail row remain representable through
the read fallback in section 6. They are not modified by the migration.

## 4. Payment-date entry and validation

`SalaryFlowPayload` gains:

```ts
payMonth: string;    // YYYY-MM
paymentDate: string; // YYYY-MM-DD
```

The existing ambiguous `month` field should be renamed to `payMonth` through
the salary UI/action/draft types. Database storage remains as described above.

Server-side validation runs in both preview and save:

- `payMonth` must be a real `YYYY-MM` month;
- `paymentDate` must match `YYYY-MM-DD`;
- parsing `paymentDate` at UTC midnight and formatting it back must reproduce
  the same string, rejecting values such as `2026-02-30`;
- no relationship restriction is imposed between payment date and pay month;
- payment is not restricted to the 10th; and
- the existing positive amounts and exact net identity remain unchanged.

The ledger service's global date rules are not widened in this unit. The salary
action performs strict calendar validation before delegating to the unchanged
single transaction write path.

Add a distinct code-only error:

```text
flows.invalidPaymentDate
```

with the attempted date as a parameter. It is added to `ERROR_CODES` and both
`errors.flows` catalogs, retaining compile-time catalog completeness.
`flows.invalidMonth` continues to cover the pay-month field.

### Resolved default - owner approved 2026-07-16

Default payment date to the 10th of the month following the selected pay
month. This matches the first real payslip while remaining only a prefill,
never a validation rule.

Examples:

```text
pay month 2026-06 -> default payment date 2026-07-10
pay month 2026-12 -> default payment date 2027-01-10
```

While creating a salary, changing pay month updates this default only until the
owner manually edits the payment-date field. Once touched, the field is never
overwritten automatically. Edit and repeat-last always use stored values and do
not invoke the default.

## 5. Accrual and rule derivation

Replace the overloaded month-end helper with an explicit fiscal-period helper:

```ts
salaryPeriod(payMonth) -> {
  anchorDate, // last day of pay month, for legacy tax-rule window lookup
  year,
  quarter,
}
```

`saveSalary` then has two named dates:

```ts
const period = salaryPeriod(payload.payMonth);
const paymentDate = validatePaymentDate(payload.paymentDate);

const rules = await loadSalaryRuleIds(period.anchorDate);

const accruals = taxLegs.map((leg, index) => ({
  postingIndex: 2 + index,
  taxRuleId: leg.rule.id,
  year: period.year,
  quarter: period.quarter,
}));

const input = {
  date: paymentDate,
  description: `Salary ${employee} ${payload.payMonth}`,
  // unchanged seven postings and four accruals
  salaryDetail: {
    payMonth: payload.payMonth,
    personalDeductionMinor: payload.personalDeductionMinor,
  },
};
```

`previewSalary` returns and displays payment date, pay month, and the derived
accrual year/quarter. Save recomputes all three server-side; preview is not
trusted as write authorization.

This changes no accrual amount, posting amount, account, category, or
`tax_rule_id` model. It only selects the existing rule IDs and fiscal period
from the correct driving input.

## 6. Repeat-last and edit behavior

### Repeat last

The latest salary should mean the latest fiscal pay month, not whichever cash
payment happened latest. `getLastCompleteSalaryDraft` therefore orders by:

1. stored `pay_month` descending;
2. transaction payment date descending; and
3. creation timestamp descending.

For a detail row created before `pay_month` exists, SQL may fall back to the
month containing `transactions.date`. Salary rows with no detail row remain
excluded from repeat-last because their deduction is unknown, unchanged from
the approved payslip-entered flow.

Repeat-last copies all stored values exactly, including pay month and payment
date. It does not advance either date or invoke the create-form default. The
owner edits the copied period/date before confirming, avoiding silent invented
dates.

### Edit

For new-model rows:

- pay month comes from current-revision `salary_transaction_details.pay_month`;
- payment date comes from `transactions.date`; and
- save appends both values in the new revision detail.

For legacy rows without a detail:

- payment date prefills from the exact stored `transactions.date`;
- pay month falls back to `transactions.date.slice(0, 7)`, because the old
  salary flow's enforced invariant was month-end-of-pay-month;
- deduction remains blank, as already designed; and
- nothing is written until the owner supplies the missing value and saves.

No month is parsed from the English transaction description. The fallback is
based on the old write invariant, not prose.

## 7. Two-step modal and entry points

### Modal shell

Reuse the existing Base UI/shadcn `Dialog` pattern demonstrated in
`src/app/dev/components/gallery.tsx` and used by
`src/components/new-transaction-dialog.tsx`:

- existing semantic tokens, scrim, radius, and shadow;
- `DialogContent` with `density-compact`, `sm:max-w-xl`,
  `max-h-[90vh]`, and vertical overflow;
- existing focus trap, Escape behavior, close button, and focus rings;
- existing dirty-form discard confirmation;
- refresh only in `onOpenChangeComplete` after save, per L-0004; and
- no new design tokens or new modal primitive.

Extend `NewTransactionDialog` with a company-only `salary` type rather than
creating a second competing transaction-entry shell. It receives the existing
form options plus the personal accounts already loaded by `getFlowPageData`.

### Step 1 - Enter payslip

Displays editable:

- employee;
- pay month;
- payment date;
- gross, CAS, CASS, income tax, CAM, net, personal deduction; and
- recipient personal account.

`Continue` calls `previewSalary`. Client parsing may disable Continue for
obviously incomplete fields, but server validation is authoritative. Preview
performs no write.

### Step 2 - Review and confirm

Displays a read-only summary with two separate date rows:

- fiscal pay month and derived accrual period; and
- cash payment / transaction date.

It also displays the entered amounts and existing additive summaries.

Actions:

- `Back` returns to step 1 with every value preserved;
- `Confirm and save` calls `saveSalary`; and
- closing a dirty modal follows the existing discard-confirmation behavior.

Save repeats date, amount, and net-identity validation before any write. A
failed save remains on step 2 with the translated error visible. Only a
successful confirm closes and refreshes the transaction list.

The same two-step `SalaryFlow` component is used inside the existing
transaction-row edit dialog. Editing therefore gains the same review step
without adding another modal layer.

### Route and navigation changes

The transaction list remains the host screen:

- add `salary` as a selectable type in `NewTransactionDialog` for company
  profiles;
- the sidebar `New salary` entry links to
  `/p/<company>/transactions?entry=salary`;
- the transactions page opens the existing dialog with salary selected when
  that query is present;
- closing the route-opened dialog removes only `entry=salary` via
  `router.replace`, preserving any unrelated filters; and
- the old `/p/<company>/flows/salary` route becomes a server redirect to that
  transaction-list modal URL, preserving bookmarks without rendering a full
  salary page.

Dividend flow is unchanged and remains outside this unit.

## 8. Catalog work

Expected catalog additions in both EN and RO:

- payment-date field label;
- explicit pay-month label if the existing generic `month` label is not clear
  enough;
- entry/review step labels;
- fiscal-period and payment-date preview labels;
- Back action if no suitable shared key exists; and
- `errors.flows.invalidPaymentDate`.

All additions follow the current `flows.*` and `errors.flows.*` namespaces.
Catalog parity and cache-cleared TypeScript key completeness are mandatory at
Checkpoint B.

## 9. Verification plan

All write fixtures run through the isolated salary runner against
`TEST_DATABASE_URL`, require the `_test` suffix and live-URL separation, and
leave zero residue.

1. **June paid in July:** pay month `2026-06`, payment date `2026-07-10`.
   Assert `transactions.date = 2026-07-10`,
   detail `pay_month = 2026-06-01`, and all four accruals are `2026 Q2`.
   Assert the linked legacy rule IDs are those active at the June fiscal
   anchor, not rules selected from 10 July.
2. **Year boundary:** pay month `2026-12`, payment date `2027-01-10`.
   Assert transaction year 2027 but all four accruals are `2026 Q4`, and rule
   identity resolves from December 2026.
3. **Real-date validation:** `2026-02-30` fails in preview and save with
   `flows.invalidPaymentDate`; transaction, posting, accrual, detail, and audit
   write deltas are all zero.
4. **No artificial payment rule:** a valid date that is not the 10th and is
   not exactly one month later is accepted; only calendar validity is judged.
5. **Default behavior:** if the recommended default is approved, pure fixtures
   prove June -> 10 July and December -> 10 January, plus touched-date
   preservation when pay month changes.
6. **Repeat-last:** two salaries whose payment order differs from fiscal-period
   order prove selection by latest pay month. Prefill returns the exact stored
   pay month and payment date.
7. **Legacy edit fallback:** a no-detail salary dated at month-end prefills pay
   month from that date, payment date exactly, and blank deduction; save creates
   a new detail with explicit pay month without changing prior revision rows.
8. **Two-step write boundary:** entering and previewing cause zero writes;
   Back preserves all values; only Confirm creates the transaction.
9. **Booking regression:** the canonical 4,500 RON fixture retains exactly
   seven postings, four accrual links, entered amounts, and RON zero-sum.
10. **Lifecycle regression:** edit revisioning, soft-delete, exact restore, and
    purge preserve/remove the expanded salary detail exactly as before.
11. **Route/modal behavior:** salary sidebar URL opens the transaction-list
    modal on step 1; Continue reaches step 2; closing removes the query; old
    full-page URL redirects; browser console remains clean.

Checkpoint B also reruns the existing salary, CRUD, reversal, tax, and service
batteries; catalog parity; cache-cleared `tsc --noEmit`; changed-file eslint;
G1-G4; route/browser checks; and `next build`.

## 10. Scope and invariants

Expected implementation scope:

- salary payload, preview/save period derivation, edit/repeat adapters;
- salary detail schema plus one generated migration for durable pay month;
- salary form's two-step state and dirty-state reporting;
- extension of the existing new-transaction dialog for company salary entry;
- salary sidebar/full-route handoff to the transaction-list modal;
- typed error and EN/RO catalog additions;
- isolated fixtures and affected characterizations; and
- this design doc plus A/B review-log rows at commit time.

Explicitly out of scope:

- booking the real June 2026 salary;
- modifying, restoring, deleting, or backfilling any legacy salary row;
- changing any entered salary amount or tax formula;
- changing the seven posting legs or four accrual links;
- changing dividend behavior;
- changing `tax_config`, its seed, or legacy `tax_rules` data;
- changing general ledger date validation for non-salary transactions; and
- introducing new modal primitives or design tokens.

Tier-3 invariants touched at implementation:

- payment date stored as transaction date;
- fiscal accrual period driven only by pay month;
- legacy rule identity driven by the pay-period anchor;
- integer minor units and exact net identity;
- seven-leg RON zero-sum and four accrual links;
- single `createTransaction` / `updateTransaction` write path;
- revision-keyed dependent salary metadata;
- soft-delete/restore/purge behavior; and
- locale-free typed errors translated at the edge.

Checkpoint B must show the full diff and all fixture values before any commit.
