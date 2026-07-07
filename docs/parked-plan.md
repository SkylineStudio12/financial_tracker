# Finance Tracker — parked plan

Deferred decisions and features, tagged by the phase where each becomes real.
This is a holding document, not a build instruction. Nothing here is a CC prompt.
Revisit an item only when its phase arrives.

## Phase reference (from the agreed plan)
1. Scaffold + schema + migrations + seed — done
2. FX + ledger write path + core UI + guided flows + dashboard v1 — in progress
   - 2.5 token restyle · 2.6 shadcn + New Transaction modal · component gallery
3. Imports + rules engine + Google Sheets migration
4. Investments (trades, price snapshots, holdings)
5. Reports (net worth, cash flow, per-entity P&L, quarterly tax dashboard)
6. Forecasting + scenarios
7. Vercel deployment

---

## Deployment (Phase 7)

### Database host: Supabase vs Neon
- Decide at deployment, not before. Stay on localhost until then.
- Both are Postgres; existing Drizzle schema points at either via connection string.
- Use whichever purely as MANAGED POSTGRES: backups + connection pooler.
  Do NOT adopt Supabase auth, RLS, auto-generated APIs, or realtime — the app
  uses Next.js + Drizzle + own API routes. Extras add coupling and lock-in for
  no benefit at two users.
- Portability: Postgres-only usage = switching hosts is a connection-string
  change. Leaning on Supabase extras = a rewrite. Keep it portable.
- Pick an EU region (e.g. Frankfurt) for latency from Bucharest and to keep
  financial data in the EU.
- Backups are the point: Vercel does not back up your database. This closes that gap.

### Lufga font license
- Personal-use license is fine on localhost. Before a public Vercel URL, confirm
  the license covers web embedding / self-hosted webfont, or move to the webfont tier.

### Vercel cron
- Free tier has limited cron invocations. Design FX sync and price snapshots as
  one daily batch job, not frequent polling.
- BUILT (Phase 4 Stage 4): `POST /api/sync/daily` is that one batch job (BNR
  latest rates + price snapshots for held securities, pluggable source seam,
  idempotent upserts). Wire Vercel cron to it here.
- SYNC_TOKEN IS REQUIRED BEFORE ANY PUBLIC DEPLOYMENT: the endpoint's header
  guard (`x-sync-token`) only activates when the SYNC_TOKEN env var is set —
  unset in local dev, so a public deploy without it exposes an unauthenticated
  write endpoint. Set the env var and configure the cron job's header at
  deploy; do not ship without it.

---

## Dashboard (Phase 5, built in pieces as data becomes real)

Not one page built up front. Each card is wired to data that became real in an
earlier phase, and each ships with its empty/sparse state designed FIRST.
The dense, full look is earned after months of use, never faked on day one.

Card backlog, tagged by when its data is real:
- Balance + income/expense summary cards, with "vs last month" delta — real from
  Phase 2 (already the dashboard v1). Delta is the useful part.
- Category-breakdown donut + ranked list beside it — needs categorized volume,
  so after imports (Phase 3).
- Income-vs-expense (net worth / cash flow) over time — the most motivating chart;
  honest only once months of history accrue. Build in Phase 5, expect sparse early.
- Quarterly tax panel per company — real once salary/dividend/revenue flows exist
  (Phase 2 onward). A key differentiator; rank it high.
- Multi-entity consolidation: per-entity vs combined household toggle — a key
  differentiator EaseBudget-style single-user mockups don't have. Rank it high.
- "Who paid what this period" breakdown by owner (Greg vs Andra), not just by
  category — maps directly onto the monthly Google-Sheet reconciliation ritual
  they already do (each covers their lanes: Greg = house/car/restaurants,
  Andra = groceries/household; they reconcile monthly to decide next quarter's
  investing). This is the card that actually REPLACES the Google Sheet. Rank high.
- Investment cards — Phase 4.
- Spending-vs-limit bars — OPTIONAL, only if budget limits are adopted (not
  currently wanted). Don't build budgeting machinery that won't be used.
- Savings goals — OPTIONAL, only if goal tracking is wanted.

Rule: don't let the EaseBudget layout define the dashboard, or it reproduces a
single-user tool and buries the entity structure + tax that make this app worth building.

---

## Bank-statement PDF import (Phase 3)

Confirmed as a real import path from a sample ING statement for Skyline Studio SRL.

- CLEAN-TEXT path, not OCR: the ING PDF has a real text layer, so a parser reads
  it directly. Much easier/more reliable than the Lidl receipt (PNG/OCR) path.
- The export is rich — each row gives: book date, running balance, debit/credit +
  amount, counterparty NAME and IBAN, description, bank reference, and for foreign
  card purchases the original currency + settlement amount + the bank's FX rate.
- This one statement contains every transaction KIND the app already models, so
  keep it as the Phase-3 TEST FIXTURE (real data beats invented):
  revenue (HolyCode → micro-tax accrual), recurring subscriptions (OpenAI,
  Anthropic, Figma, Orange), professional services (accountants), tax/state
  payments (Trezorerie, CAM = salary-related), owner transfers, FX card purchases,
  bank fees.
- Recurring subscriptions/services mean the rules engine auto-categorizes after a
  one-time tag. High payoff for company books specifically.

Schema/behaviour requirements for the importer (verify before building):
- Store counterparty IBAN as a STRUCTURED field, not just free text — this is what
  lets "all money to accountant's IBAN → category X" auto-categorization work, and
  how own-account transfers get matched. (Check if schema has it; trivial to add
  now, annoying migration later.)
- `external_ref` (already in schema from Phase 1) holds the bank reference → makes
  re-importing the same PDF safe (skip references already seen). Confirm it exists.
- FX card rows: PREFER the bank's own printed FX rate for that transaction over the
  BNR lookup — it's what was actually charged. BNR lookup remains the default when
  no rate is given.
- DOUBLE-ENTRY: a statement is one side of the ledger. The importer must construct
  the FULL transaction (both legs) — e.g. bank-out + expense-to-category, or
  revenue-in + micro-tax accrual. Route EVERY parsed row through the same write
  service the manual forms use, so zero-sum + tax rules apply identically. Never
  write to the ledger by a separate path.
- Running balance in the statement can be used to self-verify the parse
  (parsed sequence must reproduce the printed closing balance).
- Everything lands in the review inbox first (same as other imports); confirm
  before it enters the ledger.
- IMPORTED-TRANSACTION EDIT GUARD (surfaced in Stage 1, decide in the importer
  unit): `updateTransaction` hard-replaces postings from form input, and the
  manual forms don't carry `external_ref`. So editing an imported transaction
  through the normal UI would strip its dedup ref and make it re-importable.
  Not reachable until imports exist. The importer unit MUST resolve this as a
  designed choice, not discover it — options: block form-editing of imported
  transaction kinds, or preserve/rebuild external_ref on posting replacement.
  Pick one when wiring the write path (Stage 4), not before.
- REFLESS-ROW IDENTITY CONSTRAINT (found in Stage 3 against the real fixture,
  decide in Stage 4): 11 of 17 rows carry no long bank reference (all POS, all
  fees, the revenue credit). The refless-row import identity CANNOT be a naive
  date+amount+description composite: rows 1476 and 1479 are two 0.51 fees on the
  same day, identical on every content field, distinguishable only by line
  number (per-statement, resets) and balance-after (position-dependent). So the
  refless key must be position-aware for fee rows. Available fallback identifiers
  differ by kind (Stage 3 identity inventory): POS rows have auth code + card
  date + masked card number; fee rows have NOTHING content-based. Stage 4 must
  design this from the inventory, per L-0010 (do not assume a specific composite).

Known properties surfaced by the FIRST REAL IMPORT (batch f9929a4a, Skyline,
2026-07-07):
- REAL DATA NOW IN DEV DB: the dev database holds a real booked import batch
  (f9929a4a, Skyline, imported 2026-07-07). The "reset via seed script, not
  destructive delete" rule now has real financial records in scope — a reset
  would destroy them. Any future dev reset MUST preserve or consciously account
  for real booked batches; reset is no longer a free action.
- rawTextHash IS GLOBAL (not entity-scoped) — a standing design property of the
  batch guard since Stage 4, noted here for findability: the same statement
  text cannot be imported into two different entities. Acceptable — a statement
  belongs to one account, and the row-level partial unique index (not the hash)
  is the load-bearing dedup.
- Practical consequence: the planned end-of-testing re-import of the same CSV
  will be rejected by the global rawTextHash guard unless batch f9929a4a is
  cleared first — and clearing a real booked batch is the dev-reset caution
  above. Plan the reset deliberately; it is not a single button press.
- DELETE-OF-BOOKED-IMPORT STALE STATUS (deferred unit, found in real use):
  softDeleteTransaction does not touch import_rows, so soft-deleting a booked
  imported transaction leaves its import row still showing "booked" linked to a
  dead transaction. The LEDGER is correct (deleted tx excluded everywhere) —
  this is a staging-layer status-staleness gap, the delete-side mirror of the
  Stage-4 edit guard (which covered edit but not delete). Deferred to its own
  unit. POLICY DECISION to make first, before any code: on delete of a booked
  import, should the import row revert to `pending` (re-bookable) or show a
  distinct "booked → since deleted" status (preserves the fact it was once
  booked)? Decide the policy, then build. Do NOT hotfix the write/delete path.
  The stale row in batch f9929a4a (row 5, Grigore Filimon owner transfer,
  2,695.00 RON) was a deliberate delete-path test on 2026-07-07 — not an error
  or a lost transfer. It will return on the planned end-of-testing re-import.

---

## Investments (Phase 4)

- POSITIONS-AT-COST AGGREGATION WINDOW (Stage 2 → Stage 4, a known transient
  property, not a bug): each brokerage cash account has a paired POSITION
  account (type `brokerage` — no `position` enum value exists) whose balance
  is the open lots' cost basis. A buy is an asset swap (cash −T, positions
  +T), so sums are conserved — nothing double-counts — but until Stage 4
  valuation two display distortions exist: (1) holdings are carried AT COST,
  not market value, so any brokerage total is stale the moment prices move;
  (2) both accounts are type `brokerage`, so a "cash at broker" view cannot
  be expressed by type alone — a naive brokerage sum reads position cost as
  if it were spendable cash. If this proves confusing before Stage 4, the
  clean fix is a `position` account-type enum value — its own schema unit,
  needs authorization.
- TRADE SIZE BOUND, not a bug: the derived 6-dp broker rate reproduces the
  entered RON within 1 ban only up to ~$20k per trade; above that the
  amounts-don't-reconcile hard reject fires on legitimate entries. Split the
  trade, or design a higher-precision rate path if it ever recurs.

---

## LLM features (Groq) — Phase 3 or later

Shared safety rules for any external LLM call:
- The LLM never touches the database and never does arithmetic. App code computes
  real figures from the ledger; the LLM only phrases the question and phrases the
  answer. Numbers come from Postgres, never the model. A hallucinated tax figure
  is not an acceptable bug.
- Send the minimum, already-aggregated slice needed. Any external call means that
  slice leaves the machine — this is the full financial life of two people. Decide
  consciously.

### Quick-questions assistant
- Text in, text out over data the app already has ("groceries spend in Q2",
  "accrued dividend tax this quarter"). Groq is fast/cheap and fine here.

### Receipt parsing (belongs with imports, Phase 3)
- CONFIRMED: the Lidl app exports receipts as PNG only — no clean text/PDF. So
  this IS an OCR path, not a clean-text path.
- Mitigating factors: the export is a clean, flat, high-contrast digital image
  (easy end of OCR, not a crumpled thermal photo), and every Lidl bon fiscal
  shares one fixed format. So a per-chain TEMPLATE approach is viable and far more
  reliable than a general "parse any receipt" model.
- Pipeline:
  1. OCR image → text. Two routes: (a) a vision-capable LLM that reads the image,
     or (b) a self-hosted OCR engine (Tesseract). Groq is text-only and cannot do
     this step. Tesseract keeps the image on-machine — a real privacy plus for
     financial data.
  2. Parse OCR text → line items. Lidl format is fixed (two lines per item:
     "qty × unit price", then "name  line-total"; stop at Subtotal), so mostly
     deterministic pattern rules; LLM only if layout varies. Keep printed TOTAL
     and VAT verbatim; never compute them.
  3. Categorize each line — LLM earns its place here; Groq (text) is fine.
     Names are abbreviated/typo'd (e.g. "Spay de par si corp"), which is exactly
     where an LLM beats deterministic rules.
- Romanian-format details the parser must expect: decimal COMMA (79,29), "BUC"
  units, Romanian product names. Integer-minor-unit storage already handles the
  comma; the OCR parse step must read comma-as-decimal.
- If built: scope NARROW first — Lidl only, one fixed template, clean digital
  PNGs only. A narrow parser that nails the common store beats a general one that
  half-works. Add other chains as templates later if it proves useful.
- NEVER auto-commit a parsed receipt. It lands in the review inbox, pre-split with
  suggested categories, user confirms/corrects before it enters the ledger.
- Corrections feed the rules engine: deterministic rules catch repeats, LLM handles
  only novel lines.

### GATE before building the receipt parser
- OCR + parse + categorize is real engineering. Before building, confirm the
  frequency justifies it: build the app, use the existing manual SPLIT feature
  (Phase 2) for mixed baskets for a couple of months, and see how often a mixed
  basket like the sample (2 beers + body spray on one 79,29 charge) actually occurs.
- If mixed baskets are frequent AND per-category accuracy drives decisions → build it.
- If occasional → manual split is the pragmatic tool; don't build the pipeline on spec.

---

## Smaller parked items
- Salary flow: gross salary is a FIXED CONFIGURABLE amount, NOT minimum wage.
  Confirmed from Skyline May-2026 payslip: Greg's gross = 4,500 RON (programmer).
  The flow must take a configurable gross per person, not assume minimum wage.
  Add a "repeat last salary" shortcut in the recurring phase.
- Salary contribution rates CONFIRMED from the May-2026 Skyline payslip (real
  numbers, not assumed): CAS (employee pension) = 25% of gross; CASS (employee
  health) = 10% of gross; CAM (employer contribution) = 2.25% of gross (printed
  explicitly as 4500 × 2.25% = 101). These three can be seeded as confirmed.
- STILL OPEN for the accountant (the payslip did not cleanly resolve these):
  the personal deduction (deducere personală) amount for a 4,500 gross in 2026,
  and exactly how income tax (impozit, ~10%) is computed on the base after CAS +
  CASS + personal deduction. Sharpened question: "confirm the 2026 personal
  deduction value at 4,500 RON gross and the income-tax calculation on that base."
- Tax seed values: CAS/CASS/CAM now confirmed (above); income tax + personal
  deduction remain placeholders until the accountant confirms. Also still needed:
  dividend tax rate and CASS-on-dividends threshold for 2026.
- CASS on dividends is a per-dividend ESTIMATE, flagged as estimate. Real annual
  threshold calculation belongs in Phase 5 reports where the full-year picture exists.
- Dev database reset must run through the seed script (reproducible), not a
  destructive delete. Keep test data until the restyle is visually checked.
- Component gallery: expansion backlog lives at the bottom of that page. Add a
  shadcn component only when a feature needs it; it arrives styled and joins the gallery.
- Sidebar entity-switcher: built as a styled gallery demo first. Wiring it into the
  real app navigation is a separate supervised follow-up.
- SETTLED entity/profile model: THREE entities — Household + Skyline Studio SRL
  (Greg's) + DRMX Digital SRL (Andra's). Household accounts carry an `owner`
  attribute = Greg or Andra. NO joint accounts exist (every account has exactly
  one owner), so personal views are naturally non-overlapping — no joint value,
  no joint-visibility rule. Five sidebar PROFILES are a presentation layer over
  (entity, owner) via URL `/p/[profile]`, resolved by a config keyed on entity id
  (not name). Salary/dividend nav shows for SRL profiles only, derived from config.
- Google Sheets history: decide migration scope (how far back, one-time script vs
  day-zero launch) when imports are built in Phase 3.
- Currency display: original amount + muted currency symbol, RON conversion in the
  RON column. Abbreviation of very large numbers (1.28M with full value on hover)
  still to be decided at the component pass.
- ANYbotics (separate project, not this app): consider building the next from-scratch
  ANYDS component on Angular CDK directly rather than extending Material, as a
  low-cost, reversible test of the "own the component" model vs the Material bridge.
