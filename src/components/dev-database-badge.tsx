import { Database } from "lucide-react";

const LIVE_DATABASE_NAME = "financial_tracker";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface DevDatabaseBadgeInfo {
  label: string;
  isLive: boolean;
}

export function getDevDatabaseBadgeInfo(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined,
): DevDatabaseBadgeInfo | null {
  if (nodeEnv !== "development") return null;
  if (!databaseUrl) throw new Error("DATABASE_URL is required in development");

  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName) throw new Error("DATABASE_URL must include a database name");
  const host = LOCAL_HOSTS.has(url.hostname) ? "" : ` @ ${url.host}`;

  return {
    label: `DB: ${databaseName}${host}`,
    isLive: databaseName === LIVE_DATABASE_NAME,
  };
}

export function DevDatabaseBadge({
  databaseUrl = process.env.DATABASE_URL,
  nodeEnv = process.env.NODE_ENV,
}: {
  databaseUrl?: string;
  nodeEnv?: string;
} = {}) {
  const info = getDevDatabaseBadgeInfo(databaseUrl, nodeEnv);
  if (!info) return null;

  return (
    <span
      data-slot="dev-database-badge"
      data-live={info.isLive ? "true" : "false"}
      className={
        info.isLive
          ? "inline-flex h-6 items-center gap-1 rounded-badge bg-status-negative-fill px-2 text-micro uppercase text-accent"
          : "inline-flex h-6 items-center gap-1 rounded-badge border border-border-hairline bg-surface-inactive px-2 text-micro uppercase text-text-muted"
      }
    >
      <Database className="size-[var(--icon-size-inline)]" absoluteStrokeWidth strokeWidth={1.5} />
      {info.label}
    </span>
  );
}
