# Tier-3 review log

Durable minimum evidence for Tier-3 checkpoints. Record one row per checkpoint;
full review reports remain optional for heavy units.

| Date | Unit | Checkpoint | Verdict | Owner approval |
|---|---|---|---|---|
| 2026-07-09 | i18n 3f (Tier-3) | A | approved | 2026-07-09T21:04:04Z |
| 2026-07-10 | i18n 3f (Tier-3) | B | approved, committed 37a81a5 | 2026-07-10T06:34:27Z |
| 2026-07-13 | FX backfill (Tier-3) | A | approved | 2026-07-13 (owner-confirmed date; exact time unavailable) |
| 2026-07-13 | FX backfill (Tier-3) | B | approved with owner override: Revolut booking e2e failure predates this unit on clean main | 2026-07-13T06:17:14Z |
| 2026-07-13 | As-of-date valuation (Tier-3) | A | approved with future-date, shared-test-cleanup, and pre-first-trade additions | 2026-07-13 (owner-confirmed date; exact time unavailable) |
| 2026-07-13 | As-of-date valuation (Tier-3) | B | approved; pre-existing Revolut booking e2e red excluded (`exactDuplicates` 285 vs 0) | 2026-07-13 (owner-confirmed date; exact time unavailable) |
| 2026-07-13 | Price sync (Tier-3) | A | approved with quarantine-only future-split detection, manual scheduling disclosure, and dry-run coverage clarification | 2026-07-13T07:42:03Z |
| 2026-07-13 | Price sync (Tier-3) | B | approved with owner amendment: seam equality is stored-minor-unit equality (45/45 available PASS; raw deviations reported); write gate requires all 10 XETRA plus NVDA/NFLX files, full dry-run, and minor-unit seam; pre-existing Revolut `exactDuplicates` red excluded | 2026-07-13T08:58:36Z |
| 2026-07-14 | Deletion gaps / full-reversal delete (Tier-3) | A | approved with mandatory live-batch eligibility check; batch 62719433-b0da-4f6d-8276-57cf68c59410 passed | 2026-07-14 (owner-confirmed date; exact time unavailable) |
| 2026-07-14 | Deletion gaps / full-reversal delete (Tier-3) | B | approved green; eligibility confirmed on live batch 62719433-b0da-4f6d-8276-57cf68c59410; manual-sell concurrency race accepted as follow-up | 2026-07-14 (owner-confirmed date; exact time unavailable) |
| 2026-07-15 | Tax config temporal table + as-of calculations (Tier-3) | A | approved with named pre-May salary error precedence, dividend whole-leu accountant follow-up, and independent CASS bracket bounds/bases | 2026-07-15 (owner-confirmed date; exact time unavailable) |
| 2026-07-15 | Tax config temporal table + as-of calculations (Tier-3) | B | approved with TEST_DATABASE_URL pin condition satisfied; dividend whole-leu rounding remains on the accountant follow-up list; btree_gist flagged for Phase 7 deployment checklist | 2026-07-15 (owner-confirmed date; exact time unavailable) |
| 2026-07-15 | CRUD-1 non-investment edit/delete/trash/restore/purge (Tier-3) | A | approved with durable import ownership expanded into scope; investment transactions remain unavailable; live-clone migration, full-reversal regression, and ING recovery-state verification required | 2026-07-15 (owner-confirmed date; exact time unavailable) |
| 2026-07-15 | CRUD-1 non-investment edit/delete/trash/restore/purge (Tier-3) | B | approved green after adversarial fixes and follow-up review; live clone verified one active claim per real ING/Revolut batch and showed ING transaction 2951fbcf-9d82-43ac-a59b-4c86c0217f33 is soft-deleted, not hard-deleted, so 0009 backfills it as trashed with its claim retained | 2026-07-15 (owner-confirmed date; exact time unavailable) |
| 2026-07-16 | Salary payslip-entered values (Tier-3) | A | approved with two owner amendments: zero-leg boundary accepted as logged limitation; fixture deduction 45,000 (confirmed June-2026 payslip) | 2026-07-16 |
| 2026-07-16 | Salary payslip-entered values (Tier-3) | B | approved green; one-ban mismatch writes nothing; legacy edit/lifecycle fixtures pass; live untouched, 0010 generated not applied | 2026-07-16 |
| 2026-07-16 | Live migration 0008+0009 apply + 2951fbcf restore (Tier-3 live op) | apply+restore | 0008/0009 applied atomically (0007→0009); pre-apply snapshot full-restore-verified, sha256 b3097a6e21bfdfad3a12b15c1c3a8079cd17c98e192a09b7c58ae292b75fc720, path /Users/grig/Backups/finance-tracker/financial_tracker_pre_0008_0009_20260716T000649+0300.dump; 0009 sha256 05f6f573f58ccbabb26ad03d052d58dcb0cba8de2100f3423679f89059e32ef7; CRUD-1 original six checks reconciled, all pass incl. duplicate re-import 23505 probe; 2951fbcf restored via restoreTransaction, revision unchanged, row/link consistent (booked/active), FX and tax fingerprints unchanged, totals 297/317/20 | 2026-07-16 |
| 2026-07-16 | Live migration 0010 apply (Tier-3 live op) | apply | 0010 applied via standard migrator (0009→0010, 11 entries); pre-apply snapshot full-restore-verified, sha256 1b83de90402d5a1a0678825c23120c9269293062a982d3c7e068369d8dc7120c, path /Users/grig/Backups/finance-tracker/financial_tracker_pre_0010_20260716T144811+0300.dump; salary_transaction_details created empty per spec (composite PK, >=0 check, cascade FK); 28 pre-existing tables fingerprint-unchanged, totals 317/297/20 | 2026-07-16 |
| 2026-07-16 | Salary payment date + two-step modal (Tier-3) | A | approved with owner ruling: default payment date = 10th of following month, prefill-only, never overwritten once touched | 2026-07-16 |
| 2026-07-16 | Salary payment date + two-step modal (Tier-3) | B | approved green; June-paid-July accrues 2026 Q2 with June rule IDs; December-paid-January accrues 2026 Q4; untouched-default guard browser-verified; repeat-last orders by pay month; live untouched, 0011 generated not applied | 2026-07-16 |
| 2026-07-16 | Live migration 0011 apply (Tier-3 live op) | apply | 0011 applied via standard migrator (0010→0011, 12 entries, hash-verified); pre-apply snapshot full-restore-verified, sha256 6703dbae905b25ad4c0f4ea27c51928c1f960716d3b7dc443a201de973e197b5, path /Users/grig/Backups/finance-tracker/financial_tracker_pre_0011_20260716T180622+0300.dump; design-mandated zero-row precondition on salary_transaction_details confirmed; pay_month DATE NOT NULL with first-of-month check landed; 29 tables fingerprint-unchanged, totals 317/297/20 | 2026-07-16 |
| 2026-07-16 | First live salary booking (June 2026, payslip-entered) | live use | booked via two-step modal; pay month 2026-06, payment date 2026-07-10 (prefilled default, matches payslip's printed pay date); gross 4500 / CAS 1125 / CASS 450 / impozit 230 / CAM 101 / net 2695 / deduction 628, all from June payslip; seven legs zero-sum, four accruals 2026 Q2; first row in salary_transaction_details | 2026-07-16 |

*Both 3f rows are retroactive, reconstructed 2026-07-12 from the conversation
record.*

*The FX Checkpoint A date was supplied by the owner; the conversation record
available to the implementation agent did not expose an exact timestamp.*
