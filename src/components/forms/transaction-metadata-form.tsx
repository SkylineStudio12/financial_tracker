"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  saveTransactionMetadataAction,
  type TransactionMetadataPayload,
} from "@/lib/ledger/actions";
import type { AppError } from "@/lib/app-error";
import { useTranslatedError } from "@/components/use-translated-error";
import { Button } from "@/components/ui/button";
import { errorClass, fieldClass, labelClass } from "./ui";

export function TransactionMetadataForm({
  transactionId,
  expectedRevision,
  expectedUpdatedAt,
  initialDescription,
  initialNotes,
  onSaved,
}: {
  transactionId: string;
  expectedRevision: number;
  expectedUpdatedAt: string;
  initialDescription: string;
  initialNotes: string;
  onSaved: () => void;
}) {
  const t = useTranslations("forms");
  const translateError = useTranslatedError();
  const [description, setDescription] = useState(initialDescription);
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = description !== initialDescription || notes !== initialNotes;

  const submit = () => {
    const payload: TransactionMetadataPayload = {
      transactionId,
      expectedRevision,
      expectedUpdatedAt,
      description,
      notes,
    };
    startTransition(async () => {
      const result = await saveTransactionMetadataAction(payload);
      if ("error" in result) {
        setError(result.error);
      } else {
        onSaved();
      }
    });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className={labelClass}>
        {t("description")}
        <input
          className={fieldClass}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className={labelClass}>
        {t("notesOptional")}
        <textarea
          className={`${fieldClass} min-h-20 py-2`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {error && <p className={errorClass}>{translateError(error)}</p>}
      <div>
        <Button type="submit" disabled={!dirty || pending}>
          {pending ? t("saving") : t("saveMetadata")}
        </Button>
      </div>
    </form>
  );
}
