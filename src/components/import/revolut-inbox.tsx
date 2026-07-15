"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { errorClass } from "@/components/forms/ui";
import { useTranslatedError } from "@/components/use-translated-error";
import { formatMinor } from "@/lib/format";
import type { AppError } from "@/lib/app-error";
import {
  approveRevolutBatchAction,
  deleteBookedRevolutBatchAction,
  setRevolutRowExcludedAction,
} from "@/lib/import/revolut/brokerage-actions";
import type { RevolutBatchReversalPreview } from "@/lib/import/revolut/brokerage-queries";
import type { ApproveRevolutBatchResult, StoredRevolutVerification } from "@/lib/import/revolut/brokerage-service";
import type { RevolutKind } from "@/lib/import/revolut/parse";

interface InboxRow {
  id: string;
  lineNo: number;
  occurredAt: string;
  kind: RevolutKind;
  ticker: string | null;
  currency: "USD" | "EUR";
  totalMinor: number;
  quantityText: string | null;
  status: "pending" | "booked" | "skipped" | "duplicate" | "trashed" | "purged";
  suspectedDuplicate: boolean;
}

const GROUP_ORDER: RevolutKind[] = [
  "buy",
  "sell",
  "cash_top_up",
  "cash_withdrawal",
  "custody_fee",
  "dividend",
  "stock_split",
];

function VerificationReport({ report }: { report: StoredRevolutVerification }) {
  const t = useTranslations("imports.revolut");
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-3 border-y border-border-hairline py-4">
      <div>
        <h2 className="text-card-title text-text-primary">{t("verificationTitle")}</h2>
        <p className="text-caption text-text-muted">{t("externallyVerified")}</p>
      </div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {Object.entries(report.counts).map(([type, check]) => (
          <div key={type} className="flex justify-between gap-3 text-caption">
            <span className="text-text-muted">{type}</span>
            <span className="font-numeric text-text-primary">
              {check.actual}/{check.expected} {check.passed ? t("pass") : t("fail")}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-secondary">
        <span>{t("cashValue", { amount: formatMinor(report.endState.cashMinor.USD, "USD", locale) })}</span>
        <span>{t("cashValue", { amount: formatMinor(report.endState.cashMinor.EUR, "EUR", locale) })}</span>
      </div>
      <div>
        <h3 className="text-secondary text-text-primary">{t("holdingsTitle", { count: Object.keys(report.endState.holdings).length })}</h3>
        <div className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(report.endState.holdings).map(([ticker, quantity]) => (
            <span key={ticker} className="font-numeric text-caption text-text-muted">
              {ticker} {quantity}
            </span>
          ))}
        </div>
      </div>
      <div className="grid gap-1 sm:grid-cols-3">
        {report.splitChecks.map((split) => (
          <span key={split.lineNo} className="text-caption text-text-muted">
            {t("splitCheck", { ticker: split.ticker, ratio: split.ratio ?? "?", status: split.passed ? t("pass") : t("fail") })}
          </span>
        ))}
      </div>
      {report.pltrConsumption && (
        <p className="text-caption text-text-muted">
          {t("pltrCheck", {
            quantity: report.pltrConsumption.quantity,
            lots: report.pltrConsumption.lots.join(" + "),
            remaining: report.pltrConsumption.remainingPosition,
          })}
        </p>
      )}
      <div>
        <h3 className="text-secondary text-text-primary">{t("residualsTitle")}</h3>
        <div className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
          {report.buyResiduals.map((group) => (
            <span key={group.group} className="font-numeric text-caption text-text-muted">
              {t("residualSummary", {
                group: group.group,
                count: group.count,
                min: group.minMinor,
                median: group.p50Minor,
                max: group.maxMinor,
              })}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function RevolutInbox({
  profileSlug,
  entityId,
  batchId,
  report,
  rows,
  booked,
  reversal,
}: {
  profileSlug: string;
  entityId: string;
  batchId: string;
  report: StoredRevolutVerification;
  rows: InboxRow[];
  booked: boolean;
  reversal: RevolutBatchReversalPreview | null;
}) {
  const t = useTranslations("imports.revolut");
  const translateError = useTranslatedError();
  const locale = useLocale();
  const [localRows, setLocalRows] = useState(rows);
  const [error, setError] = useState<AppError | null>(null);
  const [deleteError, setDeleteError] = useState<AppError | null>(null);
  const [summary, setSummary] = useState<ApproveRevolutBatchResult | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(row: InboxRow, excluded: boolean) {
    setError(null);
    setLocalRows((current) =>
      current.map((item) => (item.id === row.id ? { ...item, status: excluded ? "skipped" : "pending" } : item)),
    );
    startTransition(async () => {
      const result = await setRevolutRowExcludedAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
        excluded,
      });
      if ("error" in result) {
        setError(result.error);
        setLocalRows(rows);
      }
    });
  }

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveRevolutBatchAction({ profileSlug, entityId, batchId });
      if ("error" in result) setError(result.error);
      else setSummary(result.summary);
    });
  }

  function deleteBatch() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteBookedRevolutBatchAction({ profileSlug, entityId, batchId });
      if (result && "error" in result) setDeleteError(result.error);
    });
  }

  const excludedCount = localRows.filter((row) => row.status === "skipped").length;
  const groups = GROUP_ORDER.map((kind) => ({ kind, rows: localRows.filter((row) => row.kind === kind) })).filter(
    (group) => group.rows.length > 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <VerificationReport report={report} />
      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-card-title text-text-primary">{t("reviewRowsTitle")}</h2>
          <p className="text-caption text-text-muted">
            {t("reviewSummary", { total: localRows.length, excluded: excludedCount })}
          </p>
        </div>
        {groups.map((group) => (
          <details key={group.kind} className="border-b border-border-hairline py-2" open>
            <summary className="cursor-pointer text-secondary text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-focus-ring">
              {t(`kind.${group.kind}`)} · {t("rowCount", { count: group.rows.length })}
            </summary>
            <div className="mt-2 flex flex-col">
              {group.rows.map((row) => {
                const excluded = row.status === "skipped";
                const locked = booked || row.status === "booked" || row.status === "duplicate";
                return (
                  <div key={row.id} className="flex items-center gap-3 border-t border-border-hairline py-2 first:border-t-0">
                    <Checkbox
                      checked={excluded}
                      disabled={locked || pending}
                      aria-label={t("excludeRow", { lineNo: row.lineNo })}
                      onCheckedChange={(checked) => toggle(row, checked === true)}
                    />
                    <span className="w-12 shrink-0 font-numeric text-caption text-text-muted">#{row.lineNo}</span>
                    <span className="min-w-0 flex-1 truncate text-secondary text-text-primary">
                      {row.ticker ?? t(`kind.${row.kind}`)}
                      {row.quantityText ? ` · ${row.quantityText}` : ""}
                    </span>
                    {row.suspectedDuplicate && <Badge variant="destructive">{t("suspectedDuplicate")}</Badge>}
                    {row.status === "duplicate" && <Badge variant="outline">{t("duplicate")}</Badge>}
                    {excluded && <Badge variant="secondary">{t("excluded")}</Badge>}
                    <span className="shrink-0 font-numeric text-secondary text-text-primary">
                      {formatMinor(row.totalMinor, row.currency, locale)}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </section>
      <section className="flex flex-col gap-2 border-t border-border-hairline pt-4">
        <p className="text-caption text-text-muted">{t("approvalWarning")}</p>
        {error && <p className={errorClass}>{translateError(error)}</p>}
        {summary && (
          <p className="text-caption text-status-positive-text">
            {t("approvedSummary", {
              booked: summary.booked,
              transactions: summary.transactions,
              splits: summary.splits,
              duplicates: summary.duplicates,
              excluded: summary.excluded,
            })}
          </p>
        )}
        <div>
          <Button onClick={approve} disabled={pending || booked || summary !== null}>
            {pending ? t("approving") : booked || summary ? t("approved") : t("approveAll")}
          </Button>
        </div>
      </section>
      {booked && reversal && (
        <section className="flex flex-col gap-2 border-t border-border-hairline pt-4">
          <div>
            <h2 className="text-card-title text-text-primary">{t("deleteTitle")}</h2>
            <p className="text-caption text-text-muted">{t("deleteIntro")}</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" disabled={pending} />}>
              <Trash2 absoluteStrokeWidth strokeWidth={1.5} />
              {t("deleteBatch")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("deleteConfirmBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex flex-col gap-1 border-y border-border-hairline py-3 text-secondary">
                <span>{t("deleteTransactionCount", { count: reversal.transactions })}</span>
                <span>{t("deleteMarkerCount", { count: reversal.markers })}</span>
                <strong className="font-medium text-status-negative-text">
                  {reversal.splits > 0
                    ? t("deleteSplitCount", {
                        count: reversal.splits,
                        tickers: reversal.splitTickers.join(", "),
                      })
                    : t("deleteNoSplits")}
                </strong>
              </div>
              {deleteError && <p className={errorClass}>{translateError(deleteError)}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>{t("deleteCancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={deleteBatch} disabled={pending}>
                  <Trash2 absoluteStrokeWidth strokeWidth={1.5} />
                  {pending ? t("deletingBatch") : t("deleteConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      )}
    </div>
  );
}
