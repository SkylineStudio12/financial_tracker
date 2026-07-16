import "dotenv/config";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "pg";

function databaseIdentity(raw: string): string {
  const url = new URL(raw);
  return [url.protocol, url.username, url.hostname, url.port || "5432", url.pathname].join("|");
}

function run(binary: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(binary, args, { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function resetTestDatabase(testUrl: URL, databaseName: string): Promise<void> {
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [databaseName],
    );
    await client.query(`drop database if exists "${databaseName}"`);
    await client.query(`create database "${databaseName}"`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const liveRaw = process.env.DATABASE_URL;
  const testRaw = process.env.TEST_DATABASE_URL;
  if (!liveRaw || !testRaw) throw new Error("DATABASE_URL and TEST_DATABASE_URL are required");
  if (databaseIdentity(liveRaw) === databaseIdentity(testRaw)) {
    throw new Error("TEST_DATABASE_URL resolves to DATABASE_URL; refusing to run");
  }
  const testUrl = new URL(testRaw);
  const databaseName = decodeURIComponent(testUrl.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+_test$/.test(databaseName)) {
    throw new Error("Salary payslip test database name must end with _test");
  }
  console.log("PASS salary test-database sentinel (_test) and live-URL separation");

  await resetTestDatabase(testUrl, databaseName);
  const env = { ...process.env, DATABASE_URL: testRaw };
  const bin = (name: string) => join(process.cwd(), "node_modules", ".bin", name);
  run(bin("drizzle-kit"), ["migrate"], env);
  run(bin("tsx"), ["src/db/seed.ts"], env);
  run(bin("tsx"), ["src/lib/ledger/salary-payslip.e2e.test.ts"], env);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
