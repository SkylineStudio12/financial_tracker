import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await db.execute(
      sql`select current_database() as database, version() as version`,
    );
    const row = result.rows[0] as { database: string; version: string };
    return NextResponse.json({
      status: "ok",
      database: row.database,
      version: row.version,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 },
    );
  }
}
