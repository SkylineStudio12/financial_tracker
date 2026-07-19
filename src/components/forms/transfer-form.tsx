"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { parseAmountToMinor } from "@/lib/format";
import { saveTransferTransaction, type TransferPayload } from "@/lib/ledger/actions";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormOptions } from "./option-types";
import { errorClass, fieldClass, labelClass, moneyFieldClass } from "./ui";

export interface TransferFormInitial {
  transactionId: string;
  expectedRevision: number;
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: string;
  received: string;
  note: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function TransferForm({
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
  initial?: TransferFormInitial;
  /** Modal mode: skip the redirect, reset for fast repeat entry, notify. */
  stay?: boolean;
  onSaved?: () => void;
  cancelSlot?: React.ReactNode;
  /** Reports whether any field differs from its initial value (close guard). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const transferable = options.accounts.filter((a) => a.type !== "equity");
  const accountItems = transferable.map((a) => ({
    value: a.id,
    label: `${a.name} (${a.currency})`,
  }));

  const t = useTranslations("forms");
  const translateError = useTranslatedError();
  const [fromAccountId, setFromAccountId] = useState(
    initial?.fromAccountId ?? transferable[0]?.id ?? "",
  );
  const [toAccountId, setToAccountId] = useState(
    initial?.toAccountId ?? transferable[1]?.id ?? "",
  );
  const [date, setDate] = useState(initial?.date ?? today());
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [received, setReceived] = useState(initial?.received ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  // autoFocus doesn't fire on hydration of server-rendered pages; focus manually.
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  // Dirty = any field differs from its first-render snapshot.
  const valuesSnapshot = JSON.stringify({ fromAccountId, toAccountId, date, amount, received, note });
  const [initialSnapshot] = useState(valuesSnapshot);
  const dirty = valuesSnapshot !== initialSnapshot;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const fromCurrency = options.accounts.find((a) => a.id === fromAccountId)?.currency ?? "RON";
  const toCurrency = options.accounts.find((a) => a.id === toAccountId)?.currency ?? "RON";
  const crossCurrency = fromCurrency !== toCurrency;
  const amountMinor = parseAmountToMinor(amount);
  const receivedMinor = parseAmountToMinor(received);

  const valid = useMemo(() => {
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId || !date) return false;
    if (amountMinor === null || amountMinor <= 0) return false;
    if (crossCurrency && (receivedMinor === null || receivedMinor <= 0)) return false;
    return true;
  }, [fromAccountId, toAccountId, date, amountMinor, crossCurrency, receivedMinor]);

  /** After a modal save: clear amounts/note, keep the account pair and date. */
  const resetForRepeat = () => {
    setAmount("");
    setReceived("");
    setNote("");
    setError(null);
    amountRef.current?.focus();
  };

  const submit = () => {
    if (!valid || amountMinor === null) return;
    const payload: TransferPayload = {
      transactionId: initial?.transactionId,
      expectedRevision: initial?.expectedRevision,
      stay,
      profileSlug,
      entityId,
      fromAccountId,
      toAccountId,
      date,
      amountMinor,
      receivedMinor: crossCurrency ? (receivedMinor ?? undefined) : undefined,
      note: note.trim() || undefined,
    };
    startTransition(async () => {
      const result = await saveTransferTransaction(payload);
      if (result && "error" in result) {
        setError(result.error);
      } else if (result && "ok" in result) {
        resetForRepeat();
        onSaved?.();
      }
    });
  };

  const accountSelect = (
    value: string,
    onChange: (value: string) => void,
  ) => (
    <Select
      items={accountItems}
      value={value === "" ? null : value}
      onValueChange={(next) => onChange((next as string) ?? "")}
    >
      <SelectTrigger>
        <SelectValue placeholder={t("pickPlaceholder")} />
      </SelectTrigger>
      <SelectContent>
        {accountItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <form
      className="flex flex-col gap-4 max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className={labelClass}>
          {t("fromAccount")}
          {accountSelect(fromAccountId, setFromAccountId)}
        </div>
        <div className={labelClass}>
          {t("toAccount")}
          {accountSelect(toAccountId, setToAccountId)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          {t("date")}
          <DateField value={date} onChange={setDate} />
        </label>
        <label className={labelClass}>
          {t("amount", { currency: fromCurrency })}
          <input
            ref={amountRef}
            inputMode="decimal"
            placeholder={t("amountPlaceholder")}
            className={moneyFieldClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      </div>

      {crossCurrency && (
        <label className={labelClass}>
          {t("receivedAmount", { currency: toCurrency })}
          <input
            inputMode="decimal"
            placeholder={t("amountPlaceholder")}
            className={moneyFieldClass}
            value={received}
            onChange={(e) => setReceived(e.target.value)}
          />
        </label>
      )}

      <label className={labelClass}>
        {t("noteOptional")}
        <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {fromAccountId === toAccountId && (
        <p className={errorClass}>{t("pickTwoDifferent")}</p>
      )}
      {error && <p className={errorClass}>{translateError(error)}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!valid || pending}>
          {pending ? t("saving") : initial ? t("saveChanges") : t("saveTransfer")}
        </Button>
        {cancelSlot}
      </div>
    </form>
  );
}
