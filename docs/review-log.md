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

*Both 3f rows are retroactive, reconstructed 2026-07-12 from the conversation
record.*

*The FX Checkpoint A date was supplied by the owner; the conversation record
available to the implementation agent did not expose an exact timestamp.*
