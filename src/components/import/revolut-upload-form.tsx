"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { errorClass, fieldClass, labelClass } from "@/components/forms/ui";
import { useTranslatedError } from "@/components/use-translated-error";
import { createRevolutImportBatchAction } from "@/lib/import/revolut/brokerage-actions";
import type { AppError } from "@/lib/app-error";

export function RevolutUploadForm({
  profileSlug,
  entityId,
}: {
  profileSlug: string;
  entityId: string;
}) {
  const t = useTranslations("imports.revolut");
  const translateError = useTranslatedError();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();

  async function choose(file?: File) {
    setError(null);
    if (!file) {
      setText("");
      setFileName("");
      return;
    }
    setText(await file.text());
    setFileName(file.name);
  }

  return (
    <form
      className="flex flex-col gap-[var(--density-field-gap)]"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createRevolutImportBatchAction({
            profileSlug,
            entityId,
            sourceFileName: fileName,
            text,
          });
          if (result && "error" in result && typeof result.error !== "string") {
            setError(result.error);
          }
        });
      }}
    >
      <label className={labelClass}>
        {t("csvLabel")}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className={`${fieldClass} cursor-pointer py-2 file:mr-3 file:cursor-pointer file:border-0 file:bg-transparent file:text-secondary file:text-text-primary`}
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </label>
      <p className="text-caption text-text-muted">
        {fileName ? t("loaded", { fileName }) : t("help")}
      </p>
      {error && <p className={errorClass}>{translateError(error)}</p>}
      <div>
        <Button type="submit" disabled={pending || !text}>
          {pending ? t("parsing") : t("parse")}
        </Button>
      </div>
    </form>
  );
}
