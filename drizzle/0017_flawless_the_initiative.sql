ALTER TABLE "public"."employee_salary_profiles" ADD COLUMN "effective_from" date;--> statement-breakpoint
UPDATE "public"."employee_salary_profiles"
SET "effective_from" = '2025-01-01'
WHERE "effective_from" IS NULL;--> statement-breakpoint
ALTER TABLE "public"."employee_salary_profiles" ALTER COLUMN "effective_from" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."employee_salary_profiles" DROP CONSTRAINT "employee_salary_profiles_pkey";--> statement-breakpoint
ALTER TABLE "public"."employee_salary_profiles" ADD CONSTRAINT "employee_salary_profiles_pkey" PRIMARY KEY ("employee_id", "effective_from");--> statement-breakpoint
ALTER TABLE "public"."employee_salary_profiles" DROP CONSTRAINT "employee_salary_profiles_income_tax_positive_check";--> statement-breakpoint
ALTER TABLE "public"."employee_salary_profiles" ADD CONSTRAINT "employee_salary_profiles_income_tax_nonnegative_check" CHECK ("income_tax_minor" >= 0);
