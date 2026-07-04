"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatMinor, parseAmountToMinor } from "@/lib/format";
import {
  previewDividend,
  saveDividend,
  type DividendPreview,
} from "@/lib/ledger/flow-actions";
import type { AccountOption } from "@/components/forms/option-types";
import { errorClass, fieldClass, labelClass, primaryButtonClass } from "@/components/forms/ui";

const today = () => new Date().toISOString().slice(0, 10);

export function DividendFlow({
  companyId,
  personalAccounts,
}: {
  companyId: string;
  personalAccounts: AccountOption[];
}) {
  const [date, setDate] = useState(today());
  const [gross, setGross] = useState("");
  const [personalAccountId, setPersonalAccountId] = useState(personalAccounts[0]?.id ?? "");
  const [preview, setPreview] = useState<DividendPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      const result = await saveDividend({ companyId, date, grossMinor, personalAccountId });
      if (result?.error) setError(result.error);
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
          Date
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
          Gross dividend (RON)
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
      </div>

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

      {preview && (
        <div className="rounded-card border border-border-hairline bg-surface">
          <table className="w-full text-secondary">
            <tbody>
              <tr>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">Gross dividend</td>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums text-text-primary">{formatMinor(preview.gross, "RON")}</td>
              </tr>
              <tr className="border-t border-border-hairline">
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">Dividend tax (withheld)</td>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums text-status-negative-text">
                  {formatMinor(-preview.withholdingTax, "RON")}
                </td>
              </tr>
              <tr className="border-t border-border-hairline">
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">Net to shareholder</td>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums text-text-primary">{formatMinor(preview.net, "RON")}</td>
              </tr>
              <tr className="border-t border-border-hairline">
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary">
                  <span className="text-text-secondary">CASS accrual</span>{" "}
                  <span className="rounded-badge px-1.5 py-0.5 text-micro uppercase bg-surface-inactive text-status-warning-text">
                    ESTIMATE
                  </span>
                </td>
                <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums text-status-warning-text">
                  {formatMinor(-preview.cassEstimate, "RON")}
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

      {error && <p className={errorClass}>{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass} disabled={!inputsValid || pending}>
          {pending ? "Working…" : preview ? "Confirm and save" : "Preview breakdown"}
        </button>
      </div>
    </form>
  );
}
