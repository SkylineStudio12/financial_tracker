/**
 * Pure engine behind DateField/DateFilter (docs/reviews/date-picker-checkpoint-a.md).
 * Consumer state is ISO `yyyy-MM-dd` strings end to end; `Date` objects exist
 * only between here and react-day-picker. Conversion is by parts (D10) —
 * never `new Date("yyyy-MM-dd")` (UTC-midnight parse, shifts a day west of
 * UTC) and never `toISOString()` (shifts a day east).
 */
import type { Locale } from "@/i18n/config";

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const RO_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * ISO string → local-midnight Date, or null when the string is malformed or
 * names a day that doesn't exist. The strict check is a parts round-trip:
 * JS Date rolls out-of-range parts over (31.02 → 03.03), so any drift between
 * input parts and constructed parts means the date was invalid.
 */
export function isoToDate(iso: string): Date | null {
  const match = ISO_RE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  // Years 0–99 would otherwise be read as 1900+y.
  date.setFullYear(year);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Local-midnight Date → ISO string, by parts (D10). */
export function dateToIso(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export type DateInputEvaluation =
  | { kind: "empty" }
  | { kind: "valid"; iso: string }
  | { kind: "invalid" };

/**
 * Lenient, unmasked typing contract (§3.1): EN accepts `yyyy-MM-dd` and
 * unpadded `yyyy-M-d`; RO accepts `dd.MM.yyyy`, unpadded `d.M.yyyy`, and ISO
 * paste-through. Anything else — including real-looking but nonexistent days
 * like `31.02.2026` — is invalid. Empty (after trim) is first-class: the
 * filter needs it as a value, so it is reported distinctly, not as invalid.
 */
export function evaluateDateInput(text: string, locale: Locale): DateInputEvaluation {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  let year: number;
  let month: number;
  let day: number;
  const isoMatch = ISO_RE.exec(trimmed);
  const roMatch = locale === "ro" ? RO_RE.exec(trimmed) : null;
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (roMatch) {
    day = Number(roMatch[1]);
    month = Number(roMatch[2]);
    year = Number(roMatch[3]);
  } else {
    return { kind: "invalid" };
  }
  const iso = `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
  if (!isoToDate(iso)) return { kind: "invalid" };
  return { kind: "valid", iso };
}

/** Q2 ruling: caption dropdowns span January 2015 → December (current year + 1). */
export const DROPDOWN_START_YEAR = 2015;

/**
 * Month bounds for the caption dropdowns (D8). The Q2 window is widened when
 * a committed value falls outside it — typing is unbounded (the pattern must
 * not invent a min/max constraint), so the calendar must still be able to
 * show whatever was typed.
 */
export function dropdownBounds(
  committedIsos: Array<string | undefined>,
  today: Date,
): { startMonth: Date; endMonth: Date } {
  let startMonth = new Date(DROPDOWN_START_YEAR, 0, 1);
  let endMonth = new Date(today.getFullYear() + 1, 11, 1);
  for (const iso of committedIsos) {
    const date = iso ? isoToDate(iso) : null;
    if (!date) continue;
    const month = new Date(date.getFullYear(), date.getMonth(), 1);
    if (month < startMonth) startMonth = month;
    if (month > endMonth) endMonth = month;
  }
  return { startMonth, endMonth };
}
