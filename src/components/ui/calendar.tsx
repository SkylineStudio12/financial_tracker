"use client"

import * as React from "react"
import { useLocale } from "next-intl"
import { ro as roDateFns } from "date-fns/locale"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()
  // App-locale default (i18n Stage 2): an explicit `locale` prop still wins;
  // en falls through to react-day-picker's built-in enUS.
  const appLocale = useLocale()
  const resolvedLocale = locale ?? (appLocale === "ro" ? roDateFns : undefined)

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
 "group/calendar bg-surface p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      locale={resolvedLocale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(resolvedLocale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
 "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
 "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
 "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
 "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
 "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
 "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-secondary font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
 "relative rounded-(--cell-radius)",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
 "absolute inset-0 bg-surface-raised opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
 "font-medium select-none",
          captionLayout === "label"
            ? "text-secondary"
            : "flex items-center gap-1 rounded-(--cell-radius) text-secondary [&>svg]:size-3.5 [&>svg]:text-text-muted",
          defaultClassNames.caption_label
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
 "flex-1 rounded-(--cell-radius) text-caption font-normal text-text-muted select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
 "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
 "text-caption text-text-muted select-none",
          defaultClassNames.week_number
        ),
        day: cn(
 "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
          defaultClassNames.day
        ),
        range_start: cn(
 "relative isolate z-0 rounded-l-(--cell-radius) bg-surface-inactive after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-surface-inactive",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn(
 "relative isolate z-0 rounded-r-(--cell-radius) bg-surface-inactive after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-surface-inactive",
          defaultClassNames.range_end
        ),
        today: cn(
 "rounded-(--cell-radius) bg-surface-inactive text-text-primary data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
 "text-text-muted aria-selected:text-text-muted",
          defaultClassNames.outside
        ),
        disabled: cn(
 "text-text-muted opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon absoluteStrokeWidth strokeWidth={1.5} className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon absoluteStrokeWidth strokeWidth={1.5} className={cn("size-4", className)} {...props} />
            )
          }

          return (
            <ChevronDownIcon absoluteStrokeWidth strokeWidth={1.5} className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
 "relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-border-input group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-focus-ring data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-accent data-[range-end=true]:text-accent-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-surface-inactive data-[range-middle=true]:text-text-primary data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-accent data-[range-start=true]:text-accent-foreground data-[selected-single=true]:bg-accent data-[selected-single=true]:text-accent-foreground  [&>span]:text-caption [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
