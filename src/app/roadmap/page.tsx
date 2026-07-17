import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  matchStatus,
  parseRoadmap,
  splitInlineCode,
  type RoadmapBlock,
  type RoadmapStatus,
} from "@/lib/roadmap/parse";

/**
 * Read-only roadmap board rendered from docs/roadmap.md — the markdown file
 * is the single source of truth, parsed server-side. No database, no
 * mutations. Reached by URL only for now (sidebar link is a follow-up).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roadmap");
  return { title: t("title") };
}

/** Badge styling per known status — existing semantic tokens only. */
const STATUS_BADGE: Record<RoadmapStatus, { labelKey: string; className: string }> = {
  DONE: { labelKey: "done", className: "bg-surface-inactive text-status-positive-text" },
  "IN PROGRESS": { labelKey: "inProgress", className: "bg-accent text-accent-foreground" },
  NEXT: { labelKey: "next", className: "bg-surface-inactive text-text-primary" },
  QUEUED: { labelKey: "queued", className: "bg-surface-inactive text-text-secondary" },
  PARKED: { labelKey: "parked", className: "bg-surface-inactive text-text-muted" },
};

/** Roadmap item text with `code` spans rendered as inline chips. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {splitInlineCode(text).map((segment, index) =>
        segment.code ? (
          <code
            key={index}
            className="rounded-badge bg-surface-inactive px-1 py-0.5 text-caption text-text-secondary"
          >
            {segment.text}
          </code>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/** A table/list cell: known status → badge (+ note), anything else as-is. */
function CellContent({
  text,
  statusLabels,
}: {
  text: string;
  statusLabels: Record<string, string>;
}) {
  const matched = matchStatus(text);
  if (!matched) return <InlineText text={text} />;
  const badge = STATUS_BADGE[matched.status];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className={`rounded-badge px-1.5 py-0.5 text-micro uppercase whitespace-nowrap ${badge.className}`}
      >
        {statusLabels[badge.labelKey]}
      </span>
      {matched.note && <span className="text-caption text-text-muted">{matched.note}</span>}
    </span>
  );
}

function Block({
  block,
  statusLabels,
}: {
  block: RoadmapBlock;
  statusLabels: Record<string, string>;
}) {
  if (block.kind === "paragraph") {
    return (
      <p className="text-secondary text-text-secondary">
        <InlineText text={block.text} />
      </p>
    );
  }

  if (block.kind === "table") {
    return (
      <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
        <table className="w-full text-secondary">
          {block.header.length > 0 && (
            <thead>
              <tr className="text-left text-micro uppercase text-text-muted">
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-border-hairline">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary"
                  >
                    <CellContent text={cell} statusLabels={statusLabels} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const ListTag = block.ordered ? "ol" : "ul";
  return (
    <div className="rounded-card border border-border-hairline bg-surface">
      <ListTag className="text-secondary">
        {block.items.map((item, index) => (
          <li
            key={index}
            className="flex items-baseline gap-3 border-t border-border-hairline px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary first:border-t-0"
          >
            {block.ordered ? (
              <span className="shrink-0 font-numeric text-caption text-text-muted tabular-nums">
                {index + 1}
              </span>
            ) : (
              <span aria-hidden className="shrink-0 text-text-muted">
                &middot;
              </span>
            )}
            <span>
              <InlineText text={item} />
            </span>
          </li>
        ))}
      </ListTag>
    </div>
  );
}

export default async function RoadmapPage() {
  const t = await getTranslations("roadmap");
  const statusLabels = {
    done: t("status.done"),
    inProgress: t("status.inProgress"),
    next: t("status.next"),
    queued: t("status.queued"),
    parked: t("status.parked"),
  };

  let markdown: string | null = null;
  try {
    markdown = readFileSync(path.join(process.cwd(), "docs", "roadmap.md"), "utf8");
  } catch {
    markdown = null;
  }

  if (markdown === null) {
    return (
      <main className="mx-auto max-w-3xl p-6 sm:p-10">
        <h1 className="text-title text-text-primary">{t("title")}</h1>
        <p className="mt-4 text-secondary text-text-muted">{t("sourceMissing")}</p>
      </main>
    );
  }

  const doc = parseRoadmap(markdown);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-[var(--density-section-gap)] p-6 sm:p-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-title text-text-primary">{doc.title ?? t("title")}</h1>
        {doc.intro.map((block, index) => (
          <Block key={index} block={block} statusLabels={statusLabels} />
        ))}
      </header>

      {doc.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2">
          <h2 className="text-micro uppercase text-text-muted">{section.heading}</h2>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} statusLabels={statusLabels} />
          ))}
        </section>
      ))}
    </main>
  );
}
