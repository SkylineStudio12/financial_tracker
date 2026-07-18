import { Archive } from "lucide-react";

const ICON_PROPS = {
  absoluteStrokeWidth: true,
  strokeWidth: 1.5,
  className: "size-[var(--icon-inline)] shrink-0",
} as const;

function HistoricalLabel({
  name,
  deleted,
  deletedTooltip,
}: {
  name: string;
  deleted: boolean;
  deletedTooltip: string;
}) {
  if (!deleted) return <span>{name}</span>;
  return (
    <span
      className="inline-flex items-center gap-1 text-text-muted"
      title={deletedTooltip}
      aria-label={`${name}. ${deletedTooltip}`}
    >
      <span>{name}</span>
      <Archive {...ICON_PROPS} aria-hidden="true" />
    </span>
  );
}

export function CategoryLabel(props: {
  name: string;
  deleted: boolean;
  deletedTooltip: string;
}) {
  return <HistoricalLabel {...props} />;
}

export function AccountLabel(props: {
  name: string;
  deleted: boolean;
  deletedTooltip: string;
}) {
  return <HistoricalLabel {...props} />;
}
