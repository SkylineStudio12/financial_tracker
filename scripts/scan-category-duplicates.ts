import "dotenv/config";
import { pool } from "@/db";
import { categoryDuplicateGroups } from "@/lib/management/service";

async function main(): Promise<void> {
  const duplicates = await categoryDuplicateGroups();
  console.log(`Category duplicate scan: ${duplicates.length} violating group(s)`);
  for (const duplicate of duplicates) {
    console.log(
      `${duplicate.entityId}\t${duplicate.kind}\t${duplicate.normalizedName}\t${duplicate.count}`,
    );
  }
  if (duplicates.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
