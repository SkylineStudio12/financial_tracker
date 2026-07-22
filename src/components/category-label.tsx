import { Archive } from "lucide-react";
import {
  CATEGORY_ICON_MAP,
  KIND_ICON_MAP,
  SPLIT_ICON,
  isCategoryIconName,
} from "@/components/category-icons";
import type { TransactionKind } from "@/lib/ledger";

const ICON_PROPS = {
  absoluteStrokeWidth: true,
  strokeWidth: 1.5,
  className: "size-[var(--icon-size-inline)] shrink-0",
} as const;

function HistoricalLabel({
  name,
  leadingIcon: LeadingIcon,
  deleted,
  deletedTooltip,
}: {
  name: string;
  leadingIcon?: typeof Archive;
  deleted: boolean;
  deletedTooltip: string;
}) {
  if (!LeadingIcon && !deleted) return <span>{name}</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 ${deleted ? "text-text-muted" : ""}`}
      title={deleted ? deletedTooltip : undefined}
      aria-label={deleted ? `${name}. ${deletedTooltip}` : undefined}
    >
      {LeadingIcon && <LeadingIcon {...ICON_PROPS} aria-hidden="true" focusable="false" />}
      <span>{name}</span>
      {deleted && <Archive {...ICON_PROPS} aria-hidden="true" focusable="false" />}
    </span>
  );
}

export function CategoryLabel(props: {
  name: string;
  icon?: string | null;
  deleted: boolean;
  deletedTooltip: string;
}) {
  const Icon = props.icon && isCategoryIconName(props.icon) ? CATEGORY_ICON_MAP[props.icon] : undefined;
  return <HistoricalLabel {...props} leadingIcon={Icon} />;
}

export function AccountLabel(props: {
  name: string;
  deleted: boolean;
  deletedTooltip: string;
}) {
  return <HistoricalLabel {...props} />;
}

export function KindLabel({ kind, label }: { kind: TransactionKind; label: string }) {
  const Icon = KIND_ICON_MAP[kind as keyof typeof KIND_ICON_MAP];
  if (!Icon) return <span>{label}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon {...ICON_PROPS} aria-hidden="true" focusable="false" />
      <span>{label}</span>
    </span>
  );
}

export function SplitLabel({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <SPLIT_ICON {...ICON_PROPS} aria-hidden="true" focusable="false" />
      <span>{label}</span>
    </span>
  );
}
