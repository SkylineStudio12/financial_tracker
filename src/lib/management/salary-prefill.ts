import { minorToInput } from "@/lib/format";
import type { SalaryProfileValues } from "./service";

export interface SalaryInputValues {
  gross: string;
  cas: string;
  cass: string;
  incomeTax: string;
  cam: string;
  net: string;
  personalDeduction: string;
  personalAccountId?: string;
}

export type AutomaticSalaryPrefill =
  | { source: "profile"; values: SalaryInputValues }
  | { source: "repeat-last"; values: SalaryInputValues }
  | { source: "blank"; values: null };

/** Profile is the automatic default. Repeat-last is consulted only when the
 * employee has no current profile; callers keep the manual repeat affordance. */
export async function resolveAutomaticSalaryPrefill(
  profile: SalaryProfileValues | null,
  loadRepeatLast: () => Promise<SalaryInputValues | null>,
): Promise<AutomaticSalaryPrefill> {
  if (profile) {
    return {
      source: "profile",
      values: {
        gross: minorToInput(profile.grossMinor),
        cas: minorToInput(profile.casMinor),
        cass: minorToInput(profile.cassMinor),
        incomeTax: minorToInput(profile.incomeTaxMinor),
        cam: minorToInput(profile.camMinor),
        net: minorToInput(profile.netMinor),
        personalDeduction: minorToInput(profile.personalDeductionMinor),
      },
    };
  }
  const repeated = await loadRepeatLast();
  return repeated
    ? { source: "repeat-last", values: repeated }
    : { source: "blank", values: null };
}
