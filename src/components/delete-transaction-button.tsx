"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { deleteTransactionAction } from "@/lib/ledger/actions";
import { errorClass } from "./forms/ui";

export function DeleteTransactionButton({
  transactionId,
  entityId,
  profileSlug,
}: {
  transactionId: string;
  entityId: string;
  /** Active profile view, so the post-delete redirect lands back on it. */
  profileSlug?: string;
}) {
  const t = useTranslations("transactions");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="rounded-input border border-border-input bg-surface px-3 h-[var(--density-control-height)] text-secondary text-status-negative-text outline-none hover:border-status-negative-text focus-visible:ring-3 focus-visible:ring-focus-ring disabled:opacity-50"
        onClick={() => {
          if (!window.confirm(t("confirmDelete"))) return;
          startTransition(async () => {
            const result = await deleteTransactionAction(transactionId, entityId, profileSlug);
            if (result && "error" in result) setError(result.error);
          });
        }}
      >
        {pending ? t("deleting") : t("delete")}
      </button>
      {error && <span className={errorClass}>{error}</span>}
    </span>
  );
}
