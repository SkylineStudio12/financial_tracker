"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatMinor, parseAmountToMinor } from "@/lib/format";
import { saveStandardTransaction, type StandardPayload } from "@/lib/ledger/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormOptions } from "./option-types";
import { errorClass, fieldClass, ghostButtonClass, labelClass } from "./ui";

interface SplitDraft {
  categoryId: string;
  amount: string;
}

export interface StandardFormInitial {
  transactionId: string;
  accountId: string;
  date: string;
  description: string;
  direction: "expense" | "income";
  total: string;
  splits: SplitDraft[];
  tagNames: string[];
  counterparty: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function StandardForm({
  entityId,
  profileSlug,
  options,
  initial,
  stay = false,
  onSaved,
  cancelSlot,
  onDirtyChange,
}: {
  entityId: string;
  /** Active profile view, so redirecting saves land back on it. */
  profileSlug?: string;
  options: FormOptions;
  initial?: StandardFormInitial;
  /** Modal mode: skip the redirect, reset for fast repeat entry, notify. */
  stay?: boolean;
  onSaved?: () => void;
  cancelSlot?: React.ReactNode;
  /** Reports whether any field differs from its initial value (close guard). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const bankAccounts = options.accounts.filter((a) => a.type !== "equity");
  const accountItems = bankAccounts.map((a) => ({
    value: a.id,
    label: `${a.name} (${a.currency})`,
  }));
  const categoryItems = options.categories.map((c) => ({ value: c.id, label: c.name }));

  const locale = useLocale();
  const t = useTranslations("forms");
  const [direction, setDirection] = useState<"expense" | "income">(
    initial?.direction ?? "expense",
  );
  const [accountId, setAccountId] = useState(initial?.accountId ?? bankAccounts[0]?.id ?? "");
  const [date, setDate] = useState(initial?.date ?? today());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [total, setTotal] = useState(initial?.total ?? "");
  const [splits, setSplits] = useState<SplitDraft[]>(
    initial?.splits ?? [{ categoryId: "", amount: "" }],
  );
  const [tagsText, setTagsText] = useState(initial?.tagNames.join(", ") ?? "");
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // autoFocus doesn't fire on hydration of server-rendered pages; focus manually.
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  // Dirty = any field differs from its first-render snapshot.
  const valuesSnapshot = JSON.stringify({
    direction, accountId, date, total, description, splits, tagsText, counterparty,
  });
  const [initialSnapshot] = useState(valuesSnapshot);
  const dirty = valuesSnapshot !== initialSnapshot;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const currency = options.accounts.find((a) => a.id === accountId)?.currency ?? "RON";
  const totalMinor = parseAmountToMinor(total);
  const isSplit = splits.length > 1;
  const splitMinors = splits.map((s) => parseAmountToMinor(s.amount));
  const splitSum = isSplit
    ? splitMinors.reduce<number | null>(
        (sum, v) => (sum === null || v === null ? null : sum + v),
        0,
      )
    : totalMinor;
  const splitMismatch =
    isSplit && totalMinor !== null && splitSum !== null && splitSum !== totalMinor;

  const valid = useMemo(() => {
    if (!accountId || !date || !description.trim()) return false;
    if (totalMinor === null || totalMinor <= 0) return false;
    if (splits.some((s) => !s.categoryId)) return false;
    if (isSplit && (splitSum === null || splitSum !== totalMinor)) return false;
    return true;
  }, [accountId, date, description, totalMinor, splits, isSplit, splitSum]);

  /** After a modal save: clear the entry fields, keep account/date/direction
   * context, and put the cursor back in the amount for the next receipt. */
  const resetForRepeat = () => {
    setTotal("");
    setDescription("");
    setSplits([{ categoryId: "", amount: "" }]);
    setTagsText("");
    setCounterparty("");
    setError(null);
    amountRef.current?.focus();
  };

  const submit = () => {
    if (!valid || totalMinor === null) return;
    const payload: StandardPayload = {
      transactionId: initial?.transactionId,
      stay,
      profileSlug,
      entityId,
      accountId,
      date,
      description: description.trim(),
      direction,
      totalMinor,
      splits: splits.map((s, i) => ({
        categoryId: s.categoryId,
        amountMinor: isSplit ? splitMinors[i]! : totalMinor,
      })),
      tagNames: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      counterparty: counterparty.trim() || undefined,
    };
    startTransition(async () => {
      const result = await saveStandardTransaction(payload);
      if (result && "error" in result) {
        setError(result.error);
      } else if (result && "ok" in result) {
        resetForRepeat();
        onSaved?.();
      }
    });
  };

  return (
    <form
      className="flex flex-col gap-4 max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <Button
          type="button"
          variant={direction === "expense" ? "default" : "secondary"}
          onClick={() => setDirection("expense")}
        >
          {t("expense")}
        </Button>
        <Button
          type="button"
          variant={direction === "income" ? "default" : "secondary"}
          onClick={() => setDirection("income")}
        >
          {t("income")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          {t("account")}
          <Select
            items={accountItems}
            value={accountId}
            onValueChange={(value) => setAccountId((value as string) ?? "")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accountItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className={labelClass}>
          {t("date")}
          <input
            type="date"
            className={fieldClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>

      <label className={labelClass}>
        {t("amount", { currency })}
        <input
          ref={amountRef}
          inputMode="decimal"
          placeholder={t("amountPlaceholder")}
          className={fieldClass}
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </label>

      <label className={labelClass}>
        {t("description")}
        <input
          className={fieldClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="flex flex-col gap-2">
        {splits.map((split, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className={`${labelClass} flex-1`}>
              {index === 0 ? t("category") : ""}
              <Select
                items={categoryItems}
                value={split.categoryId === "" ? null : split.categoryId}
                onValueChange={(value) =>
                  setSplits(
                    splits.map((s, i) =>
                      i === index ? { ...s, categoryId: (value as string) ?? "" } : s,
                    ),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("pickPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {categoryItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isSplit && (
              <label className={`${labelClass} w-32`}>
                {index === 0 ? t("amount", { currency }) : ""}
                <input
                  inputMode="decimal"
                  placeholder={t("amountPlaceholder")}
                  className={fieldClass}
                  value={split.amount}
                  onChange={(e) =>
                    setSplits(splits.map((s, i) => (i === index ? { ...s, amount: e.target.value } : s)))
                  }
                />
              </label>
            )}
            {isSplit && (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => setSplits(splits.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => setSplits([...splits, { categoryId: "", amount: "" }])}
          >
            {t("addSplit")}
          </button>
          {splitMismatch && totalMinor !== null && splitSum !== null && (
            <span className={errorClass}>
              {t("splitMismatch", {
                sum: formatMinor(splitSum, currency, locale),
                total: formatMinor(totalMinor, currency, locale),
              })}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          {t("counterpartyOptional")}
          <input
            className={fieldClass}
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          />
        </label>
        <label className={labelClass}>
          {t("tagsOptional")}
          <input
            className={fieldClass}
            list="tag-suggestions"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
          />
          <datalist id="tag-suggestions">
            {options.tagNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      </div>

      {error && <p className={errorClass}>{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!valid || pending}>
          {pending ? t("saving") : initial ? t("saveChanges") : t("saveTransaction")}
        </Button>
        {cancelSlot}
      </div>
    </form>
  );
}
