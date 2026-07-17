# Management UI: categories + employees with salary profiles - Checkpoint A

**Status:** Tier-3 Checkpoint A APPROVED 2026-07-17, owner rulings D1-D9 plus
the additional rulings (Revenue seed step, isolated-runner verification)
recorded below. Still design only - no code, no migration, no seed change, no
commit. Checkpoint A and B review-log rows land with the future implementation
commit per L-0019.

**Serialization constraint:** a parallel unit (salary payment date + two-step
modal, `docs/reviews/salary-date-modal-checkpoint-a.md`) owns
`src/components/flows/salary-flow.tsx`, `src/components/new-transaction-dialog.tsx`,
and the ledger flow actions. This unit's implementation starts only after that
unit's commit lands; every touch of those files described below happens at this
unit's Checkpoint B, never concurrently. The new migration serializes after the
in-flight `0011` (pay-month column).

**Hard constraint (owner):** the app never computes tax figures. No
percentages, no formulas, no derivation of any money value. The salary profile
stores the seven payslip values verbatim; the owner re-transcribes from a new
payslip when the accountant's figures change. The existing exact net identity
and the preview step remain the only validation.

## 1. Current-state investigation

### 1.1 Employee identity today

There is no employees table. The salary flow carries a free-text
`employeeName` (`SalaryFlowPayload.employeeName` in
`src/lib/ledger/flow-actions.ts`), and the name lands in exactly three places
at booking time:

- `postings.counterparty` on the company-bank leg
  (`counterparty: payload.employeeName.trim()`);
- the transaction description ``Salary ${name} ${payMonth}``; and
- nowhere structural - no FK, no dedicated column.

Repeat-last (`getLastCompleteSalaryDraft` in `src/lib/ledger/edit-drafts.ts`)
finds the baseline by normalizing the entered name (`trim().toLowerCase()`)
and matching it against the stored bank-leg counterparty. Employee identity is
therefore currently a case-insensitive string convention, vulnerable to typos
("Maria Grigore" vs "Maria  Grigore") silently splitting one employee's
history.

Live data: one salary transaction exists (soft-deleted, employee
"Maria Grigore") plus whatever the first live payslip booking created; all
store the name only in the two places above.

### 1.2 Categories today

Schema (`src/db/schema/categories.ts`): two-level hierarchy
(`parent_id` null = group, set = leaf, depth > 2 app-forbidden), `entity_id`
nullable (null = shared across entities), `kind` enum `income | expense`,
soft-delete, **no uniqueness constraint on name** - duplicates are currently
representable.

Seeded tree (`src/db/seed.ts`): 9 household expense categories, 4 household
investment categories (2 income, 2 expense), and 5 expense categories
duplicated per company ("Software subscriptions", "Services", "Bank fees",
"Salaries", "Taxes"). No shared (`entity_id` null) category exists in practice,
though reads support them.

There is no category CRUD surface anywhere in the app. Categories exist only
via seed, and are consumed by:

- `getFormOptions` (`src/lib/ledger/form-options.ts`): live categories for the
  entity (or shared) feed every entry form's selector;
- transaction list/detail queries (`src/lib/ledger/queries.ts`): postings
  `leftJoin` categories **without** a `deleted_at` filter on the category -
  so a soft-deleted category keeps displaying its name on historical
  transactions while disappearing from entry forms. This is the behavior a
  soft-delete-with-in-use-history design needs, and it already holds;
- **name-based runtime lookups** (the rename hazard inventory):

  | Name | Looked up by | Entity scope | Missing-name behavior |
  |---|---|---|---|
  | `Salaries` | salary booking, `flow-actions.ts` | company | leg uncategorized (optional) |
  | `Taxes` | micro-tax, `src/lib/tax/micro-tax.ts` | company | error (`taxesCategory.id` required) |
  | `Revenue`, `Services`, `Software subscriptions`, `Bank fees` | ING import suggestions, `src/lib/import/config.ts` + `service.ts` | company | suggestion silently null |
  | `Investment gains`, `Investment losses`, `Dividends`, `Brokerage fees` | investments service, `src/lib/investments/service.ts` | household | error on booking paths that require them |

  Note "Revenue" is looked up but never seeded (income company categories do
  not exist in the seed); the import path tolerates that with a null
  suggestion today.

### 1.3 Existing UI patterns available for reuse

- Dialog shell: Base UI `Dialog` (`src/components/ui/dialog.tsx`), used by
  `new-transaction-dialog.tsx` and demonstrated in
  `src/app/dev/components/gallery.tsx` - `density-compact`, `sm:max-w-xl`,
  scrim/radius/shadow tokens, focus trap, dirty-discard confirmation, refresh
  in `onOpenChangeComplete` (L-0004).
- `AlertDialog` for destructive confirmation, `Table`, `Card`, `Select`,
  `Input`, `Badge` primitives all exist under `src/components/ui/`.
- Route pattern: profile-scoped pages under `/p/[profile]/…` with server
  components loading data and client components for interaction.
- No settings/management route exists today; the sidebar
  (`src/components/app-sidebar.tsx`) has groups Views / Flows / Investments
  driven by profile capability flags.

## 2. Employees

### 2.1 Table shape

New table (per company entity; app-enforced that `entity_id` is a company,
mirroring `loadCompanyAccounts`'s existing check style):

```text
employees
  id           uuid PK
  entity_id    uuid NOT NULL FK entities(id)
  name         text NOT NULL
  is_active    boolean NOT NULL DEFAULT true
  created_at / updated_at / deleted_at   (standard helpers)

  UNIQUE (entity_id, lower(name)) WHERE deleted_at IS NULL   -- L-0011 scoped
```

The unique index is case-insensitive on the normalized name because
repeat-last already treats employee identity case-insensitively; two live
rows differing only by case would be the same person to the matching logic.
Scoping to live rows follows L-0011 (soft-deleted row must not block
re-creating the employee).

`is_active` + soft-delete mirrors `accounts`: deactivation hides an employee
from the salary selector without touching history; soft-delete is for
created-by-mistake rows.

### 2.2 How the salary flow references the employee

**Proposed: the employee row is the selector and profile anchor; the booking
keeps storing the denormalized name.** The salary form's employee field
becomes a select over live active employees of the company. On booking,
`saveSalary` continues writing `counterparty = name` and the same description
- the transaction payload gains nothing structural.

Justification: the posting's counterparty is already the pattern for "who was
this leg with" (the personal leg symmetrically stores the company *name*, not
an FK). The transaction remains self-describing without a join, existing
transactions and the new ones stay uniform, and repeat-last's name matching
keeps working unchanged for both. An `employee_id` column on
`salary_transaction_details` would give structural linkage but: that table is
owned by the in-flight unit's revision semantics, the column would be NULL for
all existing rows (no honest backfill - the free-text names were never
validated against a roster), and no current read needs the join.

**D1 - RULED 2026-07-16:** name-only booking linkage. No employee FK on
`salary_transaction_details`. Revisit only if a future unit needs the join,
with an explicit legacy-rows rule at that time.

**What happens to names on existing transactions: nothing.** No backfill, no
rewrite, no re-attribution. The management UI seeds its first employee rows by
the owner typing them; implementation must not auto-create employees from
historical counterparty strings (they are unvalidated free text - same honesty
rule as the no-backfill decisions in both salary units).

**D2 - RULED 2026-07-16:** employee creation on the management page only. No
inline create in the salary modal.

## 3. Salary profile

### 3.1 Shape

One current profile per employee holding the seven payslip values verbatim,
integer minor units:

```text
employee_salary_profiles
  employee_id                uuid PK, FK employees(id)
  gross_minor                bigint NOT NULL CHECK (> 0)
  cas_minor                  bigint NOT NULL CHECK (> 0)
  cass_minor                 bigint NOT NULL CHECK (> 0)
  income_tax_minor           bigint NOT NULL CHECK (> 0)
  cam_minor                  bigint NOT NULL CHECK (> 0)
  net_minor                  bigint NOT NULL CHECK (> 0)
  personal_deduction_minor   bigint NOT NULL CHECK (>= 0)
  created_at / updated_at
```

The positivity checks mirror the payslip flow's representability boundary
(six leg-bearing values positive, deduction may be zero) - a profile that the
booking path would reject is not storable. No rate, no formula, no derived
column exists; the seven values are transcription targets only.

Profile save re-runs the exact identity `net = gross - CAS - CASS - income
tax` (exact in bani) server-side. This is the flow's existing transcription
validation applied at storage time, not a computation - a profile failing it
would fail every preview it prefills, so it is rejected early with the same
typed error family.

### 3.2 Single mutable row - proposed, with justification

**Proposed: single mutable row per employee (PK `employee_id`), updated in
place, with an `audit_log` row (existing append-only pattern,
`previous_values` snapshot) written on every update inside the same
transaction.**

Why not temporal `valid_from` rows:

- The payslip remains the durable evidence and the accountant's document of
  record; the profile is a prefill convenience, not accounting data.
- Every booking already stores the full seven values durably on its own
  postings + `salary_transaction_details` revision rows. Historical "what was
  booked in March" is answered by the ledger, never by the profile. A temporal
  profile would be a third copy that no query needs.
- The profile is never read as of a date: prefill always wants the current
  values. `valid_from` semantics would also invite exactly the derivation
  trap this unit forbids ("which profile was valid for pay month X") - the
  booking must never resolve money values by date logic.
- Provenance still exists: `updated_at` says when, and the audit row preserves
  the previous values, so a mis-typed update is recoverable without a temporal
  schema.

**D3 - RULED 2026-07-16:** single mutable profile row + `audit_log` snapshot;
temporal rows rejected. Owner rationale of record: bookings already store the
seven values durably; a date-resolved profile invites the derivation trap.

**D4 - RULED 2026-07-16:** profile updates through the management UI only.
The salary form reads profiles, never writes them - a one-off edited booking
(bonus month, correction) never silently becomes the new default.

## 4. Prefill contract

### 4.1 Consumption

A new read-only server action (management module, not the flow actions file)
returns, for a company + employee id: the employee name and the seven profile
values, or null when no profile exists. When the owner picks an employee in
the salary form:

```text
profile exists      -> prefill all seven money fields from the profile
no profile          -> existing repeat-last prefill (unchanged fallback)
no baseline either  -> blank fields (unchanged)
```

**Profile supersedes repeat-last when present** (owner directive). Repeat-last
remains the fallback for an employee without a profile and remains reachable
explicitly if the UI keeps its affordance.

**D5 - RULED 2026-07-16:** the profile wins automatic prefill; the manual
"repeat last salary" affordance stays, visually secondary. The default path
remains two inputs. ("Book the same as last month" and "book the current
profile" can legitimately differ after a profile update.)

### 4.2 Interaction with dates and editability

- The in-flight payment-date default (10th of the month following the pay
  month, touched-field preservation) is untouched by this unit; profile
  prefill covers money fields only, never dates.
- Owner goal is a two-input monthly entry: employee + payment date. That
  requires a pay-month default too. **D6 - RULED 2026-07-16, adopted:**
  default pay month to the calendar month *preceding* the payment date's
  month (the exact inverse of the approved payment-date default), editable,
  prefill-only, never validated as a relationship. June salary paid
  2026-07-10 defaults correctly. The December/January year boundary must be
  pinned in a fixture (verification item 9).
- Every prefilled value remains fully editable before preview. Preview and
  save re-run the full structural validation (exact net identity, positive
  amounts, calendar dates) exactly as today; profile prefill is never write
  authorization, mirroring the "preview is not trusted" rule.
- Edit of an existing salary transaction keeps prefill from the stored
  transaction, never from the profile - editing a booking must not silently
  pull in newer profile values.

### 4.3 Serialization

The wiring - employee select in the salary form, prefill call, pay-month
default - touches `salary-flow.tsx`, `new-transaction-dialog.tsx`, and
possibly the flow payload types. All of it lands at this unit's Checkpoint B
after the salary-date-modal unit merges. If that unit's landed shape differs
from its Checkpoint A doc, the delta is re-reviewed here before wiring.

## 5. Categories management

### 5.1 Surface

Per-entity CRUD, all through the management page:

- **List:** the entity's live categories (grouped two-level, kind badge,
  in-use count). Personal profiles (greg/andra) resolve to the Household
  entity, so household categories are manageable from any household-view
  profile - same scoping rule as `getFormOptions`.
- **Create:** name, kind, optional parent (depth > 2 refused app-side, the
  documented rule). Duplicate live name (case-insensitive, per entity, per
  the new index in 5.3) refused with a typed error.
- **Rename:** allowed except for protected names (5.2). Rename propagates
  everywhere automatically because all ledger reads join by id.
- **Kind is immutable** after creation: flipping income/expense would silently
  change the meaning of every historical posting under it and corrupt the
  name+kind import-suggestion map. Create a new category instead.
- **Delete = soft-delete**, refused while in use (5.4). No hard delete: FK
  references from tombstoned postings must keep resolving, and the
  display-after-soft-delete behavior (1.2) depends on the row existing.
- Shared (`entity_id` null) categories: none exist; the management UI neither
  creates nor edits them in this unit. If one ever appears it lists read-only.

### 5.2 Protected names

The four runtime lookup families in 1.2 resolve categories **by name**.
Renaming or soft-deleting "Taxes" on a company would break micro-tax booking
at runtime; renaming "Salaries" would silently un-categorize future salary
equity legs; the household investment names error or degrade similarly.

**Proposed for this unit:** the management service refuses rename and
soft-delete for a hardcoded protected-name list - per company entity:
`Salaries`, `Taxes`, `Revenue`, `Services`, `Software subscriptions`,
`Bank fees`; per household: `Investment gains`, `Investment losses`,
`Dividends`, `Brokerage fees` - with a typed error naming the reason. The
right long-term fix (structural references instead of name lookups) touches
flow actions, micro-tax, import, and investments services and is explicitly a
follow-up unit, not folded in.

**D7 - RULED 2026-07-16:** interim protected-name refusal list; the
structural-reference conversion is a named follow-up unit. The known-issues
list (handover follow-up queue) gains, verbatim per owner: "category
name-lookup coupling: ten load-bearing names resolved at runtime by name;
interim refusal list in management service; structural refs pending."

After the Revenue seed step (see 7), the protected list covers a category
that actually exists on the company entities.

### 5.3 Name uniqueness

There is no DB uniqueness on category names today. Proposed migration
addition, following L-0011 exactly:

```text
UNIQUE (entity_id, lower(name), kind) WHERE deleted_at IS NULL AND entity_id IS NOT NULL
```

`kind` is included because the import-suggestion map keys by name+kind and the
seed itself would violate a name-only index if an income twin of an expense
name ever appears. Shared categories (`entity_id` null) are excluded from the
index (Postgres treats index NULLs as distinct anyway; excluding them makes
the intent explicit) and are out of scope per 5.1.

**D8 - RULED 2026-07-16:** add the partial unique index. The apply-time
duplicate scan is a separate named step per L-0022; it runs against live
BEFORE the migration is approved for apply, and its result - even zero
duplicates - is recorded in the review-log row.

### 5.4 In-use rule and scope boundary against the ledger

"In use" = referenced by at least one **live posting** (`deleted_at IS NULL`)
of any transaction. Soft-delete of an in-use category is refused with the
count; the alternative (bulk reassignment of postings to another category) is
a ledger write and is explicitly out of scope - if the owner wants
reassignment it is its own future Tier-3 unit.

The management service therefore **never writes postings, transactions, or
any ledger table**. Its writes are confined to `categories`, `employees`,
`employee_salary_profiles`, and `audit_log`. The in-use check is a read-only
count. No zero-sum, revision, accrual, FX, or tax code path is touched.

## 6. UI placement

**Proposed: a management page per profile at `/p/[profile]/manage`,** server
component + client sections, reusing `Card`, `Table`, `Dialog`/`AlertDialog`,
and the existing form-field patterns (L-0001 focus rings, `density-compact`,
L-0004 refresh-on-close-complete). No new primitives, no new tokens.

- Sections: **Categories** (all profiles, scoped per 5.1) and **Employees &
  salary profiles** (company profiles only, behind the existing
  `companyFlows` capability flag - same gating as the Flows sidebar group).
- Each row edits in a dialog; destructive actions confirm through
  `AlertDialog`.
- Sidebar: one new entry. **D9 - RULED 2026-07-16:** a "Manage" entry
  appended to the Views group. EN "Manage", RO "Administrare". A dedicated
  Settings group is deferred until a real settings surface exists.

A per-entity management *modal* instead of a route was considered and
rejected: the surface (two sections, tables, nested edit dialogs) exceeds
what one modal holds without inventing a new layered-modal pattern, which
would violate the no-new-primitives rule.

All new strings land in both catalogs (proposed namespace `manage.*`, errors
under `errors.manage.*`), with catalog parity and cache-cleared tsc per
L-0013; new error codes are code-only end-to-end per L-0014.

## 7. Migration impact

One generated migration (numbering after the in-flight unit lands; expected
`0012`) containing schema only - no seed, no data backfill (L-0022: any
apply-time data check, e.g. the category-duplicate scan in 5.3, is a separate
step named in the review-log row, not part of the migration file):

- `employees` (new table + live-rows unique index);
- `employee_salary_profiles` (new table, PK employee_id, seven value columns
  with checks);
- `categories` partial unique index (D8, ruled in).

No column changes to any existing table (D1 ruled name-only, so no
`salary_transaction_details` column). The unit serializes strictly after
migration `0011` and after the salary-date-modal implementation commit;
numbering is confirmed at that time.

Two **named apply-time steps**, separate from the schema migration per
L-0022, each with its result recorded in the review-log row:

1. **Category duplicate scan (D8):** runs against live BEFORE the migration
   is approved for apply; the result is recorded even when zero.
2. **Revenue category seed (owner ruling 2026-07-16):** insert one
   income-kind "Revenue" category per company entity. Key verified against
   `SUGGESTED_CATEGORY_BY_KIND` in `src/lib/import/config.ts`:
   `revenue: { name: "Revenue", kind: "income" }` - the seeded rows must
   match that name+kind exactly or the suggestion map misses them.
   Rationale: the ING import path looks the name up for incoming-funds
   suggestions and currently gets a silent null; the July statement contains
   a HOLYCODE revenue row that should get a suggestion. After this step the
   D7 protected list covers a category that exists.

## 8. Verification plan sketch

**Isolated-runner finding (owner verification point, resolved 2026-07-17):**
the runner EXISTS. `scripts/run-reversal-test.ts`, introduced at `e256a9d`
(full-reversal batch deletion unit), established the mechanism: requires
`TEST_DATABASE_URL`, refuses a URL whose normalized identity equals
`DATABASE_URL`, asserts the database name matches `_test$`, then
drops/recreates the test database and runs migrations + seed + provisioning
before the suite. Three later tracked runners follow the same pattern
(`run-tax-config-test.ts` at `21ec2ee`, `run-crud-test.ts` at `eb4b096`, and
`run-salary-payslip-test.ts` at `0845689`). An additional profile-visibility
runner exists only in the current uncommitted working tree and therefore has
no commit attribution. No minimal runner needs to be built; this unit adds its
own `run-management-test.ts` entry point following the established pattern. The
blanket known-issues statement "tests write to the live dev database" is
stale as written - the accurate residual is handover follow-up item 8:
migrating the remaining pre-runner suites, which stays out of scope here.

All write fixtures run on the isolated runner against `TEST_DATABASE_URL`,
assert the `_test` suffix and live-URL separation, and leave zero residue.

1. **Employees CRUD:** create, rename, deactivate, soft-delete; live-rows
   unique index proven by re-creating a soft-deleted name (L-0011) and by
   refusing a case-variant duplicate.
2. **Profile storage verbatim:** save the canonical payslip values (gross
   450,000; CAS 112,500; CASS 45,000; income tax 23,000; CAM 10,100; net
   269,500; deduction 62,800 - the confirmed real figures); read back exact
   bytes. One-ban net mismatch refused. Update writes an audit row whose
   `previous_values` restores the prior seven values exactly.
3. **No-computation proof:** the management module imports nothing from
   `src/lib/tax/*`; grep-level assertion that no rate, percentage, or derived
   money value exists in the new code; stored profile equals entered input
   with zero transformation.
4. **Prefill precedence:** employee with profile → profile values win over a
   differing repeat-last baseline; employee without profile → repeat-last;
   neither → blank. Edit of an existing booking prefills stored transaction
   values, not the profile.
5. **Booking equivalence:** a salary booked from profile prefill produces the
   identical seven postings, four accruals, and detail row as the same values
   typed manually (regression against the payslip-flow fixtures).
6. **Category constraints:** duplicate refusal, depth-3 refusal, kind
   immutability, protected-name rename/delete refusal, in-use delete refusal
   with correct count, successful soft-delete of an unused category, and the
   history-display check: a transaction referencing a soft-deleted category
   still shows its name while entry forms no longer offer it.
7. **Ledger isolation:** management-service test asserts zero rows written to
   transactions/postings/accruals tables across the full CRUD battery.
8. **Route/browser:** manage page renders per profile with correct sections
   (employees section absent on household/personal), dialogs open/close with
   dirty-discard behavior, console clean.
9. **Pay-month default boundary (D6):** pure fixtures pin payment date
   2026-07-10 → default pay month 2026-06, and the year boundary: payment
   date 2027-01-10 → default pay month 2026-12. Touched-field preservation
   unchanged from the date-modal unit.
10. **Revenue suggestion (apply-time step 2):** after the seed step, an
    incoming-funds row resolves a "Revenue" income suggestion instead of
    null (name+kind key matches `src/lib/import/config.ts`).

Checkpoint B additionally reruns the salary, CRUD, and service batteries,
catalog parity, cache-cleared `tsc --noEmit` (L-0013), changed-file eslint,
G1-G4 token greps, and a fresh `next build`.

## 9. Scope boundary

Expected implementation scope:

- `employees` + `employee_salary_profiles` schema and one migration;
- management service + server actions (new module) and the manage page UI;
- categories partial unique index and management-service constraints;
- salary-form wiring for employee select, profile prefill, and the D6
  pay-month default - only after the in-flight unit lands;
- the two named apply-time steps (duplicate scan, Revenue seed) as
  separately-gated apply artifacts, not folded into the migration;
- the new `run-management-test.ts` isolated-runner entry point;
- the D7 known-issues entry in the handover follow-up queue;
- typed errors and EN/RO catalog additions;
- isolated fixtures per section 8;
- this design doc plus A/B review-log rows at commit time.

Explicitly out of scope:

- computing any tax or money figure, anywhere (hard constraint);
- `tax_config`, its seed, legacy `tax_rules`, and all rate data;
- dividend flow changes;
- posting/accrual shape, zero-sum, revision, FX, or any ledger write path;
- category reassignment of existing postings;
- converting name-based category lookups to structural references
  (follow-up unit);
- backfilling employees or profiles from historical transaction data;
- shared (`entity_id` null) category management;
- modifying any existing transaction, posting, or salary detail row.

## Decision table - all RULED by owner 2026-07-17 (Checkpoint A approval)

| # | Decision | Ruling |
|---|---|---|
| D1 | Booking linkage | Name-only; no employee FK on salary details. Revisit only if a future unit needs the join, with an explicit legacy-rows rule then |
| D2 | Employee creation path | Management page only; no inline create in the salary modal |
| D3 | Profile history | Single mutable row + audit_log snapshot; temporal rows rejected (bookings already store the seven values durably; a date-resolved profile invites the derivation trap) |
| D4 | Profile update path | Management UI only; the salary form reads profiles, never writes them |
| D5 | Repeat-last affordance | Profile wins automatic prefill; manual repeat-last stays, visually secondary; default path remains two inputs |
| D6 | Pay-month default | Adopted: calendar month preceding the payment date's month; prefill only, editable, never validated; December/January boundary pinned in a fixture |
| D7 | Protected category names | Interim refusal list; structural-reference conversion is a named follow-up unit; known-issues entry added verbatim |
| D8 | Category uniqueness | Partial unique index added; apply-time duplicate scan runs against live BEFORE apply approval, result (even zero) recorded in the review-log row |
| D9 | Sidebar entry | "Manage" appended to the Views group; EN "Manage", RO "Administrare"; Settings group deferred until a real settings surface exists |

Additional rulings recorded 2026-07-17:

- **Revenue seed:** one income-kind "Revenue" category per company entity as
  a named apply-time data step separate from the schema migration (L-0022);
  name+kind key verified against `src/lib/import/config.ts` (section 7).
- **Isolated runner:** verified to exist since `e256a9d`; no minimal build
  needed; this unit adds its own runner entry point (section 8).
