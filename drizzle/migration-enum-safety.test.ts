import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "@/db";

/**
 * Durable guard for CRUD-1 migration 0009's enum strategy.
 *
 * Drizzle runs every pending migration inside ONE wrapping transaction, and
 * Postgres rejects USING an enum value added by `ALTER TYPE ... ADD VALUE` in
 * the same transaction that added it (error 55P04) when the type pre-existed
 * the transaction. Migration 0009's backfill sets import_rows.status =
 * 'trashed' in that same transaction, so import_row_status's new values must
 * arrive via a type RECREATE, not ADD VALUE.
 *
 * This test (1) proves that Postgres behaviour directly, and (2) asserts 0009
 * still uses the RECREATE form — so a future `drizzle-kit generate` that
 * rewrites it to ADD VALUE (the default drizzle output) fails here instead of
 * on a production migration.
 */
async function main(): Promise<void> {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));
  assert.match(databaseName, /_test$/);

  // (1) Behavioural proof against a pre-existing enum type.
  const client = await pool.connect();
  try {
    await client.query("drop table if exists crud1_enum_probe");
    await client.query("drop type if exists crud1_enum_probe_status");
    // Create + COMMIT so the type pre-exists the transactions below (this is
    // the property that makes ADD VALUE unsafe — mirrors import_row_status,
    // created back in migration 0000).
    await client.query("create type crud1_enum_probe_status as enum ('a','b')");
    await client.query("create table crud1_enum_probe (id int, s crud1_enum_probe_status)");
    await client.query("insert into crud1_enum_probe values (1,'a')");

    // ADD VALUE + use in one transaction on a non-empty table -> 55P04.
    let addValueRejected = false;
    await client.query("begin");
    try {
      await client.query("alter type crud1_enum_probe_status add value 'c'");
      await client.query("update crud1_enum_probe set s = 'c' where id = 1");
      await client.query("commit");
    } catch (error) {
      addValueRejected = (error as { code?: string }).code === "55P04";
      await client.query("rollback");
    }
    assert.ok(
      addValueRejected,
      "expected 55P04 when using an ADD VALUE enum value in the same transaction",
    );

    // RECREATE + use in one transaction -> succeeds (the strategy 0009 uses).
    await client.query("begin");
    await client.query("alter type crud1_enum_probe_status rename to crud1_enum_probe_status_old");
    await client.query("create type crud1_enum_probe_status as enum ('a','b','c')");
    await client.query(
      "alter table crud1_enum_probe alter column s type crud1_enum_probe_status using s::text::crud1_enum_probe_status",
    );
    await client.query("drop type crud1_enum_probe_status_old");
    await client.query("update crud1_enum_probe set s = 'c' where id = 1");
    await client.query("commit");
    const [row] = (await client.query("select s from crud1_enum_probe where id = 1")).rows;
    assert.equal(row.s, "c", "recreate path must let the new value be used in the same transaction");
  } finally {
    await client.query("drop table if exists crud1_enum_probe");
    await client.query("drop type if exists crud1_enum_probe_status");
    client.release();
  }

  // (2) 0009 must still use the RECREATE form for import_row_status.
  const migration = readFileSync(
    join(import.meta.dirname, "0009_swift_justin_hammer.sql"),
    "utf8",
  );
  assert.ok(
    migration.includes('ALTER TYPE "public"."import_row_status" RENAME TO "import_row_status_old"'),
    "0009 must RECREATE import_row_status (rename to _old), not ADD VALUE",
  );
  assert.ok(
    !migration.includes(`ADD VALUE 'trashed'`) && !migration.includes(`ADD VALUE 'purged'`),
    "0009 must NOT ADD VALUE the import_row_status values it uses in the same transaction",
  );

  console.log("PASS migration enum safety: 0009 recreates import_row_status; ADD VALUE would 55P04");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
