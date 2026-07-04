"use client";

import { useState, useTransition } from "react";
import { deleteTransactionAction } from "@/lib/ledger/actions";
import { errorClass, primaryButtonClass } from "./forms/ui";

export function DeleteTransactionButton({
  transactionId,
  entityId,
}: {
  transactionId: string;
  entityId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className={`${primaryButtonClass} hover:border-negative`}
        onClick={() => {
          if (!window.confirm("Soft-delete this transaction?")) return;
          startTransition(async () => {
            const result = await deleteTransactionAction(transactionId, entityId);
            if (result?.error) setError(result.error);
          });
        }}
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && <span className={errorClass}>{error}</span>}
    </span>
  );
}
