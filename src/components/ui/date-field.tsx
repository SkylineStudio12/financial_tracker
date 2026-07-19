"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Calendar as CalendarIcon } from "lucide-react";

import type { Locale } from "@/i18n/config";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { errorClass } from "@/components/forms/ui";
import { Calendar } from "@/components/ui/calendar";
import {
  dateToIso,
  dropdownBounds,
  evaluateDateInput,
  isoToDate,
} from "@/components/ui/date-field-engine";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Initial focus for the picker popup (D5): the committed day if set, else
 * today — react-day-picker marks exactly one day button tabbable. Effect-
 * driven via Base UI's initialFocus (L-0005); RDP's own autoFocus fires too
 * early, while the popup subtree cannot yet take focus.
 */
export function focusCalendarDay(): HTMLElement | boolean {
  return (
    document.querySelector<HTMLElement>(
      '[data-slot=popover-content] button[data-day][tabindex="0"]',
    ) ?? true
  );
}

/**
 * Form-skin date field (D1/D2/D3): a real text input with the calendar as an
 * accelerator. String-in, string-out — `value` and `onChange` speak ISO
 * `yyyy-MM-dd`; `onChange` fires only when the text parses to a valid date,
 * or with `""` when the field is cleared. Invalid text is flagged on blur
 * (never per keystroke) and kept for the user to correct.
 */
export function DateField({
  value,
  onChange,
  onFocus,
  onOpenChange,
  disabled,
  className,
}: {
  /** ISO `yyyy-MM-dd`, or `""` for empty. */
  value: string;
  onChange: (iso: string) => void;
  /** Native focus on the text input (salary touched-tracking rides this). */
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  /** Picker open-intent — the salary flow's second touched trigger (D6). */
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("forms");
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => (value ? formatDate(value, locale) : ""));
  const [invalid, setInvalid] = React.useState(false);
  const groupRef = React.useRef<HTMLDivElement>(null);
  const errorId = React.useId();

  // External writes (programmatic prefill, derived state, locale toggle)
  // re-derive the text from the ISO value; our own commits do not, so typing
  // is never rewritten mid-edit — normalization waits for blur (§3.2).
  const [synced, setSynced] = React.useState({ value, locale });
  if (synced.value !== value || synced.locale !== locale) {
    setSynced({ value, locale });
    setText(value ? formatDate(value, locale) : "");
    setInvalid(false);
  }

  const commit = (iso: string) => {
    setSynced({ value: iso, locale });
    if (iso !== value) onChange(iso);
  };

  const selectedDate = value ? isoToDate(value) : null;
  const bounds = dropdownBounds([value], new Date());
  // Controlled month: the popup stays mounted after its first open (L-0004),
  // so an uncontrolled month would show a stale month after a typed commit.
  const [month, setMonth] = React.useState<Date | undefined>(undefined);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setMonth(selectedDate ?? new Date());
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <InputGroup
        ref={groupRef}
        className={cn(
          "h-[var(--density-control-height)] border-border-input bg-surface",
          className,
        )}
      >
        <InputGroupInput
          className="h-full pl-3 text-secondary text-text-primary"
          value={text}
          placeholder={t("datePlaceholder")}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onFocus={onFocus}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const evaluation = evaluateDateInput(next, locale);
            if (evaluation.kind === "valid") {
              commit(evaluation.iso);
              setInvalid(false);
            } else if (evaluation.kind === "empty") {
              commit("");
              setInvalid(false);
            }
          }}
          onBlur={() => {
            const evaluation = evaluateDateInput(text, locale);
            if (evaluation.kind === "invalid") {
              setInvalid(true);
              return;
            }
            setInvalid(false);
            if (evaluation.kind === "valid") {
              commit(evaluation.iso);
              setText(formatDate(evaluation.iso, locale));
            } else {
              commit("");
              setText("");
            }
          }}
          onKeyDown={(event) => {
            // Combobox convention (D5); focus alone never opens the popover.
            if (event.altKey && event.key === "ArrowDown" && !disabled) {
              event.preventDefault();
              handleOpenChange(true);
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <PopoverTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                className="rounded-badge"
                aria-label={t("openCalendar")}
                disabled={disabled}
              />
            }
          >
            {/* Color rides the ghost button (muted, lifts to primary on hover). */}
            <CalendarIcon absoluteStrokeWidth strokeWidth={1.5} className="size-4" />
          </PopoverTrigger>
        </InputGroupAddon>
      </InputGroup>
      {invalid && (
        <p id={errorId} className={errorClass}>
          {t("dateInvalid")}
        </p>
      )}
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        anchor={groupRef}
        initialFocus={focusCalendarDay}
        className="w-auto p-2"
      >
        <Calendar
          mode="single"
          required
          autoFocus
          captionLayout="dropdown"
          startMonth={bounds.startMonth}
          endMonth={bounds.endMonth}
          selected={selectedDate ?? undefined}
          month={month}
          onMonthChange={setMonth}
          onSelect={(date: Date | undefined) => {
            if (!date) return;
            const iso = dateToIso(date);
            commit(iso);
            setText(formatDate(iso, locale));
            setInvalid(false);
            handleOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
