import "dotenv/config";
import { pool } from "@/db";
import { provisionGregRevolutAccounts } from "@/db/revolut-accounts";

async function main() {
  try {
    const created = await provisionGregRevolutAccounts();
    console.log(`Revolut accounts ready (${created} created).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
