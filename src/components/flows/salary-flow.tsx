"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatMinor, parseAmountToMinor } from "@/lib/format";
import {
  previewSalary,
  saveSalary,
  type SalaryPreview,
} from "@/lib/ledger/flow-actions";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
import type { AccountOption } from "@/components/forms/option-types";
import { errorClass, fieldClass, labelClass, primaryButtonClass } from "@/components/forms/ui";

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function SalaryFlow({
  companyId,
  personalAccounts,
}: {
  companyId: string;
  personalAccounts: AccountOption[];
}) {
  const [employeeName, setEmployeeName] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [gross, setGross] = useState("");
  const [personalAccountId, setPersonalAccountId] = useState(personalAccounts[0]?.id ?? "");
  const locale = useLocale();
  const t = useTranslations("flows");
  const tForms = useTranslations("forms");
  const translateError = useTranslatedError();
  const [preview, setPreview] = useState<SalaryPreview | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  const grossRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    grossRef.current?.focus();
  }, []);

  const grossMinor = parseAmountToMinor(gross);
  const inputsValid =
    employeeName.trim() !== "" &&
    /^\d{4}-\d{2}$/.test(month) &&
    grossMinor !== null &&
    grossMinor > 0 &&
    personalAccountId !== "";

  // Any input change invalidates a previously computed breakdown.
  const invalidate = () => {
    setPreview(null);
    setError(null);
  };

  const runPreview = () => {
    if (!inputsValid || grossMinor === null) return;
    startTransition(async () => {
      const result = await previewSalary({ month, grossMinor });
      if ("error" in result) setError(result.error);
      else setPreview(result);
    });
  };

  const confirm = () => {
    if (!inputsValid || grossMinor === null) return;
    startTransition(async () => {
      const result = await saveSalary({
        companyId,
        employeeName,
        month,
        grossMinor,
        personalAccountId,
      });
      if (result?.error) setError(result.error);
    });
  };

  // [stable row id, label, amount] — the id keys the row (labels translate,
  // keys never do; same split as periodKey/periodLabel).
  const rows: [string, string, number][] = preview
    ? [
        ["gross", t("rowGross"), preview.gross],
        ["cas", t("rowCas"), -preview.cas],
        ["cass", t("rowCass"), -preview.cass],
        ["incomeTax", t("rowIncomeTax"), -preview.incomeTax],
        ["net", t("rowNet"), preview.net],
        ["cam", t("rowCam"), preview.cam],
        ["employerCost", t("rowEmployerCost"), preview.employerCost],
        ["totalAccrued", t("rowTotalAccrued"), preview.totalAccrued],
      ]
    : [];

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
          {t("employeeName")}
          <input
            className={fieldClass}
            value={employeeName}
            onChange={(e) => {
              setEmployeeName(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label className={labelClass}>
          {t("month")}
          <input
            type="month"
            className={fieldClass}
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              invalidate();
            }}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          {t("grossSalary")}
          <input
            ref={grossRef}
            inputMode="decimal"
            placeholder={tForms("amountPlaceholder")}
            className={fieldClass}
            value={gross}
            onChange={(e) => {
              setGross(e.target.value);
              invalidate();
            }}
          />
        </label>
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
      </div>

      {preview && (
        <div className="rounded-card border border-border-hairline bg-surface">
          <table className="w-full text-secondary">
            <tbody>
              {rows.map(([id, label, amount]) => (
                <tr key={id} className="border-t border-border-hairline first:border-t-0">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{label}</td>
                  <td
                    className={`px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums ${
                      amount < 0 ? "text-status-negative-text" : "text-text-primary"
                    }`}
                  >
                    {formatMinor(amount, "RON", locale)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border-hairline">
                <td colSpan={2} className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-caption text-status-warning-text">
                  {preview.rateNote} · {t("transactionDate", { date: formatDate(preview.date, locale) })}
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
      </div>
    </form>
  );
}
