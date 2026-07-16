# Salary flow: payslip-entered values - Checkpoint A

**Status:** Tier-3 Checkpoint A proposed 2026-07-16. No implementation,
migration, seed, or live-data write has started. Checkpoint A and B review-log
rows land with the future implementation commit per L-0019.

## 1. Settled behavior and current boundary

The accountant's monthly payslip is the authoritative source for salary tax
figures. The application transcribes and books those figures; it does not
calculate whether they are legally correct.

The existing salary flow is already live at:

- `src/app/p/[profile]/flows/salary/page.tsx`;
- `src/components/flows/salary-flow.tsx`; and
- `src/lib/ledger/flow-actions.ts`.

Today that flow accepts gross salary only, loads rates from legacy `tax_rules`,
and calls `computeSalary`. This unit replaces that live behavior. It does not
replace `tax_rules`: the four `tax_accruals` still reference those rows, so the
flow continues resolving the date-active rule IDs but does not read their rates
for salary arithmetic.

The temporal `tax_config` salary calculator is not integrated with the live
flow today and will not be integrated. `tax_config`, its enums, and its live
empty state are unchanged by this unit. Dividend/investment use remains a
separate future concern.

## 2. Inputs and structural validation

`SalaryFlowPayload` changes from gross-only to the following integer-minor-unit
RON values:

- employee name;
- pay month;
- recipient personal account;
- gross;
- CAS;
- CASS;
- income tax (`impozit`);
- CAM;
- net; and
- personal deduction.

The UI parses every money field with the existing locale-aware amount parser.
The server accepts only safe integer minor units. Gross, CAS, CASS, income tax,
CAM, and net must be positive because each produces or determines a posting and
the shared ledger service rejects zero-value postings. Personal deduction may
be zero because it produces no posting.

The only arithmetic validity rule owned by the salary flow is:

```text
net = gross - CAS - CASS - income tax
```

Equality is exact in bani. A mismatch returns a typed, locale-free error and
books nothing. CAM is deliberately absent from this identity because it is an
employer-side contribution. No percentage, deduction formula, taxable-base
formula, threshold, or tax reasonableness check runs.

The existing preview step remains as a transcription review: it echoes the
entered values and may display additive summaries such as employer cost and
total accrued. It does not suggest or replace any entered tax figure.

### Zero-value representability

The settled seven-leg shape and the existing `createTransaction` invariant
both require non-zero posting amounts. Therefore a payslip containing a zero
CAS, CASS, income-tax, CAM, or net figure cannot be represented by this exact
shape and is rejected as structurally unsupported. This is a ledger
representability boundary, not a judgment that the payslip is incorrect.
The owner accepts this boundary; if a real payslip with a zero leg-bearing
value ever arrives, it triggers a separate variable-leg follow-up unit using
that payslip as its fixture.

## 3. Revision-aware payslip metadata

Gross, CAS, CASS, income tax, CAM, and net are recoverable exactly from the
stored current-revision postings and accrual links. Duplicating them in a
metadata blob would create two sources of truth. Personal deduction has no
posting, so it needs one durable dependent row.

Add migration `0010` with:

```text
salary_transaction_details
  transaction_id                 uuid, FK transactions(id) ON DELETE CASCADE
  revision                       integer, required
  personal_deduction_minor       bigint, required, >= 0
  created_at                     timestamptz, required
  PRIMARY KEY (transaction_id, revision)
```

The table is append-only by transaction revision:

- create inserts revision 1;
- edit inserts the new revision and retains the prior row for audit history;
- soft-delete does not alter it;
- exact restore continues to use the same current-revision row;
- purge removes it through the transaction foreign-key cascade.

`TransactionInput` gains a salary-only detail value. The ledger service
validates that it appears only with `kind: "salary"` and inserts it inside the
same database transaction as the transaction, postings, accruals, and audit
row. `snapshotTransaction` includes the current salary detail so update/delete
audit snapshots account for the dependent structure per L-0012.

There is no migration backfill. Existing salary transactions have no honest
stored deduction and must not be assigned one by inference.

## 4. Booking plan

`saveSalary` still resolves:

- the company bank account;
- the selected household/personal account;
- the company tax-liability account;
- the company equity account;
- the optional `Salaries` category; and
- the four date-active legacy rule rows: `salary_cas`, `salary_cass`,
  `salary_income_tax`, and `cam`.

It uses the rule rows only for `tax_accruals.tax_rule_id`. It does not use
`rate_bps`.

For entered values `net`, `cas`, `cass`, `incomeTax`, and `cam`, the seven
postings remain:

| Posting | Account | Amount |
|---|---|---:|
| Net payment | company bank | `-net` |
| Net receipt | selected personal account | `+net` |
| CAS owed | company tax liability | `-cas` |
| CASS owed | company tax liability | `-cass` |
| Income tax owed | company tax liability | `-incomeTax` |
| CAM owed | company tax liability | `-cam` |
| Salary balancing leg | company equity, `Salaries` category when present | `cas + cass + incomeTax + cam` |

The four liability postings retain one accrual each, with the existing year and
quarter derivation. The plan is zero-sum by construction:

```text
(-net + net) + (-CAS - CASS - income tax - CAM)
  + (CAS + CASS + income tax + CAM) = 0
```

The plan is still written only through `createTransaction` or the existing
revision-aware `updateTransaction`; no salary-specific posting insert path is
added.

## 5. Preview, repeat-last, and editing

### Preview

`previewSalary` becomes a pure structural preview over the entered values. It
does not load `tax_rules`, `tax_config`, or call `computeSalary`. Save performs
the same structural validation again before writing.

### Repeat last salary

Add a read-only action that accepts company ID and normalized employee name,
then finds the most recent live salary transaction for that exact employee:

- match the trimmed employee name stored on the company-bank counterparty;
- order by salary date descending, then creation timestamp descending;
- read only its current revision;
- reconstruct gross, CAS, CASS, income tax, CAM, net, recipient account, and
  month from the postings/accruals; and
- read personal deduction from `salary_transaction_details`.

The UI prefills every field with those stored values. It never computes a
suggestion.

Legacy salary transactions have no detail row and therefore cannot honestly
provide a complete repeat-last payload. They are excluded as repeat baselines.
The first salary saved through this payslip-entered flow establishes the first
complete baseline for that employee.

### Editing

`getTransactionEditDraft` reconstructs the six leg-bearing values from the
current revision and reads its personal-deduction detail.

For a legacy salary with no detail row:

- the values represented by postings are prefilled;
- personal deduction is left blank;
- no value is inferred from `tax_config`, gross, or a known payslip; and
- save requires the owner to enter the deduction, then creates the detail row
  on the new revision.

The edit remains under CRUD-1's optimistic `expectedRevision` guard. Old
postings/accruals are tombstoned, new entered values form the replacement
revision, and no salary amount is recomputed.

## 6. Deprecated salary calculators and tax boundaries

`src/lib/ledger/flow-actions.ts` stops importing or calling `computeSalary`.
The existing `computeSalary` function in `src/lib/tax/compute.ts` remains
because deletion is explicitly deferred; it receives a clear
deprecated-for-live-salary comment.

`calculateSalary` in `src/lib/tax/config-service.ts` also remains and receives
the same boundary comment. It has no production caller after this unit.
`calculateDividendTax`, dividend code, `tax_config` schema/enums, and the
legacy tax-rule records are untouched.

This unit does not run or modify the tax-config seed path and does not populate
live `tax_config`. Cleanup of salary-side config code and constants is a
separate follow-up, not silently folded into the booking change.

## 7. Typed errors and i18n

New errors stay code-only and are added exhaustively to `AppErrorCode` and both
catalogs:

- a generic invalid entered salary amount;
- exact net-identity mismatch; and
- repeat/edit salary shape unavailable when the stored current revision does
  not contain the expected salary legs or accruals.

Services remain locale-free. The UI translates the code through `errors.*`.
Catalog parity and key completeness are checked with cache-cleared TypeScript
per L-0013. No entered tax value is labeled as an estimate or calculation,
because it is a payslip transcription.

## 8. Verification plan

All write fixtures use `TEST_DATABASE_URL`, assert the `_test` suffix and
identity separation, create their own records, and leave zero residue.

1. **Payslip booking:** enter gross 450,000; CAS 112,500; CASS 45,000; income
   tax 23,000; CAM 10,100; net 269,500; deduction 45,000 (the confirmed
   June-2026 payslip value). Assert seven live
   postings with exact stored minor units, four accruals linked to the expected
   legacy rule types, one revision-1 detail row, and exact RON zero-sum.
2. **Net mismatch:** change net by one ban. Preview and save return the typed
   mismatch, and no transaction, posting, accrual, detail, or audit row is
   written.
3. **CAM independence:** change CAM while keeping the employee-side identity
   valid. Assert net is accepted unchanged and only the CAM liability and
   balancing equity amount change.
4. **No calculation dependency:** salary preview/save run with `tax_config`
   empty and use entered values exactly. The production salary module has no
   `computeSalary` or `calculateSalary` import.
5. **Repeat last:** create two entered salaries for one employee and one for a
   different employee. Assert exact current-revision prefill from the newest
   matching employee only, including deduction.
6. **Legacy repeat boundary:** a salary without a detail row is not returned as
   a repeat baseline; no deduction is invented.
7. **Legacy edit:** edit an existing no-detail salary. Assert represented
   values prefill, deduction starts blank, save creates revision 2 with entered
   values and one revision-2 detail while retaining revision-1 ledger history.
8. **Entered edit:** edit a payslip-entered salary. Assert old
   postings/accruals remain tombstoned, the new revision carries exact entered
   values, the previous detail remains immutable, and current draft reads the
   new detail.
9. **Delete/restore/purge:** detail survives soft-delete and exact restore
   unchanged; purge removes it by cascade. Restore produces no FX or tax
   recomputation.
10. **Representability:** zero in any leg-bearing input is rejected before
    write; zero personal deduction is accepted and stored.

Checkpoint B also runs the existing CRUD/reversal/service batteries, catalog
parity, cache-cleared `tsc --noEmit`, changed-file eslint, G1-G4, route/browser
checks, and `next build`.

## 9. Scope and invariants

Expected implementation scope:

- salary UI, preview/save actions, and edit-draft adapter;
- ledger transaction input/service handling for the revision-keyed dependent
  detail;
- one schema migration and generated metadata;
- typed errors and both catalogs;
- isolated salary fixtures and any affected CRUD characterization;
- deprecation comments only in the two retained salary calculators;
- this design doc and A/B review-log rows at commit time.

Explicitly out of scope:

- auditing or correcting previously booked salary amounts;
- computing any salary tax figure;
- deleting the old salary calculator functions;
- changing dividend calculation or config;
- changing or executing the tax-config seed;
- populating live `tax_config`;
- changing legacy `tax_rules` rows or the `tax_accruals.tax_rule_id` model; and
- changing FX behavior, investment behavior, or live salary data.

Invariants touched at implementation: integer minor units, exact employee-side
net identity, seven-leg RON zero-sum, four tax-accrual links, single posting
write path, CRUD revision history, soft-delete/restore/purge behavior, and
dependent salary metadata. The owner reviews the full Tier-3 diff at
Checkpoint B before any commit.
