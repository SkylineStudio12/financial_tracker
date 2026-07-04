"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatMinor, parseAmountToMinor } from "@/lib/format";
import { saveStandardTransaction, type StandardPayload } from "@/lib/ledger/actions";
import type { FormOptions } from "./option-types";
import {
  errorClass,
  fieldClass,
  ghostButtonClass,
  labelClass,
  primaryButtonClass,
  toggleOffClass,
  toggleOnClass,
} from "./ui";

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
  options,
  initial,
}: {
  entityId: string;
  options: FormOptions;
  initial?: StandardFormInitial;
}) {
  const bankAccounts = options.accounts.filter((a) => a.type !== "equity");
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

  const submit = () => {
    if (!valid || totalMinor === null) return;
    const payload: StandardPayload = {
      transactionId: initial?.transactionId,
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
      if (result?.error) setError(result.error);
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
        <button
          type="button"
          className={direction === "expense" ? toggleOnClass : toggleOffClass}
          onClick={() => setDirection("expense")}
        >
          Expense
        </button>
        <button
          type="button"
          className={direction === "income" ? toggleOnClass : toggleOffClass}
          onClick={() => setDirection("income")}
        >
          Income
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Account
          <select
            className={fieldClass}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
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
      </div>

      <label className={labelClass}>
        Amount ({currency})
        <input
          ref={amountRef}
          inputMode="decimal"
          placeholder="0,00"
          className={fieldClass}
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </label>

      <label className={labelClass}>
        Description
        <input
          className={fieldClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="flex flex-col gap-2">
        {splits.map((split, index) => (
          <div key={index} className="flex items-end gap-2">
            <label className={`${labelClass} flex-1`}>
              {index === 0 ? "Category" : ""}
              <select
                className={fieldClass}
                value={split.categoryId}
                onChange={(e) =>
                  setSplits(splits.map((s, i) => (i === index ? { ...s, categoryId: e.target.value } : s)))
                }
              >
                <option value="">Pick…</option>
                {options.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {isSplit && (
              <label className={`${labelClass} w-32`}>
                {index === 0 ? `Amount (${currency})` : ""}
                <input
                  inputMode="decimal"
                  placeholder="0,00"
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
            + Add split
          </button>
          {splitMismatch && totalMinor !== null && splitSum !== null && (
            <span className={errorClass}>
              Splits {formatMinor(splitSum, currency)} ≠ total {formatMinor(totalMinor, currency)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Counterparty (optional)
          <input
            className={fieldClass}
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          />
        </label>
        <label className={labelClass}>
          Tags (comma-separated, optional)
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

      <div>
        <button type="submit" className={primaryButtonClass} disabled={!valid || pending}>
          {pending ? "Saving…" : initial ? "Save changes" : "Save transaction"}
        </button>
      </div>
    </form>
  );
}
