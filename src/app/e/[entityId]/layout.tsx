import Link from "next/link";
import { asc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";

export const dynamic = "force-dynamic";

const navItemClass =
  "rounded-input px-3 py-2 text-secondary text-text-secondary hover:text-text-primary";
const navItemActiveClass =
  "rounded-input px-3 py-2 text-secondary bg-accent text-accent-foreground";
const navGroupLabelClass = "text-micro uppercase text-text-muted mb-1 px-3";

export default async function EntityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const entityRows = await db
    .select({ id: entities.id, name: entities.name, type: entities.type })
    .from(entities)
    .where(isNull(entities.deletedAt))
    .orderBy(asc(entities.createdAt));
  const isCompany = entityRows.find((e) => e.id === entityId)?.type === "company";

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-border-hairline bg-surface p-4 flex flex-col gap-8">
        <div className="text-card-title text-text-primary px-3">Financial tracker</div>

        <nav aria-label="Entities" className="flex flex-col gap-1">
          <div className={navGroupLabelClass}>Entity</div>
          {entityRows.map((entity) => (
            <Link
              key={entity.id}
              href={`/e/${entity.id}/transactions`}
              className={entity.id === entityId ? navItemActiveClass : navItemClass}
            >
              {entity.name}
            </Link>
          ))}
        </nav>

        <nav aria-label="Sections" className="flex flex-col gap-1">
          <div className={navGroupLabelClass}>Views</div>
          <Link href={`/e/${entityId}/transactions`} className={navItemClass}>
            Transactions
          </Link>
          <Link href={`/e/${entityId}/dashboard`} className={navItemClass}>
            Dashboard
          </Link>
          {isCompany && (
            <>
              <Link href={`/e/${entityId}/flows/salary`} className={navItemClass}>
                New salary
              </Link>
              <Link href={`/e/${entityId}/flows/dividend`} className={navItemClass}>
                New dividend
              </Link>
            </>
          )}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 p-[var(--density-card-padding)]">{children}</main>
    </div>
  );
}
