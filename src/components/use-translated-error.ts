"use client";

import { useTranslations } from "next-intl";
import { errorMessageKey, type AppError } from "@/lib/app-error";

export function useTranslatedError() {
  const t = useTranslations("errors");

  return (error: AppError): string => t(errorMessageKey(error.code), error.params ?? {});
}
