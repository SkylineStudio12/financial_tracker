import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { entities } from "./entities";
import { id, moneyMinor, softDelete, timestamps } from "./helpers";

/** Company-scoped roster used only to select the denormalized employee name
 * stored by salary bookings. Existing bookings intentionally have no FK. */
export const employees = pgTable(
  "employees",
  {
    id,
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex("employees_entity_lower_name_live_uidx")
      .on(table.entityId, sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

/** Current payslip transcription defaults. These values are never rates and
 * are never resolved by date; booked salary revisions remain the history. */
export const employeeSalaryProfiles = pgTable(
  "employee_salary_profiles",
  {
    employeeId: uuid("employee_id")
      .primaryKey()
      .references(() => employees.id),
    grossMinor: moneyMinor("gross_minor").notNull(),
    casMinor: moneyMinor("cas_minor").notNull(),
    cassMinor: moneyMinor("cass_minor").notNull(),
    incomeTaxMinor: moneyMinor("income_tax_minor").notNull(),
    camMinor: moneyMinor("cam_minor").notNull(),
    netMinor: moneyMinor("net_minor").notNull(),
    personalDeductionMinor: moneyMinor("personal_deduction_minor").notNull(),
    ...timestamps,
  },
  (table) => [
    check("employee_salary_profiles_gross_positive_check", sql`${table.grossMinor} > 0`),
    check("employee_salary_profiles_cas_positive_check", sql`${table.casMinor} > 0`),
    check("employee_salary_profiles_cass_positive_check", sql`${table.cassMinor} > 0`),
    check(
      "employee_salary_profiles_income_tax_positive_check",
      sql`${table.incomeTaxMinor} > 0`,
    ),
    check("employee_salary_profiles_cam_positive_check", sql`${table.camMinor} > 0`),
    check("employee_salary_profiles_net_positive_check", sql`${table.netMinor} > 0`),
    check(
      "employee_salary_profiles_deduction_nonnegative_check",
      sql`${table.personalDeductionMinor} >= 0`,
    ),
  ],
);
