"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  CATEGORY_ICON_GROUPS,
  CATEGORY_ICON_MAP,
  isCategoryIconName,
  type CategoryIconName,
} from "@/components/category-icons";
import { fieldClass } from "@/components/forms/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ICON_PROPS = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export function CategoryIconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("manage");
  const tIcons = useTranslations("icons");
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const cellRefs = useRef(new Map<CategoryIconName, HTMLButtonElement>());

  const groups = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return CATEGORY_ICON_GROUPS.map((group) => ({
      ...group,
      icons: group.icons.filter((name) =>
        `${name} ${tIcons(name)}`.toLocaleLowerCase().includes(needle),
      ),
    })).filter((group) => group.icons.length > 0);
  }, [filter, tIcons]);
  const visibleIcons = groups.flatMap((group) => group.icons);
  const safeActiveIndex = visibleIcons.length === 0 ? -1 : Math.min(activeIndex, visibleIcons.length - 1);
  const SelectedIcon = isCategoryIconName(value) ? CATEGORY_ICON_MAP[value] : null;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => filterRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const closeAfterSelection = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveFocus = (delta: number) => {
    if (visibleIcons.length === 0) return;
    const next = (safeActiveIndex + delta + visibleIcons.length) % visibleIcons.length;
    setActiveIndex(next);
    cellRefs.current.get(visibleIcons[next])?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setFilter("");
          setActiveIndex(0);
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            ref={triggerRef}
            type="button"
            className={`${fieldClass} flex items-center gap-1 text-left`}
          />
        }
      >
        {SelectedIcon && (
          <SelectedIcon
            {...ICON_PROPS}
            className="size-[var(--icon-size-inline)] shrink-0"
            aria-hidden="true"
            focusable="false"
          />
        )}
        <span className="min-w-0 flex-1 truncate">
          {isCategoryIconName(value) ? tIcons(value) : t("iconNone")}
        </span>
        <ChevronDown
          {...ICON_PROPS}
          className="size-[var(--icon-size-inline)] shrink-0 text-text-muted"
          aria-hidden="true"
          focusable="false"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-96 w-80 overflow-y-auto"
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          requestAnimationFrame(() => triggerRef.current?.focus());
        }}
      >
        <label className="relative block">
          <span className="sr-only">{t("iconSearch")}</span>
          <Search
            {...ICON_PROPS}
            className="pointer-events-none absolute left-3 top-1/2 size-[var(--icon-size-inline)] -translate-y-1/2 text-text-muted"
            aria-hidden="true"
            focusable="false"
          />
          <input
            ref={filterRef}
            type="search"
            className={`${fieldClass} pl-8`}
            value={filter}
            placeholder={t("iconSearch")}
            onChange={(event) => {
              setFilter(event.target.value);
              setActiveIndex(0);
            }}
          />
        </label>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-1 rounded-badge px-2 text-left text-secondary text-text-primary outline-none hover:bg-surface-inactive focus-visible:ring-3 focus-visible:ring-focus-ring"
          onClick={() => closeAfterSelection("")}
        >
          <span className="flex size-[var(--icon-size-default)] shrink-0 items-center justify-center">
            {!value && (
              <Check
                {...ICON_PROPS}
                className="size-[var(--icon-size-inline)]"
                aria-hidden="true"
                focusable="false"
              />
            )}
          </span>
          {t("iconNone")}
        </button>
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-1">
            <h3 className="text-micro uppercase text-text-muted">{t(`iconGroups.${group.key}`)}</h3>
            <div className="grid grid-cols-8 gap-1" role="group" aria-label={t(`iconGroups.${group.key}`)}>
              {group.icons.map((name) => {
                const Icon = CATEGORY_ICON_MAP[name];
                const index = visibleIcons.indexOf(name);
                const selected = value === name;
                return (
                  <button
                    key={name}
                    ref={(node) => {
                      if (node) cellRefs.current.set(name, node);
                      else cellRefs.current.delete(name);
                    }}
                    type="button"
                    className={`flex size-8 items-center justify-center rounded-badge text-text-primary outline-none hover:bg-surface-inactive focus-visible:ring-3 focus-visible:ring-focus-ring ${
                      selected ? "bg-accent text-accent-foreground" : ""
                    }`}
                    aria-label={tIcons(name)}
                    title={tIcons(name)}
                    aria-pressed={selected}
                    tabIndex={index === safeActiveIndex ? 0 : -1}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => closeAfterSelection(name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        closeAfterSelection(name);
                        return;
                      }
                      const delta =
                        event.key === "ArrowRight"
                          ? 1
                          : event.key === "ArrowLeft"
                            ? -1
                            : event.key === "ArrowDown"
                              ? 8
                              : event.key === "ArrowUp"
                                ? -8
                                : 0;
                      if (!delta) return;
                      event.preventDefault();
                      moveFocus(delta);
                    }}
                  >
                    <Icon
                      {...ICON_PROPS}
                      className="size-[var(--icon-size-default)]"
                      aria-hidden="true"
                      focusable="false"
                    />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {visibleIcons.length === 0 && (
          <p className="py-2 text-center text-caption text-text-muted">{t("iconNoResults")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
