-- 2026 tax_config seed (U2) — owner-ruled values (2026-07-25), authored
-- under 20-08-U2a. Nine parent windows + four investment-CASS bracket
-- children. Self-contained and single-transaction; the deferred
-- contiguity and bracket-set triggers judge the complete series at COMMIT.
--
-- Idempotent by REFUSAL, not upsert: if tax_config has ANY rows the DO
-- block below raises and the whole transaction aborts. A non-empty
-- tax_config means something already seeded — the operator must look
-- before this file may run.
--
-- Bracket ordinals are 0-based (0..3): the deferred
-- tax_config_cass_bracket_ranges_check requires a contiguous 0-based
-- series whose ordinal 0 opens at lower_minor 0, matching
-- CONFIRMED_CASS_INVESTMENT_BRACKETS in src/db/tax-config-seed.ts.
BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tax_config) THEN
    RAISE EXCEPTION 'tax_config already has rows — refusing to seed; investigate the existing series before re-running';
  END IF;
END;
$guard$;

INSERT INTO public.tax_config
  (parameter, value_kind, rate_bps, amount_minor, valid_from, valid_to, status, source)
VALUES
  ('cas_employee_rate',  'rate_bps',     2500, NULL,   '2026-01-01', NULL, 'confirmed', 'payslip Skyline 2026-05'),
  ('cass_employee_rate', 'rate_bps',     1000, NULL,   '2026-01-01', NULL, 'confirmed', 'payslip Skyline 2026-05'),
  ('cam_employer_rate',  'rate_bps',      225, NULL,   '2026-01-01', NULL, 'confirmed', 'payslip Skyline 2026-05'),
  ('income_tax_rate',    'rate_bps',     1000, NULL,   '2026-01-01', NULL, 'estimate',  'payslip Skyline 2026-05'),
  ('dividend_tax_rate',  'rate_bps',     1600, NULL,   '2026-01-01', NULL, 'confirmed', 'artifact 2 accountant 2026-07'),
  ('micro_revenue_tax',  'rate_bps',      100, NULL,   '2026-01-01', NULL, 'confirmed', 'artifact 2 accountant 2026-07'),
  ('minimum_wage',       'amount_minor', NULL, 405000, '2026-01-01', NULL, 'confirmed', 'artifact 2 accountant 2026-07'),
  ('personal_deduction', 'amount_minor', NULL, 62800,  '2026-01-01', NULL, 'estimate',  'artifact 2 accountant 2026-07');

-- Bracket parent inserted and its generated id captured structurally (no
-- hardcoded uuid); the four children reference it in the same statement.
WITH bracket_parent AS (
  INSERT INTO public.tax_config
    (parameter, value_kind, rate_bps, amount_minor, valid_from, valid_to, status, source)
  VALUES
    ('cass_investment_brackets', 'bracket_set', NULL, NULL, '2026-01-01', NULL, 'estimate', 'artifact 2 accountant 2026-07')
  RETURNING id
)
INSERT INTO public.tax_config_cass_investment_brackets
  (tax_config_id, ordinal, lower_minor, upper_minor, base_minor, cass_minor)
SELECT
  bracket_parent.id,
  bands.ordinal,
  bands.lower_minor,
  bands.upper_minor,
  bands.base_minor,
  bands.cass_minor
FROM bracket_parent,
  (VALUES
    (0,       0::bigint, 2430000::bigint,       0::bigint,      0::bigint),
    (1, 2430000::bigint, 4860000::bigint, 2430000::bigint, 243000::bigint),
    (2, 4860000::bigint, 9720000::bigint, 4860000::bigint, 486000::bigint),
    (3, 9720000::bigint,    NULL::bigint, 9720000::bigint, 972000::bigint)
  ) AS bands(ordinal, lower_minor, upper_minor, base_minor, cass_minor);

COMMIT;
