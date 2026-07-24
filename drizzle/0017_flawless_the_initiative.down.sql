-- WARNING: This down migration is safe only while each employee has a single
-- salary-profile row. Once temporal tiers are seeded, restoring the
-- single-column primary key would fail and this down migration must not be run.
ALTER TABLE "public"."employee_salary_profiles" DROP CONSTRAINT "employee_salary_profiles_income_tax_nonnegative_check";
ALTER TABLE "public"."employee_salary_profiles" ADD CONSTRAINT "employee_salary_profiles_income_tax_positive_check" CHECK ("income_tax_minor" > 0);
ALTER TABLE "public"."employee_salary_profiles" DROP CONSTRAINT "employee_salary_profiles_pkey";
ALTER TABLE "public"."employee_salary_profiles" ADD CONSTRAINT "employee_salary_profiles_pkey" PRIMARY KEY ("employee_id");
ALTER TABLE "public"."employee_salary_profiles" ALTER COLUMN "effective_from" DROP NOT NULL;
ALTER TABLE "public"."employee_salary_profiles" DROP COLUMN "effective_from";
