"use client";

/**
 * Manual price snapshot entry — the guaranteed price path until an API
 * source is picked (owner decision: deferred until real tickers exist).
 * Upserts on (security, date): re-entering a date replaces, never
 * duplicates.
 */
import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
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
  const [error, setError] = useState<string | null>(null);
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
      else setSaved(`Saved ${selected?.ticker ?? ""} @ ${price} for ${date}.`);
    });
  }

  if (securities.length === 0) {
    return (
      <p className="text-secondary text-text-muted">
        No securities yet — record a first buy and its security appears here.
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
          Security
          <Select
            items={securities.map((s) => ({ value: s.id, label: `${s.ticker} (${s.currency})` }))}
            value={securityId}
            onValueChange={(v) => setSecurityId(v ?? "")}
          >
            <SelectTrigger className={fieldClass}>
              <SelectValue placeholder="Pick…" />
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
          Date
          <input
            type="date"
            className={fieldClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className={labelClass}>
          Closing price {selected ? `(${selected.currency})` : ""}
          <input
            className={`${fieldClass} font-numeric`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="102.50"
          />
        </label>
      </div>
      {selected?.latest && (
        <p className="text-caption text-text-muted">
          Latest stored: {formatMinor(selected.latest.priceMinor, selected.currency, locale)} on{" "}
          {formatDate(selected.latest.date, locale)}. Re-entering a date replaces its snapshot.
        </p>
      )}
      {error && <p className={errorClass}>{error}</p>}
      {saved && <p className="text-caption text-status-positive-text">{saved}</p>}
      <div>
        <Button type="submit" size="sm" disabled={!canSave || pending}>
          {pending ? "Saving…" : "Save price"}
        </Button>
      </div>
    </form>
  );
}
