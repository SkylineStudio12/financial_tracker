import type en from "../../messages/en.json";
import type { Locale } from "./config";

/**
 * next-intl type augmentation: message keys are typed from the English
 * catalog (the source language), so a typo'd or missing key is a tsc error,
 * not a silent runtime fallback.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
