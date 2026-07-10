"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bookHighConfidenceAction,
  bookImportRowAction,
  skipImportRowAction,
} from "@/lib/import/actions";
import { bookingNeedsCategory } from "@/lib/import/booking-rules";
import { formatDate, formatMinor } from "@/lib/format";
import { errorClass } from "@/components/forms/ui";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
import type { ClassifyReason, Confidence, ImportKind } from "@/lib/import/ing/classify";

interface InboxRow {
  id: string;
  lineNo: string;
  kind: ImportKind;
  confidence: Confidence;
  reason: ClassifyReason;
  status: string;
  overlapSuspect: boolean;
  resolvedExternalRef: string;
  suggestedCategoryId: string | null;
  transactionId: string | null;
  bookDate: string;
  direction: "debit" | "credit";
  amountMinor: number;
  counterpartyName: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  kind: "income" | "expense";
}

const STATUS_TONE: Record<string, string> = {
  booked: "text-status-positive-text",
  duplicate: "text-status-neutral-text",
  skipped: "text-text-muted",
};

function RefBadge({ externalRef }: { externalRef: string }) {
  const t = useTranslations("imports");
  const synthetic = externalRef.startsWith("ING:");
  return (
    <Badge variant={synthetic ? "outline" : "secondary"} title={externalRef}>
      {synthetic ? t("syntheticKey") : t("bankRef")}
    </Badge>
  );
}

function useImportLabels() {
  const t = useTranslations("imports");

  return {
    kind(kind: ImportKind) {
      switch (kind) {
        case "revenue":
          return t("kind.revenue");
        case "state_payment":
          return t("kind.statePayment");
        case "owner_transfer":
          return t("kind.ownerTransfer");
        case "professional_services":
          return t("kind.professionalServices");
        case "subscription":
          return t("kind.subscription");
        case "card_purchase":
          return t("kind.cardPurchase");
        case "bank_fee":
          return t("kind.bankFee");
        case "unknown":
          return t("kind.unknown");
      }
    },
    confidence(confidence: Confidence) {
      return confidence === "high" ? t("confidence.high") : t("confidence.low");
    },
    categoryKind(kind: CategoryOption["kind"]) {
      return kind === "income" ? t("categoryKind.income") : t("categoryKind.expense");
    },
    reason(reason: ClassifyReason) {
      switch (reason.code) {
        case "bankFeeNoCounterparty":
          return t("reason.bankFeeNoCounterparty");
        case "incomingFundsCredit":
          return t("reason.incomingFundsCredit");
        case "treasuryIban":
          return t("reason.treasuryIban");
        case "knownRecurringMerchant":
          return t("reason.knownRecurringMerchant", { merchant: reason.merchant });
        case "unrecognizedPos":
          return t("reason.unrecognizedPos");
        case "ownerNameMatch":
          return t("reason.ownerNameMatch", { counterparty: reason.counterparty });
        case "professionalMarker":
          return t("reason.professionalMarker", { counterparty: reason.counterparty });
        case "businessTransferNoMarker":
          return t("reason.businessTransferNoMarker");
        case "creditNoIncomingMarker":
          return t("reason.creditNoIncomingMarker");
        case "noClassificationRule":
          return t("reason.noClassificationRule");
      }
    },
    status(status: string) {
      switch (status) {
        case "booked":
          return t("status.booked");
        case "duplicate":
          return t("status.duplicate");
        case "skipped":
          return t("status.skipped");
        default:
          return status;
      }
    },
  };
}

function InboxRowItem({
  row,
  categories,
  profileSlug,
  entityId,
  batchId,
}: {
  row: InboxRow;
  categories: CategoryOption[];
  profileSlug: string;
  entityId: string;
  batchId: string;
}) {
  const [categoryId, setCategoryId] = useState(row.suggestedCategoryId ?? "");
  const t = useTranslations("imports");
  const labels = useImportLabels();
  const translateError = useTranslatedError();
  const locale = useLocale();
  const [error, setError] = useState<AppError | string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsCategory = bookingNeedsCategory(row.kind);
  const canBook = row.status === "pending" && (!needsCategory || categoryId !== "");
  const isCredit = row.direction === "credit";

  function book() {
    setError(null);
    startTransition(async () => {
      const result = await bookImportRowAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
        categoryId: needsCategory ? categoryId : null,
      });
      if ("error" in result) setError(result.error);
    });
  }

  function skip() {
    setError(null);
    startTransition(async () => {
      const result = await skipImportRowAction({ profileSlug, entityId, batchId, rowId: row.id });
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border-hairline py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-caption text-text-muted">#{row.lineNo}</span>
          <span className="truncate text-secondary text-text-primary">
            {row.counterpartyName ?? "—"}
          </span>
          <span className="text-caption text-text-muted">{formatDate(row.bookDate, locale)}</span>
        </div>
        <span
          className={`font-numeric tabular-nums text-secondary ${
            isCredit ? "text-status-positive-text" : "text-text-primary"
          }`}
        >
          {isCredit ? "+" : "−"}
          {formatMinor(row.amountMinor, "RON", locale)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{labels.kind(row.kind)}</Badge>
        <Badge variant={row.confidence === "high" ? "outline" : "destructive"}>
          {labels.confidence(row.confidence)}
        </Badge>
        <RefBadge externalRef={row.resolvedExternalRef} />
        {row.overlapSuspect && (
          <Badge variant="destructive" title={t("overlapTitle")}>
            {t("overlapConfirm")}
          </Badge>
        )}
        <span className="text-caption text-text-muted">{labels.reason(row.reason)}</span>
      </div>

      {row.status === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          {needsCategory && (
            <Select
              items={categories.map((c) => ({
                value: c.id,
                label: `${c.name} · ${labels.categoryKind(c.kind)}`,
              }))}
              value={categoryId}
              onValueChange={(v) => setCategoryId((v as string) ?? "")}
            >
              <SelectTrigger className="h-8 w-56 rounded-input border border-border-input bg-surface px-3 text-secondary text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-focus-ring">
                <SelectValue placeholder={t("pickCategory")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {labels.categoryKind(c.kind)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={book} disabled={!canBook || pending}>
            {t("book")}
          </Button>
          <Button size="sm" variant="ghost" onClick={skip} disabled={pending}>
            {t("skip")}
          </Button>
          {needsCategory && categoryId === "" && (
            <span className="text-caption text-text-muted">{t("categoryRequired")}</span>
          )}
        </div>
      ) : (
        <span className={`text-caption ${STATUS_TONE[row.status] ?? "text-text-muted"}`}>
          {labels.status(row.status)}
          {row.status === "duplicate" && ` ${t("alreadyInLedgerSuffix")}`}
        </span>
      )}
      {error && (
        <p className={errorClass}>
          {typeof error === "string" ? error : translateError(error)}
        </p>
      )}
    </div>
  );
}

export function ImportInbox({
  profileSlug,
  entityId,
  batchId,
  rows,
  categories,
}: {
  profileSlug: string;
  entityId: string;
  batchId: string;
  rows: InboxRow[];
  categories: CategoryOption[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const t = useTranslations("imports");
  const translateError = useTranslatedError();
  const [error, setError] = useState<AppError | string | null>(null);
  const [pending, startTransition] = useTransition();
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  function bookAll() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await bookHighConfidenceAction({ profileSlug, entityId, batchId });
      if ("error" in result) setError(result.error);
      else if (result.summary) {
        const parts = [t("bookedCount", { count: result.summary.booked })];
        if (result.summary.duplicates) {
          parts.push(t("duplicateCount", { count: result.summary.duplicates }));
        }
        if (result.summary.left) {
          parts.push(t("leftForReviewCount", { count: result.summary.left }));
        }
        setMessage(parts.join(", "));
      } else setMessage(t("done"));
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-text-muted">
          {t("pendingReviewSummary", { pending: pendingCount, total: rows.length })}
        </p>
        <Button size="sm" variant="secondary" onClick={bookAll} disabled={pending || pendingCount === 0}>
          {t("confirmAllHighConfidence")}
        </Button>
      </div>
      {message && <p className="text-caption text-status-positive-text">{message}</p>}
      {error && (
        <p className={errorClass}>
          {typeof error === "string" ? error : translateError(error)}
        </p>
      )}
      <div className="flex flex-col">
        {rows.map((row) => (
          <InboxRowItem
            key={row.id}
            row={row}
            categories={categories}
            profileSlug={profileSlug}
            entityId={entityId}
            batchId={batchId}
          />
        ))}
      </div>
    </div>
  );
}
