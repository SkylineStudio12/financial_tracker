"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatMinor, parseAmountToMinor } from "@/lib/format";
import {
  previewSalary,
  repeatLastSalary,
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
  initial,
  onSaved,
  cancelSlot,
}: {
  companyId: string;
  personalAccounts: AccountOption[];
  initial?: {
    transactionId: string;
    expectedRevision: number;
    employeeName: string;
    month: string;
    gross: string;
    cas: string;
    cass: string;
    incomeTax: string;
    cam: string;
    net: string;
    personalDeduction: string;
    personalAccountId: string;
  };
  onSaved?: () => void;
  cancelSlot?: React.ReactNode;
}) {
  const [employeeName, setEmployeeName] = useState(initial?.employeeName ?? "");
  const [month, setMonth] = useState(initial?.month ?? currentMonth());
  const [gross, setGross] = useState(initial?.gross ?? "");
  const [cas, setCas] = useState(initial?.cas ?? "");
  const [cass, setCass] = useState(initial?.cass ?? "");
  const [incomeTax, setIncomeTax] = useState(initial?.incomeTax ?? "");
  const [cam, setCam] = useState(initial?.cam ?? "");
  const [net, setNet] = useState(initial?.net ?? "");
  const [personalDeduction, setPersonalDeduction] = useState(
    initial?.personalDeduction ?? "",
  );
  const [personalAccountId, setPersonalAccountId] = useState(
    initial?.personalAccountId ?? personalAccounts[0]?.id ?? "",
  );
  const locale = useLocale();
  const t = useTranslations("flows");
  const tForms = useTranslations("forms");
  const translateError = useTranslatedError();
  const [preview, setPreview] = useState<SalaryPreview | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [repeatMissing, setRepeatMissing] = useState(false);
  const [pending, startTransition] = useTransition();
  const grossRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    grossRef.current?.focus();
  }, []);

  const grossMinor = parseAmountToMinor(gross);
  const casMinor = parseAmountToMinor(cas);
  const cassMinor = parseAmountToMinor(cass);
  const incomeTaxMinor = parseAmountToMinor(incomeTax);
  const camMinor = parseAmountToMinor(cam);
  const netMinor = parseAmountToMinor(net);
  const personalDeductionMinor = parseAmountToMinor(personalDeduction);
  const inputsValid =
    employeeName.trim() !== "" &&
    /^\d{4}-\d{2}$/.test(month) &&
    grossMinor !== null &&
    grossMinor > 0 &&
    casMinor !== null &&
    casMinor > 0 &&
    cassMinor !== null &&
    cassMinor > 0 &&
    incomeTaxMinor !== null &&
    incomeTaxMinor > 0 &&
    camMinor !== null &&
    camMinor > 0 &&
    netMinor !== null &&
    netMinor > 0 &&
    personalDeductionMinor !== null &&
    personalDeductionMinor >= 0 &&
    personalAccountId !== "";

  // Any input change invalidates a previously computed breakdown.
  const invalidate = () => {
    setPreview(null);
    setError(null);
    setRepeatMissing(false);
  };

  const runPreview = () => {
    if (
      !inputsValid ||
      grossMinor === null ||
      casMinor === null ||
      cassMinor === null ||
      incomeTaxMinor === null ||
      camMinor === null ||
      netMinor === null ||
      personalDeductionMinor === null
    ) {
      return;
    }
    startTransition(async () => {
      const result = await previewSalary({
        month,
        grossMinor,
        casMinor,
        cassMinor,
        incomeTaxMinor,
        camMinor,
        netMinor,
        personalDeductionMinor,
      });
      if ("error" in result) setError(result.error);
      else setPreview(result);
    });
  };

  const confirm = () => {
    if (
      !inputsValid ||
      grossMinor === null ||
      casMinor === null ||
      cassMinor === null ||
      incomeTaxMinor === null ||
      camMinor === null ||
      netMinor === null ||
      personalDeductionMinor === null
    ) {
      return;
    }
    startTransition(async () => {
      const result = await saveSalary({
        transactionId: initial?.transactionId,
        expectedRevision: initial?.expectedRevision,
        stay: Boolean(initial),
        companyId,
        employeeName,
        month,
        grossMinor,
        casMinor,
        cassMinor,
        incomeTaxMinor,
        camMinor,
        netMinor,
        personalDeductionMinor,
        personalAccountId,
      });
      if (result && "error" in result) setError(result.error);
      else if (result && "ok" in result) onSaved?.();
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
        ["personalDeduction", t("rowPersonalDeduction"), preview.personalDeduction],
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
        <div className="flex flex-col gap-1">
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
          {!initial && (
            <button
              type="button"
              className="self-start rounded-input px-2 py-1 text-caption text-accent outline-none hover:text-accent-hover focus-visible:ring-3 focus-visible:ring-focus-ring disabled:opacity-50"
              disabled={!employeeName.trim() || pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await repeatLastSalary(companyId, employeeName);
                  if (result && "error" in result) {
                    setError(result.error);
                    return;
                  }
                  if (!result) {
                    setRepeatMissing(true);
                    setError(null);
                    return;
                  }
                  setEmployeeName(result.employeeName);
                  setMonth(result.month);
                  setGross(result.gross);
                  setCas(result.cas);
                  setCass(result.cass);
                  setIncomeTax(result.incomeTax);
                  setCam(result.cam);
                  setNet(result.net);
                  setPersonalDeduction(result.personalDeduction);
                  setPersonalAccountId(result.personalAccountId);
                  setPreview(null);
                  setError(null);
                  setRepeatMissing(false);
                });
              }}
            >
              {t("repeatLastSalary")}
            </button>
          )}
        </div>
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
        {[
          [t("grossSalary"), gross, setGross, grossRef],
          [t("rowCas"), cas, setCas, null],
          [t("rowCass"), cass, setCass, null],
          [t("rowIncomeTax"), incomeTax, setIncomeTax, null],
          [t("rowCam"), cam, setCam, null],
          [t("rowNet"), net, setNet, null],
          [t("rowPersonalDeduction"), personalDeduction, setPersonalDeduction, null],
        ].map(([label, value, setter, ref]) => (
          <label key={label as string} className={labelClass}>
            {label as string}
            <input
              ref={ref as React.RefObject<HTMLInputElement> | undefined}
              inputMode="decimal"
              placeholder={tForms("amountPlaceholder")}
              className={fieldClass}
              value={value as string}
              onChange={(event) => {
                (setter as (next: string) => void)(event.target.value);
                invalidate();
              }}
            />
          </label>
        ))}
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
                  {t("transactionDate", { date: formatDate(preview.date, locale) })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {error && <p className={errorClass}>{translateError(error)}</p>}
      {repeatMissing && <p className="text-secondary text-text-muted">{t("noPreviousSalary")}</p>}

      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass} disabled={!inputsValid || pending}>
          {pending ? t("working") : preview ? t("confirmSave") : t("previewBreakdown")}
        </button>
        {cancelSlot}
      </div>
    </form>
  );
}
