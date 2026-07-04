"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { parseAmountToMinor } from "@/lib/format";
import { saveTransferTransaction, type TransferPayload } from "@/lib/ledger/actions";
import type { FormOptions } from "./option-types";
import { errorClass, fieldClass, labelClass, primaryButtonClass } from "./ui";

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
  options,
  initial,
}: {
  entityId: string;
  options: FormOptions;
  initial?: TransferFormInitial;
}) {
  const transferable = options.accounts.filter((a) => a.type !== "equity");
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

  const submit = () => {
    if (!valid || amountMinor === null) return;
    const payload: TransferPayload = {
      transactionId: initial?.transactionId,
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
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          From account
          <select
            className={fieldClass}
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
          >
            {transferable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          To account
          <select
            className={fieldClass}
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
          >
            {transferable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
        </label>
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

      <div>
        <button type="submit" className={primaryButtonClass} disabled={!valid || pending}>
          {pending ? "Saving…" : initial ? "Save changes" : "Save transfer"}
        </button>
      </div>
    </form>
  );
}
