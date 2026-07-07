"use client";

import { useState, useTransition } from "react";
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
import { formatMinor } from "@/lib/format";
import { errorClass } from "@/components/forms/ui";

interface InboxRow {
  id: string;
  lineNo: string;
  kind: string;
  confidence: string;
  reason: string;
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
  const synthetic = externalRef.startsWith("ING:");
  return (
    <Badge variant={synthetic ? "outline" : "secondary"} title={externalRef}>
      {synthetic ? "synthetic key" : "bank ref"}
    </Badge>
  );
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
  const [error, setError] = useState<string | null>(null);
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
          <span className="text-caption text-text-muted">{row.bookDate}</span>
        </div>
        <span
          className={`font-numeric tabular-nums text-secondary ${
            isCredit ? "text-status-positive-text" : "text-text-primary"
          }`}
        >
          {isCredit ? "+" : "−"}
          {formatMinor(row.amountMinor, "RON")}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{row.kind}</Badge>
        <Badge variant={row.confidence === "high" ? "outline" : "destructive"}>
          {row.confidence}
        </Badge>
        <RefBadge externalRef={row.resolvedExternalRef} />
        {row.overlapSuspect && (
          <Badge variant="destructive" title="Refless row inside a period overlap — confirm individually">
            overlap — confirm
          </Badge>
        )}
        <span className="text-caption text-text-muted">{row.reason}</span>
      </div>

      {row.status === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          {needsCategory && (
            <Select
              items={categories.map((c) => ({ value: c.id, label: `${c.name} · ${c.kind}` }))}
              value={categoryId}
              onValueChange={(v) => setCategoryId((v as string) ?? "")}
            >
              <SelectTrigger className="h-8 w-56 rounded-input border border-border-input bg-surface px-3 text-secondary text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-focus-ring">
                <SelectValue placeholder="Pick a category…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.kind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={book} disabled={!canBook || pending}>
            Book
          </Button>
          <Button size="sm" variant="ghost" onClick={skip} disabled={pending}>
            Skip
          </Button>
          {needsCategory && categoryId === "" && (
            <span className="text-caption text-text-muted">category required</span>
          )}
        </div>
      ) : (
        <span className={`text-caption ${STATUS_TONE[row.status] ?? "text-text-muted"}`}>
          {row.status}
          {row.status === "duplicate" && " — already in the ledger"}
        </span>
      )}
      {error && <p className={errorClass}>{error}</p>}
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  function bookAll() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await bookHighConfidenceAction({ profileSlug, entityId, batchId });
      if ("error" in result) setError(result.error);
      else setMessage(result.message ?? "Done");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-text-muted">
          {pendingCount} pending of {rows.length}. Confirm-all books high-confidence
          rows only — low-confidence, overlap, and category-less rows stay for review.
        </p>
        <Button size="sm" variant="secondary" onClick={bookAll} disabled={pending || pendingCount === 0}>
          Confirm all high-confidence
        </Button>
      </div>
      {message && <p className="text-caption text-status-positive-text">{message}</p>}
      {error && <p className={errorClass}>{error}</p>}
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
