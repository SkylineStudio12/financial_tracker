import type { RevolutRow } from "./parse";
import { simulateRevolut } from "./simulate";

export type ExclusionDependency =
  | { kind: "sell"; actionLineNo: number; excludedBuyLineNo: number }
  | { kind: "split"; actionLineNo: number; excludedBuyLineNo: number };

/** Named dependency edges from the full approved history. The caller also
 * simulates surviving rows afterward, catching any broader ratio break. */
export function findExclusionDependencies(
  rows: readonly RevolutRow[],
  excludedLineNos: ReadonlySet<number>,
): ExclusionDependency[] {
  const full = simulateRevolut(rows);
  const dependencies: ExclusionDependency[] = [];
  for (const sell of full.sells) {
    if (excludedLineNos.has(sell.lineNo)) continue;
    for (const slice of sell.consumptions) {
      if (excludedLineNos.has(slice.buyLineNo)) {
        dependencies.push({
          kind: "sell",
          actionLineNo: sell.lineNo,
          excludedBuyLineNo: slice.buyLineNo,
        });
      }
    }
  }
  for (const split of full.splitChecks) {
    if (excludedLineNos.has(split.lineNo)) continue;
    for (const buyLineNo of split.dependentBuyLineNos) {
      if (excludedLineNos.has(buyLineNo)) {
        dependencies.push({
          kind: "split",
          actionLineNo: split.lineNo,
          excludedBuyLineNo: buyLineNo,
        });
      }
    }
  }
  return dependencies;
}
