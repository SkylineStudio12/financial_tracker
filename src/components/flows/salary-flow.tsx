"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatMinor, parseAmountToMinor } from "@/lib/format";
import {
  previewSalary,
  saveSalary,
  type SalaryPreview,
} from "@/lib/ledger/flow-actions";
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
  const [preview, setPreview] = useState<SalaryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const rows: [string, number][] = preview
    ? [
        ["Gross", preview.gross],
        ["CAS (pension)", -preview.cas],
        ["CASS (health)", -preview.cass],
        ["Income tax", -preview.incomeTax],
        ["Net to employee", preview.net],
        ["CAM (employer)", preview.cam],
        ["Employer cost", preview.employerCost],
        ["Total accrued to tax liability", preview.totalAccrued],
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
          Employee name
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
          Month
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
          Gross salary (RON)
          <input
            ref={grossRef}
            inputMode="decimal"
            placeholder="0,00"
            className={fieldClass}
            value={gross}
            onChange={(e) => {
              setGross(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label className={labelClass}>
          Personal account (receives net)
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
        <div className="rounded-md border border-edge">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([label, amount]) => (
                <tr key={label} className="border-t border-edge first:border-t-0">
                  <td className="px-3 py-2 text-fg-muted">{label}</td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      amount < 0 ? "text-negative" : "text-fg"
                    }`}
                  >
                    {formatMinor(amount, "RON")}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-edge">
                <td colSpan={2} className="px-3 py-2 text-xs text-warning">
                  {preview.rateNote} · transaction date {preview.date}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {error && <p className={errorClass}>{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass} disabled={!inputsValid || pending}>
          {pending ? "Working…" : preview ? "Confirm and save" : "Preview breakdown"}
        </button>
      </div>
    </form>
  );
}
