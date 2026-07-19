"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Calendar as CalendarIcon } from "lucide-react";

import type { Locale } from "@/i18n/config";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { focusCalendarDay } from "@/components/ui/date-field";
import {
  dateToIso,
  dropdownBounds,
  isoToDate,
} from "@/components/ui/date-field-engine";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Filter-pill skin of the date-picker pattern (D7): one range pill for the
 * transactions period. Client island inside the server GET form — the two
 * hidden inputs keep the `?from=&to=` URL contract byte-identical, and
 * submission stays on the explicit Apply button. Open-ended ranges (only
 * `from`, or only `to`) are first-class filter states.
 */
export function DateFilter({
  from,
  to,
  className,
}: {
  /** Applied filter values from the URL, ISO `yyyy-MM-dd`. */
  from?: string;
  to?: string;
  /** Pill classes, computed by the server page so the pill row stays one system. */
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("transactions");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ from: from ?? "", to: to ?? "" });

  const fromDate = draft.from ? isoToDate(draft.from) : null;
  const toDate = draft.to ? isoToDate(draft.to) : null;
  const bounds = dropdownBounds([draft.from, draft.to], new Date());
  // Controlled month: the popup stays mounted after its first open (L-0004),
  // so an uncontrolled month would go stale against a changed draft range.
  const [month, setMonth] = React.useState<Date | undefined>(undefined);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setMonth(fromDate ?? toDate ?? new Date());
    setOpen(nextOpen);
  };

  // Honest partial-range label: `01.03.2026 –` / `– 31.03.2026` / full span.
  const label =
    draft.from || draft.to
      ? `${draft.from ? formatDate(draft.from, locale) : ""} – ${
          draft.to ? formatDate(draft.to, locale) : ""
        }`.trim()
      : null;

  /**
   * Two-click contract (D5 range row): first pick starts the range and stays
   * open; the completing pick sorts the ends and closes. Picking with a full
   * range already set restarts. Implemented over the trigger date — v10's
   * built-in `addToRange` completes a range on the first click.
   */
  const handleSelect = (_range: unknown, triggerDate: Date) => {
    const picked = dateToIso(triggerDate);
    if (draft.from && !draft.to) {
      const [start, end] = [draft.from, picked].sort();
      setDraft({ from: start, to: end });
      setOpen(false);
    } else if (!draft.from && draft.to) {
      const [start, end] = [draft.to, picked].sort();
      setDraft({ from: start, to: end });
      setOpen(false);
    } else {
      setDraft({ from: picked, to: "" });
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={<button type="button" className={className} />}>
        {t("filterPeriod")}
        {label && <span className="text-secondary text-text-primary">{label}</span>}
        <CalendarIcon absoluteStrokeWidth strokeWidth={1.5} className="size-3.5" />
      </PopoverTrigger>
      {/* GET-param compatibility is absolute: empty submits `from=` exactly
          like an empty native input; the server's parseFilters is untouched. */}
      <input type="hidden" name="from" value={draft.from} />
      <input type="hidden" name="to" value={draft.to} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        initialFocus={focusCalendarDay}
        className="w-auto p-2"
      >
        <Calendar
          mode="range"
          autoFocus
          captionLayout="dropdown"
          startMonth={bounds.startMonth}
          endMonth={bounds.endMonth}
          selected={{ from: fromDate ?? undefined, to: toDate ?? undefined }}
          month={month}
          onMonthChange={setMonth}
          onSelect={handleSelect}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDraft({ from: "", to: "" })}
          >
            {tCommon("clear")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
