"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { parseAmountToMinor } from "@/lib/format";
import { saveTransferTransaction, type TransferPayload } from "@/lib/ledger/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormOptions } from "./option-types";
import { errorClass, fieldClass, labelClass } from "./ui";

export interface TransferFormInitial {
  transactionId: string;
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
  const [error, setError] = useState<string | null>(null);
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
        <SelectValue placeholder="Pick…" />
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
          From account
          {accountSelect(fromAccountId, setFromAccountId)}
        </div>
        <div className={labelClass}>
          To account
          {accountSelect(toAccountId, setToAccountId)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
          Amount ({fromCurrency})
          <input
            ref={amountRef}
            inputMode="decimal"
            placeholder="0,00"
            className={fieldClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      </div>

      {crossCurrency && (
        <label className={labelClass}>
          Received amount ({toCurrency}) — accounts use different currencies
          <input
            inputMode="decimal"
            placeholder="0,00"
            className={fieldClass}
            value={received}
            onChange={(e) => setReceived(e.target.value)}
          />
        </label>
      )}

      <label className={labelClass}>
        Note (optional)
        <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {fromAccountId === toAccountId && (
        <p className={errorClass}>Pick two different accounts.</p>
      )}
      {error && <p className={errorClass}>{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!valid || pending}>
          {pending ? "Saving…" : initial ? "Save changes" : "Save transfer"}
        </Button>
        {cancelSlot}
      </div>
    </form>
  );
}
