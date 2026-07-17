CREATE TABLE "employee_salary_profiles" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"gross_minor" bigint NOT NULL,
	"cas_minor" bigint NOT NULL,
	"cass_minor" bigint NOT NULL,
	"income_tax_minor" bigint NOT NULL,
	"cam_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"personal_deduction_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_salary_profiles_gross_positive_check" CHECK ("employee_salary_profiles"."gross_minor" > 0),
	CONSTRAINT "employee_salary_profiles_cas_positive_check" CHECK ("employee_salary_profiles"."cas_minor" > 0),
	CONSTRAINT "employee_salary_profiles_cass_positive_check" CHECK ("employee_salary_profiles"."cass_minor" > 0),
	CONSTRAINT "employee_salary_profiles_income_tax_positive_check" CHECK ("employee_salary_profiles"."income_tax_minor" > 0),
	CONSTRAINT "employee_salary_profiles_cam_positive_check" CHECK ("employee_salary_profiles"."cam_minor" > 0),
	CONSTRAINT "employee_salary_profiles_net_positive_check" CHECK ("employee_salary_profiles"."net_minor" > 0),
	CONSTRAINT "employee_salary_profiles_deduction_nonnegative_check" CHECK ("employee_salary_profiles"."personal_deduction_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "employee_salary_profiles" ADD CONSTRAINT "employee_salary_profiles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_entity_lower_name_live_uidx" ON "employees" USING btree ("entity_id",lower("name")) WHERE "employees"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_entity_lower_name_kind_live_uidx" ON "categories" USING btree ("entity_id",lower("name"),"kind") WHERE "categories"."deleted_at" IS NULL AND "categories"."entity_id" IS NOT NULL;