import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "pg";

const SUITES = [
  "src/lib/import/bulk-confirm.e2e.test.ts",
  "src/lib/import/delete-reimport.regression.test.ts",
  "src/lib/import/edit-guard.test.ts",
  "src/lib/import/revolut/booking.e2e.test.ts",
  "src/lib/import/text-import.e2e.test.ts",
  "src/lib/investments/asof-valuation.e2e.test.ts",
  "src/lib/investments/preview-parity.test.ts",
  "src/lib/investments/price-sync.e2e.test.ts",
  "src/lib/investments/stock-split.e2e.test.ts",
  "src/lib/investments/trade-edit-guard.test.ts",
  "src/lib/investments/trade-write.e2e.test.ts",
  "src/lib/investments/valuation.money.test.ts",
  "src/lib/ledger/tx-seam.characterization.test.ts",
  "src/lib/tax/micro-tax.characterization.test.ts",
] as const;

function databaseIdentity(raw: string): string {
  const url = new URL(raw);
  return [url.protocol, url.username, url.hostname, url.port || "5432", url.pathname].join("|");
}

async function tableCounts(client: Client): Promise<Map<string, number>> {
  const tables = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  const counts = new Map<string, number>();
  for (const { tablename } of tables.rows) {
    assert.match(tablename, /^[A-Za-z0-9_]+$/);
    const result = await client.query<{ count: string }>(`select count(*)::text as count from "${tablename}"`);
    counts.set(tablename, Number(result.rows[0].count));
  }
  return counts;
}

async function main(): Promise<void> {
  const testRaw = process.env.TEST_DATABASE_URL;
  if (!testRaw) {
    console.log("SKIP pre-runner database suites: TEST_DATABASE_URL is unset");
    return;
  }
  const liveRaw = process.env.DATABASE_URL;
  if (!liveRaw) throw new Error("DATABASE_URL is required to identify the protected live database");
  if (databaseIdentity(liveRaw) === databaseIdentity(testRaw)) {
    throw new Error("TEST_DATABASE_URL resolves to DATABASE_URL; refusing to run");
  }

  const databaseName = decodeURIComponent(new URL(testRaw).pathname.slice(1));
  if (!/^[A-Za-z0-9_]+_test$/.test(databaseName)) {
    throw new Error("Pre-runner test database name must end with _test");
  }
  console.log(`PASS pre-runner launcher: target ${databaseName}; distinct from protected DATABASE_URL`);

  const env = { ...process.env, DATABASE_URL: testRaw };
  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  const client = new Client({ connectionString: testRaw });
  await client.connect();
  let provisionedFxIds: string[] = [];
  try {
    const connected = await client.query<{ database_name: string }>(
      "select current_database() as database_name",
    );
    assert.equal(connected.rows[0]?.database_name, databaseName);
    const priorFxIds = new Set(
      (await client.query<{ id: string }>("select id from fx_rates")).rows.map((row) => row.id),
    );
    const provision = spawnSync(tsx, ["scripts/provision-test-fx.ts"], {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    if (provision.status !== 0) {
      throw new Error(`test FX provisioning failed with exit ${provision.status ?? 1}`);
    }
    provisionedFxIds = (await client.query<{ id: string }>("select id from fx_rates")).rows
      .map((row) => row.id)
      .filter((id) => !priorFxIds.has(id));

    for (const suite of SUITES) {
      const before = await tableCounts(client);
      const result = spawnSync(tsx, [suite], { cwd: process.cwd(), env, stdio: "inherit" });
      if (result.status !== 0) throw new Error(`${suite} failed with exit ${result.status ?? 1}`);
      const after = await tableCounts(client);
      assert.deepEqual(after, before, `${suite}: table row counts changed after cleanup`);
      console.log(`PASS ${suite}: zero row-count residue`);
    }
  } finally {
    if (provisionedFxIds.length > 0) {
      await client.query("delete from fx_rates where id = any($1::uuid[])", [provisionedFxIds]);
      console.log(`PASS pre-runner launcher: removed ${provisionedFxIds.length} temporary FX rows`);
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
