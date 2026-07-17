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
import {
  defaultSalaryPaymentDate,
  salaryPayMonthAfterPaymentDateChange,
  salaryPaymentDateAfterPayMonthChange,
} from "@/lib/ledger/salary-dates";
import { getEmployeeSalaryPrefillAction } from "@/lib/management/actions";
import type { EmployeeOption } from "@/lib/management/service";
import { resolveAutomaticSalaryPrefill } from "@/lib/management/salary-prefill";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
import type { AccountOption } from "@/components/forms/option-types";
import { Button } from "@/components/ui/button";
import { errorClass, fieldClass, labelClass } from "@/components/forms/ui";

const currentMonth = () => new Date().toISOString().slice(0, 7);

function formatPayMonth(payMonth: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${payMonth}-01T00:00:00.000Z`));
}

export function SalaryFlow({
  companyId,
  personalAccounts,
  employees = [],
  initial,
  onSaved,
  cancelSlot,
  onDirtyChange,
}: {
  companyId: string;
  personalAccounts: AccountOption[];
  employees?: EmployeeOption[];
  initial?: {
    transactionId: string;
    expectedRevision: number;
    employeeName: string;
    payMonth: string;
    paymentDate: string;
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
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initialPayMonth = initial?.payMonth ?? currentMonth();
  const initialEmployee = initial
    ? employees.find(
        (employee) => employee.name.trim().toLowerCase() === initial.employeeName.trim().toLowerCase(),
      )
    : undefined;
  const [employeeId, setEmployeeId] = useState(initialEmployee?.id ?? (initial ? "legacy" : ""));
  const [employeeName, setEmployeeName] = useState(initial?.employeeName ?? "");
  const [payMonth, setPayMonth] = useState(initialPayMonth);
  const [paymentDate, setPaymentDate] = useState(
    initial?.paymentDate ?? defaultSalaryPaymentDate(initialPayMonth),
  );
  const paymentDateTouched = useRef(Boolean(initial));
  const payMonthTouched = useRef(Boolean(initial));
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
  const tCommon = useTranslations("common");
  const tForms = useTranslations("forms");
  const translateError = useTranslatedError();
  const [preview, setPreview] = useState<SalaryPreview | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [repeatMissing, setRepeatMissing] = useState(false);
  const [pending, startTransition] = useTransition();
  const grossRef = useRef<HTMLInputElement>(null);
  const employeeRef = useRef<HTMLSelectElement>(null);
  const prefillRequest = useRef(0);

  useEffect(() => {
    if (initial) grossRef.current?.focus();
    else employeeRef.current?.focus();
  }, [initial]);

  const valuesSnapshot = JSON.stringify({
    employeeId,
    employeeName,
    payMonth,
    paymentDate,
    gross,
    cas,
    cass,
    incomeTax,
    cam,
    net,
    personalDeduction,
    personalAccountId,
  });
  const [initialSnapshot] = useState(valuesSnapshot);
  const dirty = valuesSnapshot !== initialSnapshot;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const grossMinor = parseAmountToMinor(gross);
  const casMinor = parseAmountToMinor(cas);
  const cassMinor = parseAmountToMinor(cass);
  const incomeTaxMinor = parseAmountToMinor(incomeTax);
  const camMinor = parseAmountToMinor(cam);
  const netMinor = parseAmountToMinor(net);
  const personalDeductionMinor = parseAmountToMinor(personalDeduction);
  const inputsValid =
    employeeName.trim() !== "" &&
    /^\d{4}-\d{2}$/.test(payMonth) &&
    /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) &&
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

  const invalidate = () => {
    setPreview(null);
    setError(null);
    setRepeatMissing(false);
  };

  const applySalaryValues = (values: {
    gross: string;
    cas: string;
    cass: string;
    incomeTax: string;
    cam: string;
    net: string;
    personalDeduction: string;
    personalAccountId?: string;
  }) => {
    setGross(values.gross);
    setCas(values.cas);
    setCass(values.cass);
    setIncomeTax(values.incomeTax);
    setCam(values.cam);
    setNet(values.net);
    setPersonalDeduction(values.personalDeduction);
    if (values.personalAccountId) setPersonalAccountId(values.personalAccountId);
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
        payMonth,
        paymentDate,
        grossMinor,
        casMinor,
        cassMinor,
        incomeTaxMinor,
        camMinor,
        netMinor,
        personalDeductionMinor,
      });
      if ("error" in result) setError(result.error);
      else {
        setError(null);
        setPreview(result);
      }
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
        stay: true,
        companyId,
        employeeName,
        payMonth,
        paymentDate,
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
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (preview) confirm();
        else runPreview();
      }}
    >
      <p className="text-caption text-text-muted">
        {preview ? t("stepReview") : t("stepEntry")}
      </p>

      {!preview ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className={labelClass}>
                {t("employeeName")}
                <select
                  ref={employeeRef}
                  className={fieldClass}
                  value={employeeId}
                  onChange={(event) => {
                    const nextEmployeeId = event.target.value;
                    const request = prefillRequest.current + 1;
                    prefillRequest.current = request;
                    const selected = employees.find((employee) => employee.id === nextEmployeeId);
                    setEmployeeId(nextEmployeeId);
                    setEmployeeName(selected?.name ?? "");
                    invalidate();
                    if (!selected || initial) return;
                    startTransition(async () => {
                      const prefill = await getEmployeeSalaryPrefillAction(
                        companyId,
                        nextEmployeeId,
                      );
                      if ("error" in prefill) {
                        if (prefillRequest.current !== request) return;
                        setError(prefill.error);
                        return;
                      }
                      let repeatError: AppError | null = null;
                      const resolved = await resolveAutomaticSalaryPrefill(
                        prefill.value?.profile ?? null,
                        async () => {
                          const repeated = await repeatLastSalary(companyId, selected.name);
                          if (repeated && "error" in repeated) {
                            repeatError = repeated.error;
                            return null;
                          }
                          return repeated ?? null;
                        },
                      );
                      if (prefillRequest.current !== request) return;
                      if (repeatError) {
                        setError(repeatError);
                        return;
                      }
                      if (resolved.values) applySalaryValues(resolved.values);
                      else {
                        setGross("");
                        setCas("");
                        setCass("");
                        setIncomeTax("");
                        setCam("");
                        setNet("");
                        setPersonalDeduction("");
                      }
                      setRepeatMissing(false);
                    });
                  }}
                >
                  <option value="">{t("selectEmployee")}</option>
                  {initial && !initialEmployee && (
                    <option value="legacy">{initial.employeeName}</option>
                  )}
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </label>
              {!initial && employees.length === 0 && (
                <p className="text-caption text-status-warning-text">{t("noEmployees")}</p>
              )}
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
                      setPayMonth(result.payMonth);
                      setPaymentDate(result.paymentDate);
                      paymentDateTouched.current = true;
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
              {t("payMonth")}
              <input
                type="month"
                className={fieldClass}
                value={payMonth}
                onFocus={() => {
                  payMonthTouched.current = true;
                }}
                onChange={(event) => {
                  const nextPayMonth = event.target.value;
                  payMonthTouched.current = true;
                  setPayMonth(nextPayMonth);
                  setPaymentDate((current) =>
                    salaryPaymentDateAfterPayMonthChange(
                      nextPayMonth,
                      current,
                      paymentDateTouched.current,
                    ),
                  );
                  invalidate();
                }}
              />
            </label>
            <label className={labelClass}>
              {t("paymentDate")}
              <input
                type="date"
                className={fieldClass}
                value={paymentDate}
                onFocus={() => {
                  paymentDateTouched.current = true;
                }}
                onChange={(event) => {
                  const nextPaymentDate = event.target.value;
                  paymentDateTouched.current = true;
                  setPaymentDate(nextPaymentDate);
                  setPayMonth((current) =>
                    salaryPayMonthAfterPaymentDateChange(
                      nextPaymentDate,
                      current,
                      payMonthTouched.current,
                    ),
                  );
                  invalidate();
                }}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                onChange={(event) => {
                  setPersonalAccountId(event.target.value);
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
        </>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 border-y border-border-hairline py-3 sm:grid-cols-3">
            <div>
              <dt className="text-caption text-text-muted">{t("payMonth")}</dt>
              <dd className="text-secondary text-text-primary">
                {formatPayMonth(preview.payMonth, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">{t("accrualPeriod")}</dt>
              <dd className="text-secondary text-text-primary">
                {tCommon("periodQuarter", {
                  year: preview.accrualYear,
                  quarter: preview.accrualQuarter,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">{t("paymentDate")}</dt>
              <dd className="text-secondary text-text-primary">
                {formatDate(preview.paymentDate, locale)}
              </dd>
            </div>
          </dl>

          <table className="w-full text-secondary">
            <tbody>
              {rows.map(([id, label, amount]) => (
                <tr key={id} className="border-t border-border-hairline first:border-t-0">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">
                    {label}
                  </td>
                  <td
                    className={`px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right font-numeric tabular-nums ${
                      amount < 0 ? "text-status-negative-text" : "text-text-primary"
                    }`}
                  >
                    {formatMinor(amount, "RON", locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {error && <p className={errorClass}>{translateError(error)}</p>}
      {repeatMissing && <p className="text-secondary text-text-muted">{t("noPreviousSalary")}</p>}

      <div className="flex flex-wrap gap-2">
        {preview && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setPreview(null);
              setError(null);
            }}
          >
            {t("back")}
          </Button>
        )}
        <Button type="submit" disabled={!inputsValid || pending}>
          {pending ? t("working") : preview ? t("confirmSave") : t("continue")}
        </Button>
        {cancelSlot}
      </div>
    </form>
  );
}
