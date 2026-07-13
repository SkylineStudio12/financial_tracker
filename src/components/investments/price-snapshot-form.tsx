"use client";

/**
 * Manual price snapshot entry. Manual rows have highest provenance priority;
 * re-entering a (security, date) replaces rather than duplicates it.
 */
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatMinor, parseAmountToMinor } from "@/lib/format";
import { upsertPriceSnapshotAction } from "@/lib/investments/actions";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
import { errorClass, fieldClass, labelClass } from "@/components/forms/ui";

interface SecurityOption {
  id: string;
  ticker: string;
  name: string;
  currency: "RON" | "EUR" | "USD";
  latest?: { date: string; priceMinor: number };
}

export function PriceSnapshotForm({
  profileSlug,
  entityId,
  securities,
  today,
}: {
  profileSlug: string;
  entityId: string;
  securities: SecurityOption[];
  today: string;
}) {
  const [securityId, setSecurityId] = useState("");
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState("");
  const locale = useLocale();
  const t = useTranslations("investments");
  const tForms = useTranslations("forms");
  const translateError = useTranslatedError();
  const [error, setError] = useState<AppError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = securities.find((s) => s.id === securityId);
  const priceMinor = parseAmountToMinor(price);
  const canSave = !!securityId && priceMinor !== null && priceMinor > 0;

  function submit() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await upsertPriceSnapshotAction({
        profileSlug,
        entityId,
        securityId,
        date,
        priceMinor: priceMinor!,
      });
      if ("error" in result) setError(result.error);
      else setSaved(t("savedSnapshot", { ticker: selected?.ticker ?? "", price, date }));
    });
  }

  if (securities.length === 0) {
    return (
      <p className="text-secondary text-text-muted">
        {t("noSecurities")}
      </p>
    );
  }

  return (
    <form
      className="flex max-w-2xl flex-col gap-[var(--density-field-gap)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-1 gap-[var(--density-field-gap)] sm:grid-cols-3">
        <label className={labelClass}>
          {t("security")}
          <Select
            items={securities.map((s) => ({ value: s.id, label: `${s.ticker} (${s.currency})` }))}
            value={securityId}
            onValueChange={(v) => setSecurityId(v ?? "")}
          >
            <SelectTrigger className={fieldClass}>
              <SelectValue placeholder={tForms("pickPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {securities.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.ticker} ({s.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className={labelClass}>
          {tForms("date")}
          <input
            type="date"
            className={fieldClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className={labelClass}>
          {t("closingPrice")} {selected ? `(${selected.currency})` : ""}
          <input
            className={`${fieldClass} font-numeric`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={t("pricePlaceholder")}
          />
        </label>
      </div>
      {selected?.latest && (
        <p className="text-caption text-text-muted">
          {t("latestStored", {
            price: formatMinor(selected.latest.priceMinor, selected.currency, locale),
            date: formatDate(selected.latest.date, locale),
          })}
        </p>
      )}
      {error && <p className={errorClass}>{translateError(error)}</p>}
      {saved && <p className="text-caption text-status-positive-text">{saved}</p>}
      <div>
        <Button type="submit" size="sm" disabled={!canSave || pending}>
          {pending ? tForms("saving") : t("savePrice")}
        </Button>
      </div>
    </form>
  );
}
