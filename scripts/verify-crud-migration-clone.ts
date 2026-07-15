import "dotenv/config";
import assert from "node:assert/strict";
import { Client, Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const REVOLUT_BATCH_ID = "62719433-b0da-4f6d-8276-57cf68c59410";
const ING_BATCH_ID = "f9929a4a-7b39-45fe-bbcf-393b2b44736e";
const ING_OWNER_TRANSFER_ROW_ID = "ef0e74ac-da4a-48dc-aa71-c47577ff8786";
const CLONE_DATABASE = "financial_tracker_crud_clone_test";

function databaseIdentity(raw: string): string {
  const url = new URL(raw);
  return [url.protocol, url.username, url.hostname, url.port || "5432", url.pathname].join("|");
}

async function expectDuplicateClaimBlocked(
  client: PoolClient,
  provider: "ing" | "revolut",
  batchId: string,
): Promise<string> {
  await client.query("begin");
  try {
    await client.query(
      `insert into import_source_claims (provider, raw_text_hash, source_batch_id)
       select provider, raw_text_hash, source_batch_id
       from import_source_claims
       where provider = $1 and source_batch_id = $2 and released_at is null`,
      [provider, batchId],
    );
    assert.fail(`${provider} duplicate source claim was accepted`);
  } catch (error) {
    const postgresError = error as { code?: string; constraint?: string };
    assert.equal(postgresError.code, "23505");
    return postgresError.constraint ?? "unknown constraint";
  } finally {
    await client.query("rollback");
  }
}

async function main(): Promise<void> {
  const liveRaw = process.env.DATABASE_URL;
  assert.ok(liveRaw, "DATABASE_URL is required");
  const liveUrl = new URL(liveRaw);
  const cloneUrl = new URL(liveUrl);
  cloneUrl.pathname = `/${CLONE_DATABASE}`;
  assert.notEqual(databaseIdentity(liveRaw), databaseIdentity(cloneUrl.toString()));
  assert.match(CLONE_DATABASE, /_test$/);

  const adminUrl = new URL(liveUrl);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const liveDatabase = decodeURIComponent(liveUrl.pathname.slice(1));
    const sessions = await admin.query<{ count: number }>(
      "select count(*)::int as count from pg_stat_activity where datname = $1",
      [liveDatabase],
    );
    assert.equal(
      sessions.rows[0]?.count,
      0,
      "Live database has active sessions; stop localhost before cloning",
    );
    await admin.query(`drop database if exists "${CLONE_DATABASE}"`);
    await admin.query(`create database "${CLONE_DATABASE}" with template "${liveDatabase}"`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: cloneUrl.toString() });
  try {
    const before = await pool.query<{
      provider: string;
      batch_id: string;
      legacy_hash_owners: number;
    }>(
      `select 'ing'::text provider, id::text batch_id, 1::int legacy_hash_owners
       from import_batches where id = $1
       union all
       select 'revolut', id::text, 1::int
       from revolut_import_batches where id = $2
       order by provider`,
      [ING_BATCH_ID, REVOLUT_BATCH_ID],
    );
    assert.equal(before.rowCount, 2);

    // Apply via the programmatic node-postgres migrator, which wraps ALL
    // pending migrations in ONE transaction. Because this clone carries the
    // real soft-deleted ING owner-transfer row, migration 0009's backfill
    // UPDATEs its status to 'trashed' inside that same transaction — the exact
    // same-transaction enum use that would 55P04 if import_row_status used
    // ADD VALUE instead of a type recreate. A clean apply here proves the
    // recreate strategy holds on production-shaped data.
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });

    const after = await pool.query<{
      provider: string;
      source_batch_id: string;
      active_claims: number;
    }>(
      `select provider::text, source_batch_id::text,
              count(*) filter (where released_at is null)::int active_claims
       from import_source_claims
       where source_batch_id = any($1::uuid[])
       group by provider, source_batch_id
       order by provider`,
      [[ING_BATCH_ID, REVOLUT_BATCH_ID]],
    );
    assert.deepEqual(after.rows.map((row) => row.active_claims), [1, 1]);

    const anomalies = await pool.query<{ zero_claim_batches: number; duplicate_claim_batches: number }>(
      `with batches as (
         select id, 'ing'::text provider from import_batches
         union all
         select id, 'revolut'::text from revolut_import_batches
       ), claim_counts as (
         select provider::text, source_batch_id,
                count(*) filter (where released_at is null)::int active_claims
         from import_source_claims group by provider, source_batch_id
       )
       select count(*) filter (where coalesce(c.active_claims, 0) = 0)::int zero_claim_batches,
              count(*) filter (where c.active_claims > 1)::int duplicate_claim_batches
       from batches b
       left join claim_counts c on c.provider = b.provider and c.source_batch_id = b.id`,
    );
    assert.deepEqual(anomalies.rows[0], { zero_claim_batches: 0, duplicate_claim_batches: 0 });

    const ownerTransfer = await pool.query(
      `select ir.id, ir.status, ir.transaction_id, t.deleted_at,
              til.lifecycle, til.released_at
       from import_rows ir
       left join transactions t on t.id = ir.transaction_id
       left join transaction_import_links til on til.source_row_id = ir.id
       where ir.id = $1`,
      [ING_OWNER_TRANSFER_ROW_ID],
    );
    assert.equal(ownerTransfer.rowCount, 1);

    const client = await pool.connect();
    let duplicateBlocks: Record<string, string>;
    try {
      duplicateBlocks = {
        ing: await expectDuplicateClaimBlocked(client, "ing", ING_BATCH_ID),
        revolut: await expectDuplicateClaimBlocked(client, "revolut", REVOLUT_BATCH_ID),
      };
    } finally {
      client.release();
    }

    console.log(
      JSON.stringify(
        {
          before: before.rows,
          after: after.rows,
          anomalies: anomalies.rows[0],
          duplicateBlocks,
          ingOwnerTransfer: ownerTransfer.rows[0],
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
    const cleanupAdmin = new Client({ connectionString: adminUrl.toString() });
    await cleanupAdmin.connect();
    try {
      await cleanupAdmin.query(`drop database if exists "${CLONE_DATABASE}"`);
    } finally {
      await cleanupAdmin.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
