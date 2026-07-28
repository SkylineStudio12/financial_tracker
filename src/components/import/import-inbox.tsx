"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  bookConfirmedRowsAction,
  confirmDrawingImportRowAction,
  confirmHighConfidenceAction,
  confirmImportRowAction,
  linkImportRowAction,
  reopenSkippedImportRowAction,
  reopenTrashedImportRowAction,
  skipImportRowAction,
  unconfirmImportRowAction,
  unlinkImportRowAction,
} from "@/lib/import/actions";
import { bookingNeedsCategory } from "@/lib/import/booking-rules";
import { formatDate, formatMinor } from "@/lib/format";
import { errorClass } from "@/components/forms/ui";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
import type { IngFxDetails } from "@/lib/import/ing/types";
import type { ClassifyReason, Confidence, ImportKind } from "@/lib/import/ing/classify";
import { IMPORT_LINK_DATE_WINDOW_DAYS } from "@/lib/import/linking";

const ICON_PROPS = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export interface InboxRow {
  id: string;
  lineNo: string;
  kind: ImportKind;
  confidence: Confidence;
  reason: ClassifyReason;
  status: string;
  overlapSuspect: boolean;
  resolvedExternalRef: string;
  suggestedCategoryId: string | null;
  confirmedCategoryId: string | null;
  reviewDisposition: "standard" | "drawing" | "linked_existing" | null;
  transactionId: string | null;
  manuallyLinked: boolean;
  linkCandidates: ImportLinkCandidate[];
  confirmedCategoryName: string | null;
  skipReasonCode: string | null;
  skipReasonNote: string | null;
  bookDate: string;
  direction: "debit" | "credit";
  amountMinor: number;
  balanceAfterMinor: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  description: string;
  rawLines: string[];
  bankReference: string | null;
  internalReference: string | null;
  instantReference: string | null;
  fx: IngFxDetails | null;
}

interface ImportLinkCandidate {
  transactionId: string;
  date: string;
  description: string | null;
  kind: string;
  amountMinor: number;
  alreadyLinked: boolean;
}

interface CategoryOption {
  id: string;
  name: string;
  kind: "income" | "expense";
}

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
        case "revenue": return t("kind.revenue");
        case "state_payment": return t("kind.statePayment");
        case "owner_transfer": return t("kind.ownerTransfer");
        case "professional_services": return t("kind.professionalServices");
        case "subscription": return t("kind.subscription");
        case "card_purchase": return t("kind.cardPurchase");
        case "bank_fee": return t("kind.bankFee");
        case "unknown": return t("kind.unknown");
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
        case "bankFeeNoCounterparty": return t("reason.bankFeeNoCounterparty");
        case "incomingFundsCredit": return t("reason.incomingFundsCredit");
        case "treasuryIban": return t("reason.treasuryIban");
        case "knownRecurringMerchant": return t("reason.knownRecurringMerchant", { merchant: reason.merchant });
        case "unrecognizedPos": return t("reason.unrecognizedPos");
        case "ownerNameMatch": return t("reason.ownerNameMatch", { counterparty: reason.counterparty });
        case "professionalMarker": return t("reason.professionalMarker", { counterparty: reason.counterparty });
        case "businessTransferNoMarker": return t("reason.businessTransferNoMarker");
        case "creditNoIncomingMarker": return t("reason.creditNoIncomingMarker");
        case "noClassificationRule": return t("reason.noClassificationRule");
      }
    },
  };
}

function TransactionLink({ profileSlug, transactionId }: { profileSlug: string; transactionId: string | null }) {
  const t = useTranslations("imports");
  if (!transactionId) return null;
  return (
    <Link
      href={`/p/${profileSlug}/transactions/${transactionId}`}
      className="text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-focus-ring"
    >
      {t("viewTransaction")}
    </Link>
  );
}

function RowEvidence({ row }: { row: InboxRow }) {
  const t = useTranslations("imports");
  const locale = useLocale();
  const refs = [
    row.bankReference && [t("detailBankReference"), row.bankReference],
    row.internalReference && [t("detailInternalReference"), row.internalReference],
    row.instantReference && [t("detailInstantReference"), row.instantReference],
    [t("detailResolvedReference"), row.resolvedExternalRef],
  ].filter(Boolean) as [string, string][];

  return (
    <details className="text-caption text-text-muted">
      <summary className="w-fit cursor-pointer outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-focus-ring">
        {t("rowDetails")}
      </summary>
      <div className="mt-2 grid gap-2 rounded-input border border-border-hairline bg-surface-inactive p-3">
        {row.counterpartyIban && <p>{t("detailCounterpartyIban", { iban: row.counterpartyIban })}</p>}
        {row.description && <p>{t("detailDescription", { description: row.description })}</p>}
        <dl className="grid gap-1">
          {refs.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
              <dt>{label}</dt>
              <dd className="break-all text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p>{t("detailRawLines")}</p>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-caption text-text-primary">
            {row.rawLines.join("\n")}
          </pre>
        </div>
        <p className="font-numeric tabular-nums">
          {t("balanceAfter", { amount: formatMinor(row.balanceAfterMinor, "RON", locale) })}
        </p>
      </div>
    </details>
  );
}

function ExistingTransactionLinker({
  row,
  profileSlug,
  entityId,
  batchId,
}: {
  row: InboxRow;
  profileSlug: string;
  entityId: string;
  batchId: string;
}) {
  const t = useTranslations("imports");
  const locale = useLocale();
  const translateError = useTranslatedError();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleCandidates = row.linkCandidates.filter((candidate) => {
    if (!normalizedSearch) return true;
    return [
      candidate.date,
      candidate.description ?? "",
      candidate.kind,
      candidate.transactionId,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setSearch("");
      setSelectedId("");
      setError(null);
    }
    setOpen(nextOpen);
  }

  function linkSelected() {
    if (!selectedId) return;
    setError(null);
    startTransition(async () => {
      const result = await linkImportRowAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
        transactionId: selectedId,
      });
      if ("error" in result) setError(result.error as AppError);
      else {
        setOpen(false);
        setSearch("");
        setSelectedId("");
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={<Button size="sm" variant="secondary" />}>
        {t("linkExisting")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))]">
        <PopoverHeader>
          <PopoverTitle>{t("linkTitle")}</PopoverTitle>
          <PopoverDescription>
            {t("linkDescription", { days: IMPORT_LINK_DATE_WINDOW_DAYS })}
          </PopoverDescription>
        </PopoverHeader>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("linkSearchPlaceholder")}
        />
        <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
          {visibleCandidates.length === 0 && (
            <p className="p-2 text-caption text-text-muted">{t("linkNoMatches")}</p>
          )}
          {visibleCandidates.map((candidate) => (
            <Button
              key={candidate.transactionId}
              type="button"
              variant={selectedId === candidate.transactionId ? "secondary" : "ghost"}
              className="h-auto justify-start px-2 py-2 text-left"
              disabled={candidate.alreadyLinked || pending}
              onClick={() => setSelectedId(candidate.transactionId)}
            >
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="w-full truncate text-secondary text-text-primary">
                  {candidate.description ?? t("transactionDescriptionUnavailable")}
                </span>
                <span className="text-caption text-text-muted">
                  {formatDate(candidate.date, locale)} ·{" "}
                  {formatMinor(candidate.amountMinor, "RON", locale)} · {candidate.kind}
                  {candidate.alreadyLinked ? ` · ${t("transactionAlreadyLinked")}` : ""}
                </span>
              </span>
            </Button>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button size="sm" onClick={linkSelected} disabled={!selectedId || pending}>
            {t("linkSelected")}
          </Button>
        </div>
        {error && <p className={errorClass}>{translateError(error)}</p>}
      </PopoverContent>
    </Popover>
  );
}

function InboxRowItem({
  row,
  categories,
  profileSlug,
  entityId,
  batchId,
  externalError,
}: {
  row: InboxRow;
  categories: CategoryOption[];
  profileSlug: string;
  entityId: string;
  batchId: string;
  externalError?: AppError;
}) {
  const [categoryId, setCategoryId] = useState(
    row.confirmedCategoryId ?? row.suggestedCategoryId ?? "",
  );
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipNote, setSkipNote] = useState("");
  const t = useTranslations("imports");
  const labels = useImportLabels();
  const translateError = useTranslatedError();
  const locale = useLocale();
  const [error, setError] = useState<AppError | string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsCategory = bookingNeedsCategory(row.kind);
  const canConfirm = row.status === "pending" && (!needsCategory || categoryId !== "");
  const isCredit = row.direction === "credit";
  const suggested = needsCategory && row.suggestedCategoryId !== null && !categoryTouched;
  const resolved = row.status !== "pending" && row.status !== "confirmed";
  const displayError = error ?? externalError;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmImportRowAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
        categoryId: needsCategory ? categoryId : null,
      });
      if ("error" in result) setError(result.error);
    });
  }

  function confirmDrawing() {
    setError(null);
    startTransition(async () => {
      const result = await confirmDrawingImportRowAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
      });
      if ("error" in result) setError(result.error);
    });
  }

  function unconfirm() {
    setError(null);
    startTransition(async () => {
      const result = await unconfirmImportRowAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
      });
      if ("error" in result) setError(result.error);
    });
  }

  function skip() {
    setError(null);
    startTransition(async () => {
      const result = await skipImportRowAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
        note: skipNote,
      });
      if ("error" in result) setError(result.error);
      else {
        setSkipOpen(false);
        setSkipNote("");
      }
    });
  }

  function reopen() {
    setError(null);
    startTransition(async () => {
      const result = await reopenSkippedImportRowAction({ profileSlug, entityId, batchId, rowId: row.id });
      if ("error" in result) setError(result.error);
    });
  }

  function reopenForRebooking() {
    setError(null);
    startTransition(async () => {
      const result = await reopenTrashedImportRowAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
      });
      if ("error" in result) setError(result.error);
    });
  }

  function unlink() {
    setError(null);
    startTransition(async () => {
      const result = await unlinkImportRowAction({
        profileSlug,
        entityId,
        batchId,
        rowId: row.id,
      });
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <article
      className={`flex flex-col gap-2 border-b border-border-hairline py-3 last:border-b-0 ${resolved ? "text-text-muted" : ""}`}
      data-row-status={row.status}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-caption text-text-muted">#{row.lineNo}</span>
          <span className={`truncate text-secondary ${resolved ? "text-text-muted" : "text-text-primary"}`}>
            {row.counterpartyName ?? t("counterpartyUnavailable")}
          </span>
          <span className="text-caption text-text-muted">{formatDate(row.bookDate, locale)}</span>
        </div>
        <span
          className={`font-numeric tabular-nums text-secondary ${resolved ? "text-text-muted" : isCredit ? "text-status-positive-text" : "text-text-primary"}`}
        >
          {isCredit ? "+" : "−"}{formatMinor(row.amountMinor, "RON", locale)}
        </span>
      </div>

      {row.fx && (
        <p className="self-end font-numeric tabular-nums text-caption text-text-muted">
          {formatMinor(row.fx.originalAmountMinor, row.fx.originalCurrency, locale)} × {row.fx.printedRate}
        </p>
      )}
      <p className="self-end font-numeric tabular-nums text-caption text-text-muted">
        {t("balanceAfter", { amount: formatMinor(row.balanceAfterMinor, "RON", locale) })}
      </p>

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

      {row.status === "pending" && (
        <div className="flex flex-wrap items-end gap-2">
          {needsCategory && (
            <div className={`flex flex-col gap-1 rounded-input border p-2 ${suggested ? "border-dashed border-border-input" : "border-border-input"}`}>
              {suggested && (
                <span className="inline-flex items-center gap-1 text-caption text-text-muted">
                  <Sparkles className="size-[var(--icon-size-inline)]" {...ICON_PROPS} aria-hidden="true" focusable="false" />
                  {t("suggested")}
                </span>
              )}
              <Select
                items={categories.map((candidate) => ({ value: candidate.id, label: `${candidate.name} · ${labels.categoryKind(candidate.kind)}` }))}
                value={categoryId}
                onOpenChange={(open) => { if (open) setCategoryTouched(true); }}
                onValueChange={(value) => {
                  setCategoryTouched(true);
                  setCategoryId((value as string) ?? "");
                }}
              >
                <SelectTrigger className="h-8 w-56 rounded-input border border-border-input bg-surface px-3 text-secondary text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-focus-ring">
                  <SelectValue placeholder={t("pickCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name} · {labels.categoryKind(candidate.kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {row.kind === "owner_transfer" ? (
            <Button size="sm" onClick={confirmDrawing} disabled={pending}>
              {t("drawing")}
            </Button>
          ) : (
            <Button size="sm" onClick={confirm} disabled={!canConfirm || pending}>
              {t("confirm")}
            </Button>
          )}
          <ExistingTransactionLinker
            row={row}
            profileSlug={profileSlug}
            entityId={entityId}
            batchId={batchId}
          />
          <Popover open={skipOpen} onOpenChange={setSkipOpen}>
            <PopoverTrigger render={<Button size="sm" variant="ghost" disabled={pending} />}>
              {t("skipEllipsis")}
            </PopoverTrigger>
            <PopoverContent align="start">
              <PopoverHeader>
                <PopoverTitle>{t("skipTitle")}</PopoverTitle>
                <PopoverDescription>{t("skipDescription")}</PopoverDescription>
              </PopoverHeader>
              <label className="flex flex-col gap-1 text-caption text-text-muted">
                {t("skipNoteLabel")}
                <Textarea value={skipNote} onChange={(event) => setSkipNote(event.target.value)} placeholder={t("skipNotePlaceholder")} />
              </label>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSkipOpen(false)} disabled={pending}>{t("cancel")}</Button>
                <Button size="sm" onClick={skip} disabled={pending}>{t("skip")}</Button>
              </div>
            </PopoverContent>
          </Popover>
          {needsCategory && categoryId === "" && <span className="text-caption text-text-muted">{t("categoryRequired")}</span>}
        </div>
      )}

      {row.status === "confirmed" && (
        <div className="flex flex-wrap items-center gap-2 text-caption text-text-primary">
          <span>
            {t("confirmedStatus")}
            {row.confirmedCategoryName && ` · ${row.confirmedCategoryName}`}
            {row.reviewDisposition === "drawing" && ` · ${t("drawing")}`}
          </span>
          <Button size="sm" variant="ghost" onClick={unconfirm} disabled={pending}>
            {t("unconfirm")}
          </Button>
          <ExistingTransactionLinker
            row={row}
            profileSlug={profileSlug}
            entityId={entityId}
            batchId={batchId}
          />
        </div>
      )}
      {row.status === "booked" && (
        <p className="flex flex-wrap items-center gap-2 text-caption text-status-positive-text">
          {t("bookedStatus")}{row.confirmedCategoryName && ` · ${row.confirmedCategoryName}`} <TransactionLink profileSlug={profileSlug} transactionId={row.transactionId} />
        </p>
      )}
      {row.status === "duplicate" && (
        <p className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
          {row.manuallyLinked ? t("linkedExistingStatus") : t("alreadyImported")}{" "}
          <TransactionLink profileSlug={profileSlug} transactionId={row.transactionId} />
          {row.manuallyLinked && (
            <Button size="sm" variant="ghost" onClick={unlink} disabled={pending}>
              {t("unlink")}
            </Button>
          )}
        </p>
      )}
      {row.status === "skipped" && (
        <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
          <span>{row.skipReasonNote ? t("skippedWithNote", { note: row.skipReasonNote }) : t("skippedStatus")}</span>
          <Button size="sm" variant="ghost" onClick={reopen} disabled={pending}>{t("reopen")}</Button>
        </div>
      )}
      {row.status === "trashed" && (
        <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
          <span>{t("status.trashed")}</span>
          {row.reviewDisposition === "linked_existing" ? (
            <Button size="sm" variant="ghost" onClick={unlink} disabled={pending}>
              {t("unlink")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={reopenForRebooking} disabled={pending}>
              {t("reopenForRebooking")}
            </Button>
          )}
        </div>
      )}
      {row.status === "purged" && (
        <p className="text-caption text-text-muted">{t("status.purged")}</p>
      )}

      <RowEvidence row={row} />
      {displayError && (
        <p className={errorClass}>
          {typeof displayError === "string" ? displayError : translateError(displayError)}
        </p>
      )}
    </article>
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
  const [rowErrors, setRowErrors] = useState<Record<string, AppError>>({});
  const t = useTranslations("imports");
  const translateError = useTranslatedError();
  const [error, setError] = useState<AppError | string | null>(null);
  const [pending, startTransition] = useTransition();
  const pendingCount = rows.filter((row) => row.status === "pending").length;
  const confirmedCount = rows.filter((row) => row.status === "confirmed").length;
  const reviewedCount = rows.length - pendingCount;

  function confirmAll() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await confirmHighConfidenceAction({ profileSlug, entityId, batchId });
      if ("error" in result) setError(result.error);
      else if (result.summary) {
        const parts = [t("confirmedCount", { count: result.summary.confirmed })];
        parts.push(t("ownerTransfersExcludedCount", { count: result.summary.ownerTransfersExcluded }));
        parts.push(t("leftForReviewCount", { count: result.summary.left }));
        setMessage(parts.join(", "));
      } else setMessage(t("done"));
    });
  }

  function bookConfirmed() {
    setError(null);
    setMessage(null);
    setRowErrors({});
    startTransition(async () => {
      const result = await bookConfirmedRowsAction({ profileSlug, entityId, batchId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const failures: Record<string, AppError> = {};
      let booked = 0;
      let duplicates = 0;
      for (const outcome of result.outcomes) {
        if (outcome.status === "error") failures[outcome.rowId] = outcome.error;
        else if (outcome.status === "booked") booked += 1;
        else duplicates += 1;
      }
      setRowErrors(failures);
      const parts = [t("bookedCount", { count: booked })];
      if (duplicates) parts.push(t("duplicateCount", { count: duplicates }));
      if (Object.keys(failures).length) {
        parts.push(t("bookingFailureCount", { count: Object.keys(failures).length }));
      }
      setMessage(parts.join(", "));
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-y border-border-hairline bg-surface py-2">
        <p className="text-caption text-text-muted">
          {t("progress", { done: reviewedCount, total: rows.length })}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={confirmAll}
            disabled={pending || pendingCount === 0}
          >
            {t("confirmAllHighConfidence")}
          </Button>
          <Button size="sm" onClick={bookConfirmed} disabled={pending || confirmedCount === 0}>
            {t("bookTransactions", { count: confirmedCount })}
          </Button>
        </div>
      </div>
      {message && <p className="text-caption text-status-positive-text">{message}</p>}
      {error && <p className={errorClass}>{typeof error === "string" ? error : translateError(error)}</p>}
      <div className="flex flex-col" data-testid="import-inbox-rows">
        {rows.map((row) => (
          <InboxRowItem
            key={row.id}
            row={row}
            categories={categories}
            profileSlug={profileSlug}
            entityId={entityId}
            batchId={batchId}
            externalError={rowErrors[row.id]}
          />
        ))}
      </div>
    </div>
  );
}
