import "dotenv/config";
import { Client } from "pg";

const TARGET_DATABASE = "financial_tracker";
const TARGET_HOST = "localhost";

type CategoryKind = "income" | "expense";

type IconAssignment = {
  entityId: string;
  categoryName: string;
  kind: CategoryKind;
  icon: string;
};

const HOUSEHOLD_ID = "428c897c-42b9-401e-845a-8a6a796044a5";
const DRMX_DIGITAL_ID = "c831d56d-8fe8-4817-b225-6bb76879d6eb";
const SKYLINE_STUDIO_ID = "e6bd79dd-d499-44db-9780-919e8ad4f629";

const householdAssignments: IconAssignment[] = [
  { entityId: HOUSEHOLD_ID, categoryName: "Groceries", kind: "expense", icon: "ShoppingCart" },
  { entityId: HOUSEHOLD_ID, categoryName: "Dining", kind: "expense", icon: "UtensilsCrossed" },
  { entityId: HOUSEHOLD_ID, categoryName: "Transport", kind: "expense", icon: "Car" },
  { entityId: HOUSEHOLD_ID, categoryName: "Housing", kind: "expense", icon: "Home" },
  { entityId: HOUSEHOLD_ID, categoryName: "Utilities", kind: "expense", icon: "Lightbulb" },
  { entityId: HOUSEHOLD_ID, categoryName: "Health", kind: "expense", icon: "HeartPulse" },
  { entityId: HOUSEHOLD_ID, categoryName: "Leisure", kind: "expense", icon: "Ticket" },
  { entityId: HOUSEHOLD_ID, categoryName: "Subscriptions", kind: "expense", icon: "Repeat" },
  { entityId: HOUSEHOLD_ID, categoryName: "Travel", kind: "expense", icon: "Plane" },
  { entityId: HOUSEHOLD_ID, categoryName: "Investment gains", kind: "income", icon: "TrendingUp" },
  { entityId: HOUSEHOLD_ID, categoryName: "Investment losses", kind: "expense", icon: "TrendingDown" },
  { entityId: HOUSEHOLD_ID, categoryName: "Dividends", kind: "income", icon: "Coins" },
  { entityId: HOUSEHOLD_ID, categoryName: "Brokerage fees", kind: "expense", icon: "Percent" },
  { entityId: HOUSEHOLD_ID, categoryName: "Other income", kind: "income", icon: "HandCoins" },
];

const companyTemplates = [
  { categoryName: "Software subscriptions", kind: "expense", icon: "AppWindow" },
  { categoryName: "Services", kind: "expense", icon: "Briefcase" },
  { categoryName: "Bank fees", kind: "expense", icon: "Receipt" },
  { categoryName: "Salaries", kind: "expense", icon: "WalletCards" },
  { categoryName: "Taxes", kind: "expense", icon: "Landmark" },
  { categoryName: "Revenue", kind: "income", icon: "Banknote" },
] satisfies Omit<IconAssignment, "entityId">[];

const assignments: IconAssignment[] = [
  ...householdAssignments,
  ...[DRMX_DIGITAL_ID, SKYLINE_STUDIO_ID].flatMap((entityId) =>
    companyTemplates.map((assignment) => ({ entityId, ...assignment })),
  ),
];

const valuesSql = assignments
  .map(
    (_, index) =>
      `($${index * 4 + 1}::uuid, $${index * 4 + 2}::text, $${index * 4 + 3}::text, $${index * 4 + 4}::text)`,
  )
  .join(",\n      ");

const values = assignments.flatMap(({ entityId, categoryName, kind, icon }) => [
  entityId,
  categoryName,
  kind,
  icon,
]);

const mappingCte = `
  mapping(entity_id, category_name, kind, icon) AS (
    VALUES
      ${valuesSql}
  )
`;

const softDeletedStateSql = `
  SELECT count(*)::int AS row_count,
         md5(
           COALESCE(
             string_agg(
               id::text || ':' || xmin::text || ':' || COALESCE(icon, '<NULL>'),
               ',' ORDER BY id
             ),
             ''
           )
         ) AS fingerprint
  FROM categories
  WHERE deleted_at IS NOT NULL
`;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const configuredTarget = new URL(databaseUrl);
  const configuredDatabase = decodeURIComponent(configuredTarget.pathname.slice(1));
  if (configuredTarget.hostname !== TARGET_HOST || configuredDatabase !== TARGET_DATABASE) {
    throw new Error(
      `Refusing target ${configuredTarget.hostname}/${configuredDatabase}; expected ${TARGET_HOST}/${TARGET_DATABASE}`,
    );
  }

  if (assignments.length !== 26) {
    throw new Error(`Expected 26 assignments, received ${assignments.length}`);
  }

  const assignmentKeys = new Set(
    assignments.map(({ entityId, categoryName, kind }) =>
      [entityId, categoryName.toLocaleLowerCase("en-US"), kind].join("|"),
    ),
  );
  if (assignmentKeys.size !== assignments.length) {
    throw new Error("Backfill mapping contains duplicate (entity_id, lower(name), kind) keys");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const target = await client.query<{
      database: string;
      server_address: string;
      server_port: number;
    }>(`
      SELECT current_database() AS database,
             COALESCE(inet_server_addr()::text, 'local_socket') AS server_address,
             inet_server_port() AS server_port
    `);
    const connected = target.rows[0];
    if (connected.database !== TARGET_DATABASE) {
      throw new Error(`Connected database is ${connected.database}; expected ${TARGET_DATABASE}`);
    }
    console.log(
      `connected_target=${connected.database}@${connected.server_address}:${connected.server_port}`,
    );

    await client.query("BEGIN");
    try {
      await client.query("LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE");

      const before = await client.query<{ row_count: number; fingerprint: string }>(
        softDeletedStateSql,
      );

      const updated = await client.query<{
        id: string;
        entity_id: string;
        name: string;
        kind: CategoryKind;
        icon: string;
      }>(
        `
          WITH ${mappingCte}
          UPDATE categories AS category
          SET icon = mapping.icon
          FROM mapping
          WHERE category.entity_id = mapping.entity_id
            AND lower(category.name) = lower(mapping.category_name)
            AND category.kind::text = mapping.kind
            AND category.deleted_at IS NULL
            AND category.icon IS NULL
          RETURNING category.id, category.entity_id, category.name, category.kind, category.icon
        `,
        values,
      );

      const liveNull = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM categories
        WHERE deleted_at IS NULL AND icon IS NULL
      `);
      const after = await client.query<{ row_count: number; fingerprint: string }>(
        softDeletedStateSql,
      );
      const mismatches = await client.query<{ count: number }>(
        `
          WITH ${mappingCte}
          SELECT count(*)::int AS count
          FROM mapping
          LEFT JOIN categories AS category
            ON category.entity_id = mapping.entity_id
           AND lower(category.name) = lower(mapping.category_name)
           AND category.kind::text = mapping.kind
           AND category.deleted_at IS NULL
          WHERE category.id IS NULL OR category.icon IS DISTINCT FROM mapping.icon
        `,
        values,
      );

      const softDeletedTouched =
        before.rows[0].row_count !== after.rows[0].row_count ||
        before.rows[0].fingerprint !== after.rows[0].fingerprint;

      console.log(`PRE-COMMIT updated_rows=${updated.rowCount ?? 0}`);
      console.log(`PRE-COMMIT live_icon_null=${liveNull.rows[0].count}`);
      console.log(`PRE-COMMIT mapping_mismatches=${mismatches.rows[0].count}`);
      console.log(`PRE-COMMIT soft_deleted_rows_before=${before.rows[0].row_count}`);
      console.log(`PRE-COMMIT soft_deleted_rows_after=${after.rows[0].row_count}`);
      console.log(`PRE-COMMIT soft_deleted_fingerprint_before=${before.rows[0].fingerprint}`);
      console.log(`PRE-COMMIT soft_deleted_fingerprint_after=${after.rows[0].fingerprint}`);
      console.log(`PRE-COMMIT soft_deleted_rows_touched=${softDeletedTouched ? 1 : 0}`);

      if ((updated.rowCount ?? 0) !== 26) {
        throw new Error(`Expected exactly 26 updated rows, received ${updated.rowCount ?? 0}`);
      }
      if (liveNull.rows[0].count !== 0) {
        throw new Error(`Expected zero live NULL icons, received ${liveNull.rows[0].count}`);
      }
      if (mismatches.rows[0].count !== 0) {
        throw new Error(`Expected zero mapping mismatches, received ${mismatches.rows[0].count}`);
      }
      if (softDeletedTouched) {
        throw new Error("A soft-deleted category row changed during backfill");
      }

      await client.query("COMMIT");
      console.log("transaction_result=COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.log("transaction_result=ROLLBACK");
      throw error;
    }

    const readBack = await client.query<{
      entity: string;
      name: string;
      kind: CategoryKind;
      icon: string;
    }>(`
      SELECT entity.name AS entity, category.name, category.kind, category.icon
      FROM categories AS category
      JOIN entities AS entity ON entity.id = category.entity_id
      WHERE category.deleted_at IS NULL
      ORDER BY entity.name, lower(category.name), category.kind
    `);

    console.log("POST-COMMIT entity|name|kind|icon");
    for (const row of readBack.rows) {
      console.log(`${row.entity}|${row.name}|${row.kind}|${row.icon}`);
    }
    console.log(`POST-COMMIT rows=${readBack.rowCount ?? 0}`);

    if ((readBack.rowCount ?? 0) !== 26 || readBack.rows.some((row) => !row.icon)) {
      throw new Error("Post-commit category icon read-back failed");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
