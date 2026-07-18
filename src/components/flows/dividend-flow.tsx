"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatMinor, parseAmountToMinor } from "@/lib/format";
import {
  previewDividend,
  saveDividend,
  type DividendPreview,
} from "@/lib/ledger/flow-actions";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
import type { AccountOption } from "@/components/forms/option-types";
import { errorClass, fieldClass, labelClass, moneyFieldClass, primaryButtonClass } from "@/components/forms/ui";

const today = () => new Date().toISOString().slice(0, 10);

export function DividendFlow({
  companyId,
  personalAccounts,
  initial,
  onSaved,
  cancelSlot,
}: {
  companyId: string;
  personalAccounts: AccountOption[];
  initial?: {
    transactionId: string;
    expectedRevision: number;
    date: string;
    gross: string;
    personalAccountId: string;
  };
  onSaved?: () => void;
  cancelSlot?: React.ReactNode;
}) {
  const [date, setDate] = useState(initial?.date ?? today());
  const [gross, setGross] = useState(initial?.gross ?? "");
  const [personalAccountId, setPersonalAccountId] = useState(
    initial?.personalAccountId ?? personalAccounts[0]?.id ?? "",
  );
  const locale = useLocale();
  const t = useTranslations("flows");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const translateError = useTranslatedError();
  const [preview, setPreview] = useState<DividendPreview | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  const grossRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    grossRef.current?.focus();
  }, []);

  const grossMinor = parseAmountToMinor(gross);
  const inputsValid = date !== "" && grossMinor !== null && grossMinor > 0 && personalAccountId !== "";

  const invalidate = () => {
    setPreview(null);
    setError(null);
  };

  const runPreview = () => {
    if (!inputsValid || grossMinor === null) return;
    startTransition(async () => {
      const result = await previewDividend({ date, grossMinor });
      if ("error" in result) setError(result.error);
      else setPreview(result);
    });
  };

  const confirm = () => {
    if (!inputsValid || grossMinor === null) return;
    startTransition(async () => {
      const result = await saveDividend({
        transactionId: initial?.transactionId,
        expectedRevision: initial?.expectedRevision,
        stay: Boolean(initial),
        companyId,
        date,
        grossMinor,
        personalAccountId,
      });
      if (result && "error" in result) setError(result.error);
      else if (result && "ok" in result) onSaved?.();
    });
  };

  return (
    <form
      className="flex flex-col gap-4 max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        if (preview) confirm();
        else runPreview();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          {tForms("date")}
          <input
            type="date"
            className={fieldClass}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label className={labelClass}>
          {t("grossDividend")}
          <input
            ref={grossRef}
            inputMode="decimal"
            placeholder={tForms("amountPlaceholder")}
            className={moneyFieldClass}
            value={gross}
            onChange={(e) => {
              setGross(e.target.value);
              invalidate();
            }}
          />
        </label>
      </div>

      <label className={labelClass}>
        {t("personalAccount")}
        <select
          className={fieldClass}
          value={personalAccountId}
          onChange={(e) => {
            setPersonalAccountId(e.target.value);
            invalidate();
          }}
        >
          {personalAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </select>
      </label>

      {preview && (
        <div className="rounded-card border border-border-hairline bg-surface">
          <table className="w-full text-secondary">
            <tbody>
              <tr>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{t("rowGrossDividend")}</td>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums text-text-primary">{formatMinor(preview.gross, "RON", locale)}</td>
              </tr>
              <tr className="border-t border-border-hairline">
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{t("rowDividendTax")}</td>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums text-status-negative-text">
                  {formatMinor(-preview.withholdingTax, "RON", locale)}
                </td>
              </tr>
              <tr className="border-t border-border-hairline">
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{t("rowNetShareholder")}</td>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums text-text-primary">{formatMinor(preview.net, "RON", locale)}</td>
              </tr>
              <tr className="border-t border-border-hairline">
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary">
                  <span className="text-text-secondary">{t("rowCassAccrual")}</span>{" "}
                  <span className="rounded-badge px-1.5 py-0.5 text-micro uppercase bg-surface-inactive text-status-warning-text">
                    {tCommon("estimate")}
                  </span>
                </td>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums text-status-warning-text">
                  {formatMinor(-preview.cassEstimate, "RON", locale)}
                </td>
              </tr>
              <tr className="border-t border-border-hairline">
                <td colSpan={2} className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-caption text-status-warning-text">
                  {preview.rateNote}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {error && <p className={errorClass}>{translateError(error)}</p>}

      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass} disabled={!inputsValid || pending}>
          {pending ? t("working") : preview ? t("confirmSave") : t("previewBreakdown")}
        </button>
        {cancelSlot}
      </div>
    </form>
  );
}
