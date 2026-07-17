# Finance Tracker — Roadmap

Status board only. Decision detail lives in the parked plan
(`finance-tracker-parked-plan.md` in project knowledge) and the
review log. Update at unit boundaries, not mid-unit.

Statuses: DONE · IN PROGRESS · NEXT · QUEUED · PARKED

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold + schema + migrations + seed | DONE |
| 2 | FX + ledger write path + core UI + guided flows + dashboard v1 | IN PROGRESS |
| 2.5 | Token restyle | DONE |
| 2.6 | shadcn + New Transaction modal + component gallery | IN PROGRESS |
| 3 | Imports + rules engine + Google Sheets migration | PARKED |
| 4 | Investments (trades, price snapshots, holdings) | PARTIAL (core built; CRUD-2 pending) |
| 5 | Reports + charts + quarterly tax dashboard | PARKED (machinery in place) |
| 6 | Forecasting + scenarios | PARKED |
| 7 | Vercel deployment | PARKED |

## Shipped units (Phase 2 detail)

- Tax-config temporal table (migration 0008), 2026 values confirmed
- CRUD-1: per-row edit/delete/trash/restore/purge, non-investment rows
- Salary booking flow, payslip-entered values, two-date model
- Data reset: test rows cleared, keeper batches intact
- Profile-scoped transaction visibility (`cee14e1`)
- May double-count resolved (duplicate ING transfer trashed)
- Management UI: employees, salary profiles, category index,
  manage page (migration 0012, applied live 2026-07-17)
- Roadmap page at /roadmap (this unit)

## In progress

## Next

1. Cross-entity salary edit dead-end follow-up (accepted known issue)
2. Segmented-control refactor of New Transaction modal
3. Sidebar nav link for /roadmap (two-line follow-up)

## Queued

- Structural category references (replaces D7 interim refusal list)
- Migrate pre-runner test suites onto TEST_DATABASE_URL
- suppressHydrationWarning on body (ride next presentation unit)
- Accrual-table de-emphasis for salary rows
- Legacy salary audit (confirm nothing beyond Maria test row)
- Visibility suite residue-assertion tightening (fix when file touched)

## Parked (see parked plan for detail)

- Dividend tax config (until a real dividend event)
- Phase 2.6 sidebar icon rail
- Phase 5 charts
- i18n Stage 4 + Romanian editorial pass (gated on accountant)
- ING statement import Phase 3
- Price API selection (unparked, not scheduled)
- Category/account management beyond management-UI unit
- Vercel checklist (SYNC_TOKEN guard, Lufga license)

## Recurring discipline

- Monthly ING import: skip the salary-transfer row; the salary
  booking owns that movement.
- Every migration apply: fresh pre-apply snapshot first.
