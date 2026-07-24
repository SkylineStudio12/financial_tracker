import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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

/** Effective-dated payslip transcription defaults. These values are never
 * rates; booked salary revisions remain the immutable posting history. */
export const employeeSalaryProfiles = pgTable(
  "employee_salary_profiles",
  {
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    effectiveFrom: date("effective_from").notNull(),
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
    primaryKey({
      columns: [table.employeeId, table.effectiveFrom],
      name: "employee_salary_profiles_pkey",
    }),
    check("employee_salary_profiles_gross_positive_check", sql`${table.grossMinor} > 0`),
    check("employee_salary_profiles_cas_positive_check", sql`${table.casMinor} > 0`),
    check("employee_salary_profiles_cass_positive_check", sql`${table.cassMinor} > 0`),
    check(
      "employee_salary_profiles_income_tax_nonnegative_check",
      sql`${table.incomeTaxMinor} >= 0`,
    ),
    check("employee_salary_profiles_cam_positive_check", sql`${table.camMinor} > 0`),
    check("employee_salary_profiles_net_positive_check", sql`${table.netMinor} > 0`),
    check(
      "employee_salary_profiles_deduction_nonnegative_check",
      sql`${table.personalDeductionMinor} >= 0`,
    ),
  ],
);
