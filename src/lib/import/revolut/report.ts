import { REVOLUT_TYPES, type RevolutRow, type RevolutType } from "./parse";
import { countRevolutTypes, simulateRevolut } from "./simulate";

export const EXPECTED_REVOLUT_COUNTS: Record<RevolutType, number> = {
  "BUY - MARKET": 72,
  "SELL - MARKET": 1,
  "CASH TOP-UP": 45,
  "CASH WITHDRAWAL": 2,
  "CUSTODY FEE": 2,
  DIVIDEND: 160,
  "DIVIDEND TAX (CORRECTION)": 6,
  "STOCK SPLIT": 3,
};

export function buildRevolutVerification(rows: readonly RevolutRow[]) {
  const actualCounts = countRevolutTypes(rows);
  const simulation = simulateRevolut(rows);
  const pltrSell = simulation.sells.find((sell) => sell.timestamp.startsWith("2025-01-02"));
  return {
    parsedRows: rows.length,
    counts: Object.fromEntries(
      REVOLUT_TYPES.map((type) => [
        type,
        {
          expected: EXPECTED_REVOLUT_COUNTS[type],
          actual: actualCounts[type],
          passed: actualCounts[type] === EXPECTED_REVOLUT_COUNTS[type],
        },
      ]),
    ) as Record<RevolutType, { expected: number; actual: number; passed: boolean }>,
    buyResiduals: simulation.buyResiduals,
    endState: {
      cashMinor: simulation.cashMinor,
      holdings: simulation.holdings,
    },
    splitChecks: simulation.splitChecks,
    pltrConsumption: pltrSell
      ? {
          quantity: pltrSell.quantity,
          lots: pltrSell.consumptions.map((slice) => slice.quantity),
          remainingPosition: pltrSell.remainingPosition,
        }
      : null,
    correctionPairs: simulation.corrections.pairs,
    unpairedCorrections: simulation.corrections.unpaired.map((row) => ({
      lineNo: row.lineNo,
      timestamp: row.timestamp,
      ticker: row.ticker,
      amountMinor: row.totalMinor,
      currency: row.currency,
    })),
    externallyVerified: {
      date: "2026-07-11",
      cash: true,
      holdings: true,
    },
  };
}

export type RevolutVerification = ReturnType<typeof buildRevolutVerification>;
