"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { parseAmountToMinor } from "@/lib/format";
import { saveOpeningBalanceTransaction } from "@/lib/ledger/actions";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import type { FormOptions } from "./option-types";
import { errorClass, fieldClass, labelClass, moneyFieldClass } from "./ui";

export function OpeningBalanceForm({
  entityId,
  options,
  initial,
  onSaved,
  cancelSlot,
}: {
  entityId: string;
  options: FormOptions;
  initial: {
    transactionId: string;
    expectedRevision: number;
    accountId: string;
    date: string;
    description: string;
    amount: string;
  };
  onSaved: () => void;
  cancelSlot?: React.ReactNode;
}) {
  const accounts = options.accounts.filter((account) => account.type !== "equity");
  const [accountId, setAccountId] = useState(initial.accountId);
  const [date, setDate] = useState(initial.date);
  const [description, setDescription] = useState(initial.description);
  const [amount, setAmount] = useState(initial.amount);
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("forms");
  const translateError = useTranslatedError();
  const amountMinor = parseAmountToMinor(amount);
  const currency = accounts.find((account) => account.id === accountId)?.currency ?? "RON";
  const valid = Boolean(accountId && date && amountMinor && amountMinor > 0);

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || amountMinor === null) return;
        startTransition(async () => {
          const result = await saveOpeningBalanceTransaction({
            transactionId: initial.transactionId,
            expectedRevision: initial.expectedRevision,
            entityId,
            accountId,
            date,
            description: description.trim(),
            amountMinor,
          });
          if ("error" in result) setError(result.error);
          else onSaved();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          {t("account")}
          <select className={fieldClass} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t("date")}
          <DateField value={date} onChange={setDate} />
        </label>
      </div>
      <label className={labelClass}>
        {t("amount", { currency })}
        <input className={moneyFieldClass} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <label className={labelClass}>
        {t("description")}
        <input className={fieldClass} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      {error && <p className={errorClass}>{translateError(error)}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!valid || pending}>
          {pending ? t("saving") : t("saveChanges")}
        </Button>
        {cancelSlot}
      </div>
    </form>
  );
}
