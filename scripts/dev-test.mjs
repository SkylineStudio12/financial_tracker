/**
 * Start the dev server against the TEST database, without editing .env.
 *
 * Why this exists: `next dev` loads .env automatically, and .env's
 * DATABASE_URL points at the LIVE database. Next's documented load order puts
 * `process.env` ABOVE every .env* file (see
 * node_modules/next/dist/docs/01-app/02-guides/environment-variables.md,
 * "Environment Variable Load Order"), so setting DATABASE_URL in the child's
 * environment here overrides .env for that process only. Nothing on disk
 * changes and plain `npm run dev` still points at live.
 *
 * A UI observation must be attributable to a database (L-0025), so this
 * refuses to guess and prints the database it resolved before handing off.
 *
 * Implemented in Node rather than shell because the preview launcher executes
 * `node <relative-arg>` but refuses a shell script.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Client } from "pg";

const repoRoot = join(import.meta.dirname, "..");

function refuse(message) {
  console.error(`dev:test REFUSED — ${message}`);
  process.exit(2);
}

let testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  // Read .env with a line match rather than loading it, so its live
  // DATABASE_URL can never enter this process's environment.
  try {
    const match = readFileSync(join(repoRoot, ".env"), "utf8")
      .split("\n")
      .find((line) => line.startsWith("TEST_DATABASE_URL="));
    if (match) testUrl = match.slice("TEST_DATABASE_URL=".length).trim();
  } catch {
    // no .env — handled by the refusal below
  }
}

if (!testUrl) refuse("TEST_DATABASE_URL is unset (not in the environment, not in .env)");
if (!testUrl.endsWith("_test")) {
  refuse(`TEST_DATABASE_URL does not name a *_test database: ${testUrl}`);
}

const parsedName = decodeURIComponent(new URL(testUrl).pathname.slice(1));
if (!parsedName) refuse("could not parse a database name from TEST_DATABASE_URL");

// The parsed name is what we intend; current_database() is what a connection
// actually reaches. Disagreement means the operator would be misled, so it is
// a refusal, not a warning.
const client = new Client({ connectionString: testUrl });
let connectedName = null;
try {
  await client.connect();
  connectedName = (await client.query("select current_database()")).rows[0].current_database;
} catch (error) {
  refuse(`could not connect to the test database: ${error.message}`);
} finally {
  await client.end().catch(() => {});
}
if (connectedName !== parsedName) {
  refuse(`connected database ${connectedName} does not match the parsed name ${parsedName}`);
}

console.log("");
console.log("  dev:test — this server talks to the TEST database");
console.log(`  database : ${parsedName}`);
console.log(`  verified : select current_database() -> ${connectedName}`);
console.log("  live DB  : untouched; .env unmodified; plain `npm run dev` still uses .env");
console.log("");

const child = spawn(
  process.execPath,
  [join(repoRoot, "node_modules", "next", "dist", "bin", "next"), "dev", ...process.argv.slice(2)],
  { cwd: repoRoot, stdio: "inherit", env: { ...process.env, DATABASE_URL: testUrl } },
);
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
