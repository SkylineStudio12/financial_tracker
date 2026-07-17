import "dotenv/config";
import { pool } from "@/db";
import { seedRevenueCategories } from "@/lib/management/service";

async function main(): Promise<void> {
  const result = await seedRevenueCategories();
  console.log(
    `Revenue category seed: ${result.created} created, ${result.existing} already present`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
