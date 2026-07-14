import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLog,
  lotConsumptions,
  postings,
  revolutBookedRows,
  revolutImportBatches,
  revolutImportRows,
  securities,
  stockSplitConsumptionAdjustments,
  stockSplitLotAdjustments,
  stockSplits,
  taxAccruals,
  trades,
  transactions,
} from "@/db/schema";
import {
  createTransaction,
  LedgerValidationError,
  softDeleteRevolutBatchTransaction,
  type LedgerTx,
} from "@/lib/ledger";
import {
  executeStockSplit,
  executeTrade,
  loadLots,
} from "@/lib/investments/service";
import { displayQuantity } from "@/lib/investments/trade-rules";
import {
  convertForeignMinorToRon,
  parseQuantityScaled,
  parseRevolutCsv,
  timestampToMicros,
  type RevolutCurrency,
  type RevolutKind,
  type RevolutRow,
  type RevolutType,
} from "./parse";
import { buildRevolutVerification, type RevolutVerification } from "./report";
import { simulateRevolut, type RevolutSimulation } from "./simulate";
import { findExclusionDependencies } from "./dependencies";

export const REVOLUT_ACCOUNT_NAMES = {
  cash: {
    USD: "Revolut brokerage cash USD",
    EUR: "Revolut brokerage cash EUR",
  },
  position: {
    USD: "Greg — Revolut positions USD",
    EUR: "Greg — Revolut positions EUR",
  },
  clearing: "Transfers to Revolut",
} as const;

export interface StoredRevolutRow {
  lineNo: number;
  timestamp: string;
  ticker: string | null;
  type: RevolutType;
  kind: RevolutKind;
  quantityText: string | null;
  priceMinor: number | null;
  totalMinor: number;
  currency: RevolutCurrency;
  fxRate: string;
  contentHash: string;
  semanticKey: string;
}

function storeRow(row: RevolutRow): StoredRevolutRow {
  return {
    lineNo: row.lineNo,
    timestamp: row.timestamp,
    ticker: row.ticker,
    type: row.type,
    kind: row.kind,
    quantityText: row.quantityText,
    priceMinor: row.priceMinor,
    totalMinor: row.totalMinor,
    currency: row.currency,
    fxRate: row.fxRate,
    contentHash: row.contentHash,
    semanticKey: row.semanticKey,
  };
}

export function hydrateStoredRevolutRow(row: StoredRevolutRow): RevolutRow {
  const moneyText = (minor: number) => {
    const value = BigInt(minor);
    const absolute = value < 0n ? -value : value;
    return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
  };
  return {
    ...row,
    timestampMicros: timestampToMicros(row.timestamp),
    quantityScaled: row.quantityText ? parseQuantityScaled(row.quantityText) : null,
    priceText: row.priceMinor === null ? null : `${row.currency} ${moneyText(row.priceMinor)}`,
    totalAmountText: `${row.currency} ${moneyText(row.totalMinor)}`,
  };
}

type ImportAccounts = {
  cash: Record<RevolutCurrency, string>;
  position: Record<RevolutCurrency, string>;
  clearing: string;
};

async function loadImportAccounts(entityId: string, owner: "greg"): Promise<ImportAccounts> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      owner: accounts.owner,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, entityId),
        eq(accounts.owner, owner),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
      ),
    );
  const exact = (name: string, type: (typeof rows)[number]["type"], currency: string) =>
    rows.find((row) => row.name === name && row.type === type && row.currency === currency)?.id;
  const result = {
    cash: {
      USD: exact(REVOLUT_ACCOUNT_NAMES.cash.USD, "brokerage", "USD"),
      EUR: exact(REVOLUT_ACCOUNT_NAMES.cash.EUR, "brokerage", "EUR"),
    },
    position: {
      USD: exact(REVOLUT_ACCOUNT_NAMES.position.USD, "position", "USD"),
      EUR: exact(REVOLUT_ACCOUNT_NAMES.position.EUR, "position", "EUR"),
    },
    clearing: exact(REVOLUT_ACCOUNT_NAMES.clearing, "clearing", "RON"),
  };
  if (
    !result.cash.USD ||
    !result.cash.EUR ||
    !result.position.USD ||
    !result.position.EUR ||
    !result.clearing
  ) {
    throw new LedgerValidationError("revolut.requiredAccountsMissing");
  }
  return result as ImportAccounts;
}

export interface CreateRevolutBatchResult {
  batchId: string;
  parsed: number;
  staged: number;
  correctionPairsDropped: number;
  exactDuplicates: number;
  suspectedDuplicates: number;
  existingBatch: boolean;
}

export async function createRevolutImportBatch(params: {
  entityId: string;
  owner: "greg";
  sourceFileName: string;
  text: string;
}): Promise<CreateRevolutBatchResult> {
  await loadImportAccounts(params.entityId, params.owner);
  const parsed = parseRevolutCsv(params.text);
  const verification = buildRevolutVerification(parsed);
  if (verification.unpairedCorrections.length > 0) {
    throw new LedgerValidationError("revolut.unpairedCorrections", {
      count: verification.unpairedCorrections.length,
    });
  }
  const rawTextHash = createHash("sha256").update(params.text).digest("hex");
  const [existingBatch] = await db
    .select({ id: revolutImportBatches.id })
    .from(revolutImportBatches)
    .where(eq(revolutImportBatches.rawTextHash, rawTextHash));
  if (existingBatch) {
    return {
      batchId: existingBatch.id,
      parsed: parsed.length,
      staged: parsed.length - verification.correctionPairs.length * 2,
      correctionPairsDropped: verification.correctionPairs.length,
      exactDuplicates: 0,
      suspectedDuplicates: 0,
      existingBatch: true,
    };
  }

  const correctionLines = new Set(
    verification.correctionPairs.flatMap((pair) => [pair.firstLineNo, pair.secondLineNo]),
  );
  const stagedRows = parsed.filter((row) => !correctionLines.has(row.lineNo));
  const tickerCurrencies = new Map<string, RevolutCurrency>();
  for (const row of stagedRows) {
    if (!row.ticker) continue;
    const prior = tickerCurrencies.get(row.ticker);
    if (prior && prior !== row.currency) {
      throw new LedgerValidationError("revolut.securityCurrencyConflict", {
        ticker: row.ticker,
      });
    }
    tickerCurrencies.set(row.ticker, row.currency);
  }
  const tickers = [...tickerCurrencies.keys()];
  const existingSecurities = await db
    .select({ id: securities.id, ticker: securities.ticker, currency: securities.currency })
    .from(securities)
    .where(and(inArray(securities.ticker, tickers), isNull(securities.deletedAt)));
  for (const security of existingSecurities) {
    if (security.currency !== tickerCurrencies.get(security.ticker)) {
      throw new LedgerValidationError("revolut.securityCurrencyConflict", {
        ticker: security.ticker,
      });
    }
  }

  const contentHashes = stagedRows.map((row) => row.contentHash);
  const semanticKeys = stagedRows.map((row) => row.semanticKey);
  const priorBooked = await db
    .select({
      contentHash: revolutBookedRows.contentHash,
      semanticKey: revolutBookedRows.semanticKey,
      transactionId: revolutBookedRows.transactionId,
      stockSplitId: revolutBookedRows.stockSplitId,
    })
    .from(revolutBookedRows)
    .where(
      or(
        inArray(revolutBookedRows.contentHash, contentHashes),
        inArray(revolutBookedRows.semanticKey, semanticKeys),
      ),
    );
  const byContent = new Map(priorBooked.map((row) => [row.contentHash, row]));
  const semanticSet = new Set(priorBooked.map((row) => row.semanticKey));
  let exactDuplicates = 0;
  let suspectedDuplicates = 0;

  const batchId = await db.transaction(async (tx) => {
    const existingTickers = new Set(existingSecurities.map((security) => security.ticker));
    const missing = tickers.filter((ticker) => !existingTickers.has(ticker));
    if (missing.length > 0) {
      // Ticker-as-name is an explicit non-enrichment fallback. Existing ALAB
      // keeps its real name because it is reused, never overwritten.
      await tx.insert(securities).values(
        missing.map((ticker) => ({
          ticker,
          name: ticker,
          currency: tickerCurrencies.get(ticker)!,
        })),
      );
    }
    const [batch] = await tx
      .insert(revolutImportBatches)
      .values({
        entityId: params.entityId,
        owner: params.owner,
        sourceFileName: params.sourceFileName,
        rawTextHash,
        parsedRowCount: parsed.length,
        stagedRowCount: stagedRows.length,
        correctionPairCount: verification.correctionPairs.length,
        verification,
      })
      .returning({ id: revolutImportBatches.id });
    await tx.insert(revolutImportRows).values(
      stagedRows.map((row) => {
        const exact = byContent.get(row.contentHash);
        const suspectedDuplicate = !exact && semanticSet.has(row.semanticKey);
        if (exact) exactDuplicates += 1;
        if (suspectedDuplicate) suspectedDuplicates += 1;
        return {
          batchId: batch.id,
          lineNo: row.lineNo,
          occurredAt: row.timestamp,
          type: row.type,
          kind: row.kind,
          ticker: row.ticker,
          currency: row.currency,
          contentHash: row.contentHash,
          semanticKey: row.semanticKey,
          payload: storeRow(row),
          suspectedDuplicate,
          status: exact ? ("duplicate" as const) : ("pending" as const),
          transactionId: exact?.transactionId ?? null,
          stockSplitId: exact?.stockSplitId ?? null,
        };
      }),
    );
    return batch.id;
  });

  return {
    batchId,
    parsed: parsed.length,
    staged: stagedRows.length,
    correctionPairsDropped: verification.correctionPairs.length,
    exactDuplicates,
    suspectedDuplicates,
    existingBatch: false,
  };
}

export async function setRevolutRowExcluded(params: {
  batchId: string;
  rowId: string;
  excluded: boolean;
}): Promise<void> {
  const [batch] = await db
    .select({ bookedAt: revolutImportBatches.bookedAt })
    .from(revolutImportBatches)
    .where(eq(revolutImportBatches.id, params.batchId));
  if (!batch) throw new LedgerValidationError("revolut.batchNotFound");
  if (batch.bookedAt) throw new LedgerValidationError("revolut.batchAlreadyBooked");
  const [row] = await db
    .select({ id: revolutImportRows.id, status: revolutImportRows.status })
    .from(revolutImportRows)
    .where(
      and(eq(revolutImportRows.id, params.rowId), eq(revolutImportRows.batchId, params.batchId)),
    );
  if (!row) throw new LedgerValidationError("revolut.rowNotFound");
  if (row.status === "booked" || row.status === "duplicate") {
    throw new LedgerValidationError("revolut.rowLocked");
  }
  await db
    .update(revolutImportRows)
    .set({ status: params.excluded ? "skipped" : "pending" })
    .where(eq(revolutImportRows.id, row.id));
}

type BookedResult = { transactionId: string | null; stockSplitId: string | null };

function rowNotes(row: StoredRevolutRow): string {
  return `Revolut CSV timestamp: ${row.timestamp}\nContent hash: ${row.contentHash}`;
}

async function bookRow(
  tx: LedgerTx,
  row: StoredRevolutRow,
  accountIds: ImportAccounts,
  securityIds: ReadonlyMap<string, string>,
  splitRatios: ReadonlyMap<number, number>,
  entityId: string,
): Promise<BookedResult> {
  const cashAccountId = accountIds.cash[row.currency];
  const ron = Math.abs(convertForeignMinorToRon(row.totalMinor, row.fxRate));
  const notes = rowNotes(row);
  if (row.kind === "buy" || row.kind === "sell") {
    const result = await executeTrade(
      {
        kind: row.kind,
        accountId: cashAccountId,
        positionAccountId: row.kind === "buy" ? accountIds.position[row.currency] : undefined,
        securityId: securityIds.get(row.ticker!)!,
        date: row.timestamp.slice(0, 10),
        quantity: row.quantityText!,
        priceMinor: row.priceMinor!,
        totalMinor: Math.abs(row.totalMinor),
        totalRonMinor: ron,
        notes,
      },
      tx,
    );
    return { transactionId: result.transactionId, stockSplitId: null };
  }
  if (row.kind === "dividend" || row.kind === "custody_fee") {
    const result = await executeTrade(
      {
        kind: row.kind === "dividend" ? "dividend" : "fee",
        accountId: cashAccountId,
        securityId: row.ticker ? securityIds.get(row.ticker) : undefined,
        date: row.timestamp.slice(0, 10),
        totalMinor: Math.abs(row.totalMinor),
        totalRonMinor: ron,
        notes,
      },
      tx,
    );
    return { transactionId: result.transactionId, stockSplitId: null };
  }
  if (row.kind === "cash_top_up" || row.kind === "cash_withdrawal") {
    const incoming = row.kind === "cash_top_up";
    const transactionId = await createTransaction(
      {
        entityId,
        date: row.timestamp.slice(0, 10),
        description: incoming ? `Revolut ${row.currency} top-up` : `Revolut ${row.currency} withdrawal`,
        kind: "transfer",
        notes,
        postings: [
          {
            accountId: cashAccountId,
            amount: incoming ? Math.abs(row.totalMinor) : -Math.abs(row.totalMinor),
            amountRon: incoming ? ron : -ron,
          },
          {
            accountId: accountIds.clearing,
            amount: incoming ? -ron : ron,
            amountRon: incoming ? -ron : ron,
          },
        ],
      },
      tx,
    );
    return { transactionId, stockSplitId: null };
  }
  if (row.kind === "stock_split") {
    const ratio = splitRatios.get(row.lineNo);
    if (!ratio) throw new LedgerValidationError("revolut.splitRatioMissing", { lineNo: row.lineNo });
    const result = await executeStockSplit(
      {
        accountId: cashAccountId,
        securityId: securityIds.get(row.ticker!)!,
        occurredAt: row.timestamp,
        ratio,
        deltaQuantity: row.quantityText!,
      },
      tx,
    );
    return { transactionId: null, stockSplitId: result.splitId };
  }
  throw new LedgerValidationError("revolut.unsupportedBookingKind", { kind: row.kind });
}

async function assertBookedState(
  tx: LedgerTx,
  expected: RevolutSimulation,
  accountIds: ImportAccounts,
  securityIds: ReadonlyMap<string, string>,
  transactionIds: string[],
): Promise<void> {
  for (const currency of ["USD", "EUR"] as const) {
    const [balance] = await tx
      .select({ amount: sql<number>`coalesce(sum(${postings.amount}), 0)`.mapWith(Number) })
      .from(postings)
      .where(and(eq(postings.accountId, accountIds.cash[currency]), isNull(postings.deletedAt)));
    if (balance.amount !== expected.cashMinor[currency]) {
      throw new LedgerValidationError("revolut.cashAssertionFailed", {
        currency,
        expected: expected.cashMinor[currency],
        actual: balance.amount,
      });
    }
  }

  const actualHoldings: Record<string, string> = {};
  const heldSecurities = await tx
    .selectDistinct({ securityId: trades.securityId, accountId: trades.accountId })
    .from(trades)
    .where(
      and(
        inArray(trades.accountId, [accountIds.cash.USD, accountIds.cash.EUR]),
        eq(trades.kind, "buy"),
        isNull(trades.deletedAt),
      ),
    );
  const tickerById = new Map([...securityIds.entries()].map(([ticker, id]) => [id, ticker]));
  for (const held of heldSecurities) {
    const lots = await loadLots(tx, held.accountId, held.securityId);
    const quantity = lots.reduce((sum, lot) => sum + lot.quantity - lot.consumedQuantity, 0n);
    if (quantity > 0n) actualHoldings[tickerById.get(held.securityId)!] = displayQuantity(quantity);
  }
  const sortedActual = Object.fromEntries(Object.entries(actualHoldings).sort(([a], [b]) => a.localeCompare(b)));
  if (JSON.stringify(sortedActual) !== JSON.stringify(expected.holdings)) {
    throw new LedgerValidationError("revolut.holdingsAssertionFailed");
  }

  if (transactionIds.length > 0) {
    const sums = await tx
      .select({
        transactionId: postings.transactionId,
        amountRon: sql<number>`sum(${postings.amountRon})`.mapWith(Number),
      })
      .from(postings)
      .where(inArray(postings.transactionId, transactionIds))
      .groupBy(postings.transactionId);
    if (sums.length !== transactionIds.length || sums.some((row) => row.amountRon !== 0)) {
      throw new LedgerValidationError("revolut.zeroSumAssertionFailed");
    }
    const [taxCount] = await tx
      .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
      .from(taxAccruals)
      .where(inArray(taxAccruals.transactionId, transactionIds));
    if (taxCount.count !== 0) throw new LedgerValidationError("revolut.taxAccrualAssertionFailed");
  }
}

export interface ApproveRevolutBatchResult {
  booked: number;
  duplicates: number;
  excluded: number;
  transactions: number;
  splits: number;
}

export async function approveRevolutBatch(
  batchId: string,
  outerTx?: LedgerTx,
): Promise<ApproveRevolutBatchResult> {
  const [batch] = await db
    .select()
    .from(revolutImportBatches)
    .where(eq(revolutImportBatches.id, batchId));
  if (!batch) throw new LedgerValidationError("revolut.batchNotFound");
  const storedRows = await db
    .select()
    .from(revolutImportRows)
    .where(eq(revolutImportRows.batchId, batchId));
  const allRows = storedRows.map((row) => hydrateStoredRevolutRow(row.payload as StoredRevolutRow));
  const excludedLines = new Set(
    storedRows.filter((row) => row.status === "skipped").map((row) => row.lineNo),
  );
  const dependencies = findExclusionDependencies(allRows, excludedLines);
  if (dependencies.length > 0) {
    const first = dependencies[0];
    throw new LedgerValidationError(
      first.kind === "sell" ? "revolut.excludedBuyNeededBySell" : "revolut.excludedBuyNeededBySplit",
      { actionLine: first.actionLineNo, buyLine: first.excludedBuyLineNo },
    );
  }
  const approvedRows = allRows.filter((row) => !excludedLines.has(row.lineNo));
  const expected = simulateRevolut(approvedRows);
  const failedSplit = expected.splitChecks.find((split) => !split.passed);
  if (failedSplit) {
    throw new LedgerValidationError("revolut.splitDependencyInvalid", {
      lineNo: failedSplit.lineNo,
    });
  }
  const splitRatios = new Map(expected.splitChecks.map((split) => [split.lineNo, split.ratio!]));
  const accountIds = await loadImportAccounts(batch.entityId, "greg");
  const tickers = [...new Set(approvedRows.flatMap((row) => (row.ticker ? [row.ticker] : [])))];
  const securityRows = await db
    .select({ id: securities.id, ticker: securities.ticker })
    .from(securities)
    .where(and(inArray(securities.ticker, tickers), isNull(securities.deletedAt)));
  const securityIds = new Map(securityRows.map((security) => [security.ticker, security.id]));
  if (securityIds.size !== tickers.length) throw new LedgerValidationError("revolut.securityMissing");

  const write = async (tx: LedgerTx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(734920260711)`);
    const [lockedBatch] = await tx
      .select({ bookedAt: revolutImportBatches.bookedAt })
      .from(revolutImportBatches)
      .where(eq(revolutImportBatches.id, batchId))
      .for("update");
    if (!lockedBatch) throw new LedgerValidationError("revolut.batchNotFound");
    if (lockedBatch.bookedAt) {
      return {
        booked: 0,
        duplicates: storedRows.filter((row) => row.status === "duplicate").length,
        excluded: excludedLines.size,
        transactions: 0,
        splits: 0,
      };
    }

    const hashes = approvedRows.map((row) => row.contentHash);
    const markers = await tx
      .select()
      .from(revolutBookedRows)
      .where(inArray(revolutBookedRows.contentHash, hashes));
    const markerByHash = new Map(markers.map((marker) => [marker.contentHash, marker]));
    const storedByLine = new Map(storedRows.map((row) => [row.lineNo, row]));
    const transactionIds: string[] = [];
    let booked = 0;
    let duplicates = 0;
    let splits = 0;
    const ordered = [...approvedRows].sort((a, b) =>
      a.timestampMicros < b.timestampMicros ? -1 : a.timestampMicros > b.timestampMicros ? 1 : 0,
    );
    await tx
      .update(revolutImportBatches)
      .set({ approvedAt: new Date() })
      .where(eq(revolutImportBatches.id, batchId));

    for (const row of ordered) {
      const stored = storedByLine.get(row.lineNo)!;
      const marker = markerByHash.get(row.contentHash);
      if (marker) {
        duplicates += 1;
        await tx
          .update(revolutImportRows)
          .set({
            status: "duplicate",
            transactionId: marker.transactionId,
            stockSplitId: marker.stockSplitId,
          })
          .where(eq(revolutImportRows.id, stored.id));
        continue;
      }
      let result: BookedResult;
      try {
        result = await bookRow(
          tx,
          stored.payload as StoredRevolutRow,
          accountIds,
          securityIds,
          splitRatios,
          batch.entityId,
        );
      } catch (error) {
        const code = error instanceof LedgerValidationError ? error.code : "unknown";
        throw new LedgerValidationError("revolut.bookingRowFailed", {
          lineNo: row.lineNo,
          causeCode: code,
        });
      }
      if (result.transactionId) transactionIds.push(result.transactionId);
      if (result.stockSplitId) splits += 1;
      await tx.insert(revolutBookedRows).values({
        contentHash: row.contentHash,
        semanticKey: row.semanticKey,
        sourceRowId: stored.id,
        transactionId: result.transactionId,
        stockSplitId: result.stockSplitId,
      });
      await tx
        .update(revolutImportRows)
        .set({
          status: "booked",
          transactionId: result.transactionId,
          stockSplitId: result.stockSplitId,
          bookedAt: new Date(),
        })
        .where(eq(revolutImportRows.id, stored.id));
      booked += 1;
    }

    await assertBookedState(tx, expected, accountIds, securityIds, transactionIds);
    await tx
      .update(revolutImportBatches)
      .set({ bookedAt: new Date() })
      .where(eq(revolutImportBatches.id, batchId));
    return {
      booked,
      duplicates,
      excluded: excludedLines.size,
      transactions: transactionIds.length,
      splits,
    };
  };
  return outerTx ? write(outerTx) : db.transaction(write);
}

export interface DeleteBookedRevolutBatchResult {
  transactions: number;
  splits: number;
  markers: number;
}

/**
 * Reverse one booked brokerage batch as a single atomic operation. Ownership
 * comes from markers created by this batch, never from import-row result links:
 * duplicate rows can point at another batch's booking and must remain untouched.
 */
export async function deleteBookedRevolutBatch(params: {
  batchId: string;
  entityId: string;
  owner: "greg";
}): Promise<DeleteBookedRevolutBatchResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(734920260711)`);
    const [batch] = await tx
      .select()
      .from(revolutImportBatches)
      .where(
        and(
          eq(revolutImportBatches.id, params.batchId),
          eq(revolutImportBatches.entityId, params.entityId),
          eq(revolutImportBatches.owner, params.owner),
        ),
      )
      .for("update");
    if (!batch) throw new LedgerValidationError("revolut.batchNotFound");
    if (!batch.bookedAt) throw new LedgerValidationError("revolut.batchNotBooked");

    const markerRows = await tx
      .select({
        markerId: revolutBookedRows.id,
        transactionId: revolutBookedRows.transactionId,
        stockSplitId: revolutBookedRows.stockSplitId,
        lineNo: revolutImportRows.lineNo,
        payload: revolutImportRows.payload,
      })
      .from(revolutBookedRows)
      .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
      .where(eq(revolutImportRows.batchId, params.batchId));
    const [bookedRowCount] = await tx
      .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
      .from(revolutImportRows)
      .where(
        and(
          eq(revolutImportRows.batchId, params.batchId),
          eq(revolutImportRows.status, "booked"),
        ),
      );
    if (
      markerRows.length !== bookedRowCount.count ||
      markerRows.some(
        (marker) => (marker.transactionId === null) === (marker.stockSplitId === null),
      )
    ) {
      throw new LedgerValidationError("revolut.batchReversalTopologyChanged");
    }

    const transactionIds = [
      ...new Set(markerRows.flatMap((marker) => (marker.transactionId ? [marker.transactionId] : []))),
    ];
    const splitIds = [
      ...new Set(markerRows.flatMap((marker) => (marker.stockSplitId ? [marker.stockSplitId] : []))),
    ];
    const liveTransactions = transactionIds.length
      ? await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(inArray(transactions.id, transactionIds), isNull(transactions.deletedAt)))
      : [];
    const existingSplits = splitIds.length
      ? await tx.select({ id: stockSplits.id }).from(stockSplits).where(inArray(stockSplits.id, splitIds))
      : [];
    if (liveTransactions.length !== transactionIds.length || existingSplits.length !== splitIds.length) {
      throw new LedgerValidationError("revolut.batchReversalTopologyChanged");
    }

    const batchTrades = transactionIds.length
      ? await tx
          .select()
          .from(trades)
          .where(and(inArray(trades.transactionId, transactionIds), isNull(trades.deletedAt)))
      : [];
    const batchBuyIds = batchTrades.filter((trade) => trade.kind === "buy").map((trade) => trade.id);
    const liveConsumptions = batchBuyIds.length
      ? await tx
          .select({
            id: lotConsumptions.id,
            sellTradeId: lotConsumptions.sellTradeId,
          })
          .from(lotConsumptions)
          .where(
            and(
              inArray(lotConsumptions.buyTradeId, batchBuyIds),
              isNull(lotConsumptions.deletedAt),
            ),
          )
      : [];
    const consumingSellIds = [...new Set(liveConsumptions.map((row) => row.sellTradeId))];
    const consumingSells = consumingSellIds.length
      ? await tx
          .select({ id: trades.id, transactionId: trades.transactionId, deletedAt: trades.deletedAt })
          .from(trades)
          .where(inArray(trades.id, consumingSellIds))
      : [];
    if (consumingSells.length !== consumingSellIds.length) {
      throw new LedgerValidationError("revolut.batchReversalTopologyChanged");
    }
    const batchTransactionSet = new Set(transactionIds);
    const outsideSellTransactionIds = consumingSells
      .filter(
        (sell) => sell.deletedAt !== null || !batchTransactionSet.has(sell.transactionId),
      )
      .map((sell) => sell.transactionId);
    if (outsideSellTransactionIds.length > 0) {
      throw new LedgerValidationError("revolut.batchOutsideConsumption", {
        transactionIds: outsideSellTransactionIds.join(", "),
      });
    }

    const lotAdjustments = splitIds.length
      ? await tx
          .select()
          .from(stockSplitLotAdjustments)
          .where(inArray(stockSplitLotAdjustments.splitId, splitIds))
      : [];
    const consumptionAdjustments = splitIds.length
      ? await tx
          .select()
          .from(stockSplitConsumptionAdjustments)
          .where(inArray(stockSplitConsumptionAdjustments.splitId, splitIds))
      : [];
    const adjustedSplitIds = new Set(lotAdjustments.map((adjustment) => adjustment.splitId));
    if (splitIds.some((splitId) => !adjustedSplitIds.has(splitId))) {
      throw new LedgerValidationError("revolut.batchReversalTopologyChanged");
    }
    const adjustedConsumptionIds = [
      ...new Set(consumptionAdjustments.map((adjustment) => adjustment.consumptionId)),
    ];
    const adjustedConsumptions = adjustedConsumptionIds.length
      ? await tx
          .select({
            id: lotConsumptions.id,
            buyTradeId: lotConsumptions.buyTradeId,
            sellTradeId: lotConsumptions.sellTradeId,
          })
          .from(lotConsumptions)
          .where(inArray(lotConsumptions.id, adjustedConsumptionIds))
      : [];
    if (adjustedConsumptions.length !== adjustedConsumptionIds.length) {
      throw new LedgerValidationError("revolut.batchReversalTopologyChanged");
    }
    const adjustedTradeIds = [
      ...new Set([
        ...lotAdjustments.map((adjustment) => adjustment.buyTradeId),
        ...adjustedConsumptions.flatMap((consumption) => [
          consumption.buyTradeId,
          consumption.sellTradeId,
        ]),
      ]),
    ];
    const adjustedTrades = adjustedTradeIds.length
      ? await tx
          .select({ id: trades.id, transactionId: trades.transactionId })
          .from(trades)
          .where(inArray(trades.id, adjustedTradeIds))
      : [];
    if (adjustedTrades.length !== adjustedTradeIds.length) {
      throw new LedgerValidationError("revolut.batchReversalTopologyChanged");
    }
    const outsideAdjustedTransactionIds = adjustedTrades
      .filter((trade) => !batchTransactionSet.has(trade.transactionId))
      .map((trade) => trade.transactionId);
    if (outsideAdjustedTransactionIds.length > 0) {
      throw new LedgerValidationError("revolut.batchOutsideSplitDependency", {
        transactionIds: outsideAdjustedTransactionIds.join(", "),
      });
    }

    const ordered = [...markerRows].sort((a, b) => {
      const aMicros = timestampToMicros((a.payload as StoredRevolutRow).timestamp);
      const bMicros = timestampToMicros((b.payload as StoredRevolutRow).timestamp);
      return aMicros > bMicros ? -1 : aMicros < bMicros ? 1 : b.lineNo - a.lineNo;
    });
    for (const marker of ordered) {
      if (marker.transactionId) {
        await softDeleteRevolutBatchTransaction(marker.transactionId, params.batchId, tx);
        continue;
      }
      const splitId = marker.stockSplitId!;
      for (const adjustment of lotAdjustments.filter((row) => row.splitId === splitId)) {
        await tx
          .update(trades)
          .set({ quantity: adjustment.quantityBefore })
          .where(eq(trades.id, adjustment.buyTradeId));
      }
      for (const adjustment of consumptionAdjustments.filter((row) => row.splitId === splitId)) {
        await tx
          .update(lotConsumptions)
          .set({ quantity: adjustment.quantityBefore })
          .where(eq(lotConsumptions.id, adjustment.consumptionId));
      }
      await tx
        .delete(stockSplitConsumptionAdjustments)
        .where(eq(stockSplitConsumptionAdjustments.splitId, splitId));
      await tx
        .delete(stockSplitLotAdjustments)
        .where(eq(stockSplitLotAdjustments.splitId, splitId));
    }

    await tx.insert(auditLog).values({
      tableName: "revolut_import_batches",
      rowId: batch.id,
      action: "delete",
      previousValues: {
        batchId: batch.id,
        rawTextHash: batch.rawTextHash,
        sourceFileName: batch.sourceFileName,
        bookedAt: batch.bookedAt,
        transactions: transactionIds.length,
        splits: splitIds.length,
        markers: markerRows.length,
      },
    });
    if (markerRows.length > 0) {
      await tx
        .delete(revolutBookedRows)
        .where(inArray(revolutBookedRows.id, markerRows.map((marker) => marker.markerId)));
    }
    await tx.delete(revolutImportBatches).where(eq(revolutImportBatches.id, params.batchId));
    if (splitIds.length > 0) {
      await tx.delete(stockSplits).where(inArray(stockSplits.id, splitIds));
    }
    return {
      transactions: transactionIds.length,
      splits: splitIds.length,
      markers: markerRows.length,
    };
  });
}

export type StoredRevolutVerification = RevolutVerification;
