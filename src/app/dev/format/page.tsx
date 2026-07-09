/**
 * /dev/format — the i18n Stage-2 acceptance surface: every format.ts display
 * function rendered with EXPLICIT "ro" and "en" side by side (the functions
 * are pure, so no toggling is needed to compare). Dev/reference route like
 * /dev/components; not in app navigation, excluded from i18n.
 */
import {
  formatBpsPercent,
  formatDate,
  formatImpliedRate,
  formatMinor,
  formatMinorNumber,
} from "@/lib/format";

const cell = "px-4 py-2";
const num = "text-right whitespace-nowrap font-numeric tabular-nums";

interface Row {
  label: string;
  ro: string;
  en: string;
}

const rows: Row[] = [
  // formatMinor — the money function; edge cases per the acceptance brief.
  { label: "formatMinor 0 RON", ro: formatMinor(0, "RON", "ro"), en: formatMinor(0, "RON", "en") },
  { label: "formatMinor -5,00 RON", ro: formatMinor(-500, "RON", "ro"), en: formatMinor(-500, "RON", "en") },
  { label: "formatMinor 40.988,95 RON", ro: formatMinor(4098895, "RON", "ro"), en: formatMinor(4098895, "RON", "en") },
  { label: "formatMinor 1.234.567,89 RON", ro: formatMinor(123456789, "RON", "ro"), en: formatMinor(123456789, "RON", "en") },
  { label: "formatMinor -1.108,72 RON (Stage-1 capture)", ro: formatMinor(-110872, "RON", "ro"), en: formatMinor(-110872, "RON", "en") },
  { label: "formatMinor 2.425,00 RON (Stage-1 capture)", ro: formatMinor(242500, "RON", "ro"), en: formatMinor(242500, "RON", "en") },
  { label: "formatMinor -242,00 USD", ro: formatMinor(-24200, "USD", "ro"), en: formatMinor(-24200, "USD", "en") },
  // formatMinorNumber — number only (currency renders muted at the call site).
  { label: "formatMinorNumber 40.988,95", ro: formatMinorNumber(4098895, "ro"), en: formatMinorNumber(4098895, "en") },
  // formatImpliedRate — 4-decimal effective rate + the zero guard.
  { label: "formatImpliedRate 110872/24200", ro: formatImpliedRate(24200, 110872, "ro"), en: formatImpliedRate(24200, 110872, "en") },
  { label: "formatImpliedRate zero amount", ro: formatImpliedRate(0, 110872, "ro"), en: formatImpliedRate(0, 110872, "en") },
  // formatBpsPercent — both precisions in use (accrual rates fix 2 digits;
  // the dividend-estimate rate floats 0–2).
  { label: "formatBpsPercent 100 bps (min 2 digits)", ro: formatBpsPercent(100, "ro", { minFractionDigits: 2 }), en: formatBpsPercent(100, "en", { minFractionDigits: 2 }) },
  { label: "formatBpsPercent 300 bps (min 2 digits)", ro: formatBpsPercent(300, "ro", { minFractionDigits: 2 }), en: formatBpsPercent(300, "en", { minFractionDigits: 2 }) },
  { label: "formatBpsPercent 1000 bps (default)", ro: formatBpsPercent(1000, "ro"), en: formatBpsPercent(1000, "en") },
  { label: "formatBpsPercent 850 bps (default)", ro: formatBpsPercent(850, "ro"), en: formatBpsPercent(850, "en") },
  // formatDate — ro DD.MM.YYYY by string rearrangement; en stays ISO.
  { label: "formatDate 2026-07-09", ro: formatDate("2026-07-09", "ro"), en: formatDate("2026-07-09", "en") },
  { label: "formatDate 2026-12-31", ro: formatDate("2026-12-31", "ro"), en: formatDate("2026-12-31", "en") },
  { label: "formatDate 2026-01-05", ro: formatDate("2026-01-05", "ro"), en: formatDate("2026-01-05", "en") },
];

export default function FormatPage() {
  return (
    <div className="min-h-screen bg-canvas p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h1 className="text-title text-text-primary">Format — locale acceptance table</h1>
        <p className="text-secondary text-text-muted">
          Same values through src/lib/format.ts with explicit locales. RO must match the
          pre-Stage-2 hardcoded output byte-for-byte; EN is the new rendering.
        </p>
        <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
          <table className="w-full text-secondary">
            <thead>
              <tr className="border-b border-border-hairline text-left text-micro uppercase text-text-muted">
                <th className={`${cell} font-normal`}>Sample</th>
                <th className={`${cell} font-normal text-right`}>ro</th>
                <th className={`${cell} font-normal text-right`}>en</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-border-hairline first:border-t-0">
                  <td className={`${cell} text-text-secondary`}>{row.label}</td>
                  <td className={`${cell} ${num} text-text-primary`}>{row.ro}</td>
                  <td className={`${cell} ${num} text-text-primary`}>{row.en}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
