import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [first] = await db
    .select({ id: entities.id })
    .from(entities)
    .orderBy(asc(entities.createdAt))
    .limit(1);
  if (!first) {
    throw new Error("No entities found — run npm run db:seed first.");
  }
  redirect(`/e/${first.id}/transactions`);
}
