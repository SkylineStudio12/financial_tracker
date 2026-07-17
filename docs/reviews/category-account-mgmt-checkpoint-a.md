# Category + account management UI — Checkpoint A

**PROMPT-KEY:** 10-09F
**Status:** ACCEPTED 2026-07-17 (Checkpoint A) — rulings in review-log. Design doc only; no
code in this unit. Tier 2 at implementation (management service + manage
page), with two flagged escalation points: any new index/migration (Q1) and
any touch of `src/db/` paths is Tier 3 by definition.

---

## 1. Current state — what exists, what this unit adds

**Exists (management-ui unit, Checkpoint A approved 2026-07-17, rulings
D1–D9):** the `/p/[profile]/manage` page with **category CRUD** (create,
rename, kind-immutable, protected-name refusal list per D7, in-use
soft-delete refusal, live-rows unique index per D8) and employees/salary
profiles. Those rulings **stand and are not redesigned here** — this doc
builds on them.

**Exists (transactions):** the app's recovery model in the flesh — a
dedicated trash route (`/transactions/trash`) listing soft-deleted rows with
per-row **Restore** and **Purge** actions, `AlertDialog` confirmation, typed
errors. This is the pattern the brief requires consistency with.

**Exists (display tolerance):** transaction list/detail queries join
categories **without** a `deleted_at` filter, so a soft-deleted category
keeps showing its name on history while vanishing from entry forms — the
known accepted race. What's missing is any *visual differentiation*: a
deleted category's name today reads exactly like a live one (§5 designs the
look, per brief).

**Does not exist:** any account management surface. Accounts come from the
seed only; there is no create/edit/deactivate/delete/restore UI, and no
category restore UI either (soft-delete is one-way from the manage page
today).

**This unit therefore adds:** (A) the Accounts management section, (B) the
recovery layer (deleted-row visibility + restore) for both categories and
accounts, (C) the soft-deleted-reference display treatment across read
surfaces.

## 2. Placement and scoping

Both sections live on the existing `/p/[profile]/manage` page (D9's sidebar
entry already exists; no navigation change).

**Entity scoping — same rule as categories (management-ui §5.1):** a profile
manages its entity. Household-view profiles (household/greg/andra) all
manage the **Household** entity; SRL profiles manage their company.

**Owner filtering is deliberately NOT applied on the manage page.** Greg's
profile *views* only his accounts in spending contexts, but management is
administration of the entity, and hiding Andra's accounts there would make
exactly the errors this page exists to fix — a wrong owner attribution —
invisible from the profile where someone happens to be standing. The
section header carries the entity name to make the scope explicit:

```
ACCOUNTS — HOUSEHOLD                              [ + New account ]
```

**J1** flags this for veto (alternative: personal profiles see only their
owner's accounts, with attribution errors fixable only from the household
profile).

## 3. Accounts section

### 3.1 List view

```
ACCOUNTS — HOUSEHOLD                              [ + New account ]

│ NAME              TYPE        CCY   OWNER   BALANCE (RON)    │
│ ING curent Greg   Bank        RON   Greg       12 345,00  ✎  │
│ Revolut Andra     Bank        EUR   Andra       2 210,50  ✎  │
│ Cash Greg         Cash        RON   Greg          150,00  ✎  │
│ Numerar Andra     Cash        RON   Andra           0,00  ✎  │
│                                          INACTIVE            │
│ BT vechi Greg     Bank        RON   Greg           0,00  ✎  │
╰───────────────────────────────────────────────────────────────╯
  System accounts (equity, tax, clearing, positions) are managed
  by the app and aren't listed here.                    caption

  Deleted accounts (1) ▸                                 footer
```

Decisions:

- **Owner column on household-view profiles only** — company accounts have
  `owner = NULL` by model (no column shown on SRL profiles; rendering an
  empty owner column there would suggest something is missing). Owner
  renders as the plain name in `text-secondary` — not a colored chip:
  10-07F already ruled that person-identity color (black-vs-grey between
  spouses) implies rank; names are unambiguous at n=2 and identical in both
  locales.
- **Balance column (RON), read-only**, reusing the existing balance query.
  Rationale: the number the owner needs *at the moment of deciding to
  deactivate or delete* is "is anything still in it?" — putting it here
  prevents a round-trip to the dashboard and makes the §3.4 guardrails
  self-explanatory. Amounts `font-amount-sm`, tabular; money color by
  meaning (negative red, else `text-primary`).
- **Inactive accounts** sink to a labeled sub-group at the bottom (micro
  uppercase divider `INACTIVE`), rows in `text-muted`, zero-balance
  expected but shown honestly if nonzero (a nonzero inactive account is a
  real state worth seeing, not hiding).
- **System accounts are not listed.** Types `equity`, `tax_liability`,
  `clearing`, `position` are structural machinery created by app units
  (position accounts are paired by the trades path; equity is the
  household's structural row). Listing them read-only was considered and
  rejected: a management list that shows rows you can never touch trains
  the reader to ignore the page's affordances, and no management action on
  them is legitimate. One `font-caption` line (above) states their
  existence instead, so their absence reads as design. **J2** flags the
  read-only-listing alternative.
- Managed types in this unit: **bank** and **cash**. `brokerage` accounts
  are Phase-4 machinery paired with position accounts — creating one from
  this page without its pair would corrupt the invariant that trades assume.
  They list (they are real, owner-attributed accounts) but create/edit is
  disabled for them with a caption ("managed by the investments setup").
  **Q2** asks whether brokerage creation belongs here eventually.

### 3.2 Create form (dialog, existing manage idiom)

Fields: **name** (text, required) · **type** (bank | cash) · **currency**
(RON | EUR | USD) · **owner** (Greg | Andra — required radio, household
entity only; absent on SRL profiles, `NULL` written) · **active** (default
on).

- Owner is **required, no blank option, no "both"** — the no-joint-accounts
  model made inescapable at the point of entry. The field's caption states
  it: "Every household account belongs to exactly one person."
- Duplicate names: **Q1** — accounts have no uniqueness index today
  (categories got theirs via D8). Recommendation: add the same L-0011-scoped
  index (`UNIQUE (entity_id, lower(name)) WHERE deleted_at IS NULL`) — but
  that is a migration (Tier 3, needs its own apply-time duplicate scan per
  L-0022/D8 precedent). Until ruled, the service refuses duplicates
  app-side so the UI behavior is identical either way.
- **No opening-balance field in this dialog.** An opening balance is a
  ledger write (existing opening-balance flow owns it); the create dialog's
  success state links to it ("Account created — set an opening balance →")
  rather than absorbing it. Mixing a config write and a ledger write in one
  submit would put a Tier-3 action behind a Tier-2 button.

### 3.3 Edit rules — mutability follows history

| Field | Editable | Why |
|---|---|---|
| name | always | Display label; every read joins by id (same argument as category rename) |
| active | always | The designed lever for real-world account closure — hides from entry forms (`getFormOptions` already filters `isActive`), keeps history and balances |
| type / currency / owner | **only while the account has zero postings ever** | Each rewrites the meaning of history: currency changes what every stored amount denominates; owner changes silently re-attribute every historical row in personal views and the who-paid card; type changes what balance sections count it as. With zero postings they are corrections of a typo; with any posting they are history edits and the answer is "make a new account, deactivate the old one" — which the dialog says verbatim when the fields render disabled |

This is the same principle as category kind-immutability (existing ruling),
extended: **a field is mutable until reality references it.**

### 3.4 Deactivate / delete / restore — the guardrail ladder

Consistent with the app's recovery model and the existing friction grammar
(10-08F's ladder; transactions' trash):

| Action | When available | Friction | Consequence copy (gist) |
|---|---|---|---|
| **Deactivate** | always | switch in edit dialog, no confirm | "Hidden from entry forms; history and balances stay." Reversible by the same switch |
| **Soft-delete** | only when the account has **no live postings** | `AlertDialog` confirm | "The account moves to Deleted and can be restored. Its history references stay readable." |
| **Restore** | deleted rows | direct button, no confirm | Restoring is the safe direction; name-collision failure surfaces as a typed error (§4.2) |
| **Purge** | deleted rows with **zero postings ever** (incl. tombstoned) | `AlertDialog`, destructive treatment | "Permanently removes the account. Only possible because nothing ever referenced it." |

- The in-use refusal mirrors the category rule (management-ui §5.4) with the
  same shape: refused **with the count** ("used by 214 postings — deactivate
  instead"), and the refusal dialog's primary button IS "Deactivate" — the
  guardrail hands the user the correct tool instead of just saying no.
- An account with only tombstoned postings (all its transactions
  soft-deleted) still refuses purge — tombstones must keep resolving their
  account name (same FK argument as categories). It may soft-delete.
- Balance is deliberately NOT the delete criterion — a zero balance with
  live postings is still load-bearing history. The criterion is references,
  stated in the copy.

### 3.5 Empty states

Real profiles are seeded, so the honest empty states are the sub-states:

- **No accounts at all** (future entity): 10-07F empty grammar — Wallet
  icon, "No accounts yet. Accounts hold every balance and transaction
  side." + `[ New account ]`.
- **Empty deleted-disclosure**: the footer link simply doesn't render at
  zero deleted rows (a "Deleted (0)" link is noise, not honesty — absence
  of the affordance is accurate).
- **SRL with only system accounts** would show an empty managed list + the
  system caption + CTA — the caption does double duty explaining why the
  list is empty while balances exist on the dashboard.

## 4. Category recovery layer

The existing category section gains the same footer disclosure:

```
  Deleted categories (2) ▾
│ Abonamente vechi   Expense   deleted 2026-07-12   [ Restore ] [ Purge ] │
│ Cadouri            Expense   deleted 2026-07-15   [ Restore ]           │
```

### 4.1 Disclosure, not a separate trash route — rationale

Transactions got a dedicated trash *route* because deleted transactions are
high-volume, filtered, dated financial records. Deleted categories and
accounts are a handful of configuration rows; a route would be an empty page
with one row in it most of its life. A collapsed disclosure at the bottom of
each section keeps the restore path **visible** (the brief's requirement —
the count is always rendered when nonzero) without promoting it to
navigation. The interaction grammar (Restore / Purge per row, AlertDialog on
purge, typed errors) is identical to the trash page — same recovery model,
scaled placement. **J3** flags the alternative (a unified manage-trash
route) if the owner prefers one recovery surface.

### 4.2 Restore semantics — the name-collision case

Restoring a category whose (entity, lower(name), kind) now collides with a
live row violates the D8 index. The service surfaces a typed error
(`errors.manage.restoreNameTaken`); the dialog's copy offers the resolution
path: "A live category with this name exists. Rename the live one first, or
purge this instead of restoring." **No rename-on-restore field in v1** — an
inline rename would make restore a compound edit with its own validation
surface; the two-step path through existing flows costs one extra dialog and
zero new machinery. Same rule and same error family for accounts (if Q1
lands the index; app-side check otherwise).

Purge for categories: only when **zero postings ever reference it**
(tombstoned included) — the existing display-tolerance behavior depends on
the row existing; a referenced category can be restored but never purged.
Protected names (D7): a protected category cannot be soft-deleted today, so
it can never appear in the disclosure — no interaction with this unit.

## 5. What a soft-deleted category reference LOOKS like

The brief's named deliverable. The accepted race: a posting can reference a
category that was soft-deleted afterwards; reads keep resolving the name.
Today that reference is indistinguishable from a live one. The treatment:

**Everywhere a deleted category's name renders on a historical record:**

```
Groceries ⊘        →   name in text-muted + Lucide `Ban`-style marker
```

- Name: `text-muted` (demoted from the row's normal `text-secondary`) —
  readable, deliberately quieter. **Not struck through**: strikethrough on a
  transaction row reads as "this transaction is negated," which is false —
  the *transaction* is fine; only the label's source is retired.
- Marker: Lucide `Archive` at `icon-inline` (14 px), stroke 1.5,
  `text-muted`, trailing the name with `space-1` gap. Tooltip (and
  `aria-label`): EN "Category deleted — historical label" / RO "Categorie
  ștearsă — etichetă istorică". Icon choice rationale: `Archive` says
  "retired, kept" — `Trash2` would say "this is in the trash" (the
  *category* is, the label isn't) and `X`/`Ban` glyphs read as errors.
- **No badge-with-text** (unlike ESTIMATE): ESTIMATE marks a *number* whose
  trustworthiness changes decisions; this marks a *label's* provenance —
  one tier quieter is the correct weight. The tooltip carries the words.

**Where it applies:** transaction list rows, transaction detail, the
category column anywhere history renders, and 10-07F's ranked category list
when a period's data includes a deleted category (it aggregates honestly —
deletion hides a category from *forms*, never from *sums*).

**Where it must NOT apply:** entry forms and filter dropdowns never offer
deleted categories (existing behavior, unchanged). A filter URL pinning a
deleted category id still filters correctly and renders its pill with the
same muted+icon treatment — a shared `CategoryLabel` component carrying a
`deleted` flag, so the treatment can't drift per-surface.

Implementation note: list queries must select `categories.deleted_at` along
with the name (the join already reaches the row; this adds a column, not a
query).

The same treatment applies verbatim to a soft-deleted **account's** name on
tombstoned transactions (the §3.4 model allows deleted accounts only with
no live postings, so live rows never show it; trash rows can).

## 6. RO/EN label tolerance

New/reused catalog keys (namespace `manage.*`, errors `errors.manage.*`),
longest-locale sizing per the 10-06F rule (RO is the fixture):

| Key | EN | RO |
|---|---|---|
| `accounts` | Accounts | Conturi |
| `newAccount` | New account | Cont nou |
| `colOwner` | Owner | Deținător |
| `colType` / `colCurrency` / `colBalance` | existing keys reused | — |
| `deactivate` | Deactivate | Dezactivează |
| `deletedDisclosure` | Deleted ({count}) | Șterse ({count}) |
| `restore` | Restore | Restaurează |
| `purge` | Delete permanently | Șterge definitiv |
| `deletedCategoryTooltip` | Category deleted — historical label | Categorie ștearsă — etichetă istorică |
| `ownerRequiredNote` | Every household account belongs to exactly one person. | Fiecare cont al gospodăriei aparține exact unei singure persoane. |

Buttons size to the RO strings ("Șterge definitiv", "Dezactivează" are the
width-setters); table columns wrap by the grid, never truncate names.
Owner values render as the persons' names (locale-invariant). Gender
agreement noted: tooltip/adjective forms agree with feminine
"categorie"/"etichetă" and neuter "cont" ("șters" for accounts) — two
tooltip keys, not one parameterized string.

## 7. Verification plan (implementation unit)

Standard objective gate (cache-cleared tsc, eslint, G1–G4, scope guard,
checklist) plus, on the isolated runner (`run-management-test.ts` pattern):

1. **Mutability boundary:** type/currency/owner editable at zero postings;
   all three render disabled (and the service refuses) after the first
   posting — fixture books one transaction and asserts both layers.
2. **Guardrail ladder:** soft-delete refused with live postings (count in
   the error); allowed after those are soft-deleted; purge refused while
   tombstoned postings exist; purge succeeds on a never-used account/
   category; restore round-trips exactly.
3. **Collision on restore:** restore into a live name collision fails with
   `restoreNameTaken` (index if Q1 ruled in, service check otherwise);
   error names the live row.
4. **Owner invariant:** household create without owner refused; SRL create
   writes `NULL` owner; owner column absent in SRL DOM.
5. **Deleted-reference look:** a transaction referencing a soft-deleted
   category renders muted name + marker + tooltip in list and detail; the
   category absent from entry-form options and filter dropdowns; a pinned
   filter URL still resolves with the marked pill; shared `CategoryLabel`
   used at every render site (grep-level assertion).
6. **Display tolerance regression:** the existing behavior (deleted
   category name still resolves on history) is pinned by a fixture — this
   unit must not "fix" the accepted race by filtering the join.
7. **Ledger isolation:** the management service writes only
   accounts/categories (+ audit rows); zero writes to
   transactions/postings/accruals across the battery (same assertion style
   as management-ui item 7).
8. **Empty states:** fresh entity renders the accounts empty grammar;
   disclosure absent at zero deleted rows; SRL system-caption present.
9. **Catalog parity** EN/RO for all new keys; focus rings on new
   interactive elements verified in compiled CSS (L-0006); console clean;
   dialogs follow L-0004 refresh-on-close-complete.

## 8. Scope, questions, judgment flags

**In scope at implementation:** accounts section (list/create/edit/
deactivate/delete/restore/purge), category deleted-disclosure + restore/
purge, the `CategoryLabel` deleted-reference treatment across read
surfaces, management service extensions + typed errors, catalog additions,
isolated fixtures, this doc + review-log rows.

**Out of scope:** any ledger write (opening balances stay in their flow);
brokerage/position/system account lifecycle; category CRUD redesign
(D1–D9 stand); bulk reassignment; protected-name structural-reference
conversion (named follow-up); tags management; the transactions trash page.

**Questions (Q — data/schema, don't assume):**

- **Q1** — account name uniqueness: add the L-0011-scoped live-rows index
  (migration + apply-time duplicate scan per D8 precedent, Tier 3), or stay
  app-side-only? Recommended: index, as its own gated step.
- **Q2** — should brokerage account creation ever live on this page, or
  does Phase-4 machinery own it permanently?
- **Q3** — does any live household account currently have `owner = NULL`
  (besides equity)? The owner column design assumes none; verify against
  live before implementation and surface, don't patch silently.

**Judgment flags (owner decides):**

- **J1** — manage page shows ALL household accounts from any household-view
  profile (chosen) vs owner-filtered management.
- **J2** — system accounts: excluded with a caption (chosen) vs listed
  read-only.
- **J3** — recovery placement: per-section deleted disclosure (chosen) vs a
  unified manage-trash route.
- **J4** — the restore/no-confirm choice: restore acts immediately
  (mirrors trash-page restore); flag if the owner wants symmetric confirms.
- **J5** — balance column on the manage list (chosen for guardrail
  context) vs a leaner config-only table.

**Proposed lessons:** none — the unit applies L-0011 (scoped index),
L-0012 (mutability follows dependent structures), L-0022 (apply-time steps
named), and the standing recovery model; it amends none of them.
