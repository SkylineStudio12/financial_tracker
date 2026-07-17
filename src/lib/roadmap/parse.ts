/**
 * Parser for docs/roadmap.md — the single source of truth for the /roadmap
 * page. The file is hand-edited, so parsing is defensive: unknown statuses,
 * malformed table rows, and stray markdown all survive as plain content;
 * nothing here throws on bad input.
 *
 * Deliberately NOT a general markdown parser — it recognizes exactly the
 * shapes the roadmap uses (title, paragraphs, `##` sections, pipe tables,
 * ordered/unordered lists with wrapped continuation lines) and passes
 * everything else through as paragraphs.
 */

export const ROADMAP_STATUSES = [
  "DONE",
  "IN PROGRESS",
  "NEXT",
  "QUEUED",
  "PARKED",
] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export type RoadmapBlock =
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

export interface RoadmapSection {
  heading: string;
  blocks: RoadmapBlock[];
}

export interface RoadmapDoc {
  /** Text of the first `# ` line, if any. */
  title: string | null;
  /** Blocks appearing before the first `## ` heading. */
  intro: RoadmapBlock[];
  sections: RoadmapSection[];
}

const UNORDERED_ITEM = /^-\s+(.*)$/;
const ORDERED_ITEM = /^\d+[.)]\s+(.*)$/;
/** A `|---|---|` style separator row between table header and body. */
const TABLE_SEPARATOR = /^\|[\s\-:|]+\|?$/;

/** Split a `| a | b |` line into trimmed cells. Malformed rows (missing or
 * extra pipes) still yield whatever cells are present — never an error. */
function splitTableRow(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|")) inner = inner.slice(0, -1);
  return inner.split("|").map((cell) => cell.trim());
}

export function parseRoadmap(markdown: string): RoadmapDoc {
  const lines = markdown.split(/\r?\n/);
  const doc: RoadmapDoc = { title: null, intro: [], sections: [] };
  let currentBlocks = doc.intro;
  let i = 0;

  const pushParagraph = (parts: string[]) => {
    const text = parts.join(" ").trim();
    if (text) currentBlocks.push({ kind: "paragraph", text });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      const section: RoadmapSection = {
        heading: trimmed.slice(3).trim(),
        blocks: [],
      };
      doc.sections.push(section);
      currentBlocks = section.blocks;
      i++;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      const text = trimmed.slice(2).trim();
      // Only the first H1 is the document title; later ones (hand-editing
      // accidents) fall through as paragraphs so they stay visible.
      if (doc.title === null) {
        doc.title = text;
      } else {
        pushParagraph([text]);
      }
      i++;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const rawRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const rowLine = lines[i].trim();
        if (!TABLE_SEPARATOR.test(rowLine)) rawRows.push(splitTableRow(rowLine));
        i++;
      }
      const [header = [], ...rows] = rawRows;
      currentBlocks.push({ kind: "table", header, rows });
      continue;
    }

    const listMatch = trimmed.match(UNORDERED_ITEM) ?? trimmed.match(ORDERED_ITEM);
    if (listMatch) {
      const ordered = ORDERED_ITEM.test(trimmed);
      const itemPattern = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
      const items: string[] = [];
      while (i < lines.length) {
        const itemLine = lines[i];
        const itemTrimmed = itemLine.trim();
        if (!itemTrimmed) break;
        const match = itemTrimmed.match(itemPattern);
        if (match) {
          items.push(match[1].trim());
        } else if (/^\s/.test(itemLine) && items.length > 0) {
          // Wrapped continuation line of the previous item.
          items[items.length - 1] += ` ${itemTrimmed}`;
        } else {
          break;
        }
        i++;
      }
      currentBlocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Plain paragraph: join consecutive non-blank, non-structural lines.
    // Break only on prefixes the outer loop consumes itself ("# ", "## ",
    // "|", list items) — a bare "#" run like "####" must be swallowed here,
    // otherwise the loop would spin forever on a line nobody consumes.
    const parts: string[] = [];
    while (i < lines.length) {
      const pTrimmed = lines[i].trim();
      if (
        !pTrimmed ||
        pTrimmed.startsWith("# ") ||
        pTrimmed.startsWith("## ") ||
        pTrimmed.startsWith("|") ||
        UNORDERED_ITEM.test(pTrimmed) ||
        ORDERED_ITEM.test(pTrimmed)
      ) {
        break;
      }
      parts.push(pTrimmed);
      i++;
    }
    pushParagraph(parts);
  }

  return doc;
}

/**
 * Recognize a known status at the start of a table cell. Returns the status
 * plus any trailing note ("PARKED (machinery in place)" → note "(machinery in
 * place)"), or null for anything unknown — the page renders unknowns as plain
 * neutral text.
 */
export function matchStatus(
  text: string,
): { status: RoadmapStatus; note: string | null } | null {
  const trimmed = text.trim();
  for (const status of ROADMAP_STATUSES) {
    if (!trimmed.startsWith(status)) continue;
    const rest = trimmed.slice(status.length);
    // Guard the word boundary so e.g. "NEXTUP" doesn't read as NEXT.
    if (rest && /^[A-Za-z0-9]/.test(rest)) continue;
    return { status, note: rest.trim() || null };
  }
  return null;
}

export interface InlineSegment {
  code: boolean;
  text: string;
}

/**
 * Split text into plain and `code` segments on balanced backtick pairs.
 * An unpaired backtick stays literal plain text.
 */
export function splitInlineCode(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let rest = text;
  const pair = /`([^`]*)`/;
  for (;;) {
    const match = rest.match(pair);
    if (!match || match.index === undefined) break;
    if (match.index > 0) segments.push({ code: false, text: rest.slice(0, match.index) });
    segments.push({ code: true, text: match[1] });
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest) segments.push({ code: false, text: rest });
  return segments;
}
