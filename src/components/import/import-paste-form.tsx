"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createImportBatchAction } from "@/lib/import/actions";
import { errorClass, fieldClass, ghostButtonClass, labelClass } from "@/components/forms/ui";

type InputMode = "csv" | "paste";

export function ImportPasteForm({
  profileSlug,
  entityId,
  bankAccounts,
}: {
  profileSlug: string;
  entityId: string;
  bankAccounts: { id: string; name: string; currency: string }[];
}) {
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  // CSV upload is the DEFAULT input (Stage 4 amendment); pasted statement
  // text stays as the fallback. Both feed the same server action — format
  // routing happens in the import service.
  const [mode, setMode] = useState<InputMode>("csv");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function switchMode(next: InputMode) {
    setMode(next);
    setText("");
    setFileName(null);
    setError(null);
  }

  async function onFileChange(file: File | undefined) {
    setError(null);
    if (!file) {
      setText("");
      setFileName(null);
      return;
    }
    setText(await file.text());
    setFileName(file.name);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createImportBatchAction({
        profileSlug,
        entityId,
        bankAccountId,
        text,
      });
      // Success redirects server-side; only an error result returns here.
      if (result && "error" in result) setError(result.error);
    });
  }

  if (bankAccounts.length === 0) {
    return (
      <p className="text-secondary text-text-muted">
        This entity has no active bank account to import a statement into.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-[var(--density-field-gap)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className={labelClass}>
        Statement account
        <Select
          items={bankAccounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
          value={bankAccountId}
          onValueChange={(v) => setBankAccountId((v as string) ?? "")}
        >
          <SelectTrigger className={fieldClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bankAccounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {mode === "csv" ? (
        <>
          <label className={labelClass}>
            Statement CSV export
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className={`${fieldClass} cursor-pointer py-2 file:mr-3 file:cursor-pointer file:border-0 file:bg-transparent file:text-secondary file:text-text-primary`}
              onChange={(e) => onFileChange(e.target.files?.[0])}
            />
          </label>
          <p className="text-caption text-text-muted">
            Upload the ING account-history CSV export (Home’Bank → account history →
            CSV). {fileName ? `Loaded: ${fileName}.` : ""} Rows land in the review
            inbox — nothing is booked until you confirm each one.
          </p>
          <button type="button" className={ghostButtonClass} onClick={() => switchMode("paste")}>
            Paste statement text instead
          </button>
        </>
      ) : (
        <>
          <label className={labelClass}>
            Statement text
            <textarea
              className={`${fieldClass} h-64 resize-y py-2 font-numeric`}
              placeholder="Paste the extracted text of one ING statement…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="text-caption text-text-muted">
            Fallback for when no CSV export is available: paste the extracted text of
            a single ING RON statement. Rows land in the review inbox — nothing is
            booked until you confirm each one.
          </p>
          <button type="button" className={ghostButtonClass} onClick={() => switchMode("csv")}>
            Upload a CSV instead (recommended)
          </button>
        </>
      )}

      {error && <p className={errorClass}>{error}</p>}
      <div>
        <Button type="submit" disabled={pending || !text.trim()}>
          {pending ? "Parsing…" : "Parse into inbox"}
        </Button>
      </div>
    </form>
  );
}
