import Link from "next/link";
import { asc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function EntityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const entityRows = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(isNull(entities.deletedAt))
    .orderBy(asc(entities.createdAt));

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-edge bg-surface p-4 flex flex-col gap-6">
        <div className="text-sm font-semibold tracking-wide text-fg">Financial tracker</div>

        <nav aria-label="Entities" className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wider text-fg-muted mb-1">Entity</div>
          {entityRows.map((entity) => (
            <Link
              key={entity.id}
              href={`/e/${entity.id}/transactions`}
              className={`rounded-md px-2 py-1.5 text-sm ${
                entity.id === entityId
                  ? "bg-surface-raised text-fg"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {entity.name}
            </Link>
          ))}
        </nav>

        <nav aria-label="Sections" className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wider text-fg-muted mb-1">Views</div>
          <Link
            href={`/e/${entityId}/transactions`}
            className="rounded-md px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            Transactions
          </Link>
          <Link
            href={`/e/${entityId}/dashboard`}
            className="rounded-md px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            Dashboard
          </Link>
        </nav>
      </aside>
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}
