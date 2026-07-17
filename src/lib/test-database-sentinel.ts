import assert from "node:assert/strict";
import type { Pool } from "pg";

function databaseIdentity(raw: string): string {
  const url = new URL(raw);
  return [url.protocol, url.username, url.hostname, url.port || "5432", url.pathname].join("|");
}

/** Guard for legacy direct-run database suites. Must run before their first query. */
export async function requireTestDatabase(pool: Pool, suite: string): Promise<boolean> {
  const testRaw = process.env.TEST_DATABASE_URL;
  if (!testRaw) {
    console.log(`SKIP ${suite}: TEST_DATABASE_URL is unset`);
    return false;
  }

  const activeRaw = process.env.DATABASE_URL;
  assert.ok(activeRaw, `${suite}: DATABASE_URL is required`);
  assert.equal(
    databaseIdentity(activeRaw),
    databaseIdentity(testRaw),
    `${suite}: DATABASE_URL must resolve to TEST_DATABASE_URL`,
  );

  const configuredName = decodeURIComponent(new URL(testRaw).pathname.slice(1));
  assert.match(configuredName, /_test$/, `${suite}: test database name must end with _test`);

  const result = await pool.query<{ database_name: string }>(
    "select current_database() as database_name",
  );
  const connectedName = result.rows[0]?.database_name;
  assert.equal(connectedName, configuredName, `${suite}: connected database differs from TEST_DATABASE_URL`);
  console.log(`PASS ${suite}: connected database ${connectedName} (TEST_DATABASE_URL)`);
  return true;
}
