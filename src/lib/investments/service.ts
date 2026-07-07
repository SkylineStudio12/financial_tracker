/**
 * The trade write path (Phase 4 Stage 2) — manual buy/sell/dividend/fee
 * entry. CONSTRUCTS full double-entry transactions and routes them through
 * createTransaction (single write path — same rule the importer lived
 * under); owns the FIFO lot walk and both-currency realized gain.
 *
 * KIND → double-entry (cash = the brokerage CASH account; all trades book
 * as transaction kind "trade"; trades.kind carries the taxonomy):
 * - buy      cash −T · positions +T           (no category — asset swap;
 *            the buy trade row IS the lot)
 * - sell     cash +P · positions −B · equity −(RON gain)
 *            (gain leg category by sign of the SECURITY-currency gain P−B:
 *            profit → Investment gains, loss → Investment losses — owner
 *            amendment: Phase 5 reads gross gains and losses separately)
 * - dividend cash +D · equity −D  (category Dividends; NOTHING is booked
 *            for tax — household has no tax_liability account; the annual
 *            CASS threshold calc is Phase 5; estimateDividendTaxes below is
 *            DISPLAY-ONLY and config-sourced)
 * - fee      cash −F · equity +F  (category Brokerage fees; a trades row is
 *            written only when the fee names a security — the schema's
 *            security_id is NOT NULL, and custody-style fees have none)
 *
 * CURRENCY MODEL: cash/position legs are in the account currency with the
 * RON mirror explicit; the equity leg is on the RON equity account, so its
 * amount IS the RON value (the existing cross-currency posting model — only
 * the RON zero-sum is a ledger invariant). Realized RON gain therefore
 * reflects FX movement between each buy and the sell, never a single-rate
 * conversion.
 *
 * RATE RULE (Stage 1 + checkpoint A, amendment 4): the user enters BOTH the
 * foreign total and the RON total as the broker printed them; the rate is
 * DERIVED (6 dp) and stored on the trade; the entered RON is authoritative
 * for amount_ron. If convertMinorToRon(foreign, derived rate) diverges from
 * the entered RON by more than 1 ban the entry is REJECTED as a mistyped
 * amount — never clamped or absorbed. BNR is never consulted here.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  categories,
  lotConsumptions,
  postings,
  securities,
  trades,
  transactions,
} from "@/db/schema";
import { convertMinorToRon } from "@/lib/fx";
import { getActiveRule, type ActiveRule } from "@/lib/tax/rules";
import {
  createTransaction,
  LedgerValidationError,
  type LedgerTx,
  type PostingInput,
} from "@/lib/ledger";

import { deriveRateToRon, formatQuantity, parseQuantity } from "./trade-rules";

export interface BuySellInput {
  kind: "buy" | "sell";
  /** The brokerage CASH account the money moves through. */
  accountId: string;
  /** Buy only: the paired position account (validated). Sells derive it
   * from the consumed lots' own postings, so it cannot drift. */
  positionAccountId?: string;
  securityId: string;
  date: string;
  /** Decimal string, up to 8 fraction digits, > 0. */
  quantity: string;
  /** Per-share price in minor units — informational (broker rounding means
   * price × quantity may differ from total; total is the money). */
  priceMinor: number;
  /** The money: total in the security's currency, minor units, > 0. */
  totalMinor: number;
  /** The money that actually moved in RON, minor units, > 0 — authoritative
   * for amount_ron. */
  totalRonMinor: number;
  notes?: string;
}

export interface CashEventInput {
  kind: "dividend" | "fee";
  accountId: string;
  /** Required for dividend (it comes from a holding); optional for fee. */
  securityId?: string;
  date: string;
  totalMinor: number;
  totalRonMinor: number;
  notes?: string;
}

export type TradeInput = BuySellInput | CashEventInput;

export interface TradeResult {
  transactionId: string;
  /** Null only for a security-less fee (schema requires a security on trades). */
  tradeId: string | null;
  /** Sell only: realized gain in the security's currency / in RON. */
  realizedGainMinor?: number;
  realizedGainRonMinor?: number;
}

// Pure quantity/rate helpers live in ./trade-rules (client-safe, no DB
// graph); re-exported so server callers keep one import site.
export { deriveRateToRon, formatQuantity, parseQuantity } from "./trade-rules";

function assertPositiveMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new LedgerValidationError(`${label} must be a positive integer in minor units`);
  }
}

/** Rate + hard consistency reject (amendment 4). Returns null for RON. */
function resolveTradeRate(input: {
  currency: "RON" | "EUR" | "USD";
  totalMinor: number;
  totalRonMinor: number;
}): string | null {
  if (input.currency === "RON") {
    if (input.totalMinor !== input.totalRonMinor) {
      throw new LedgerValidationError(
        "A RON-denominated trade must have identical RON and original totals",
      );
    }
    return null;
  }
  const rate = deriveRateToRon(input.totalRonMinor, input.totalMinor);
  const roundTrip = convertMinorToRon(input.totalMinor, rate);
  if (Math.abs(roundTrip - input.totalRonMinor) > 1) {
    throw new LedgerValidationError(
      `The ${input.currency} and RON totals don't reconcile (implied rate ${rate}) — ` +
        "one of the two amounts is mistyped; correct it and re-enter",
    );
  }
  return rate;
}

async function loadAccount(id: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)));
  if (!account) throw new LedgerValidationError(`Account not found: ${id}`);
  if (!account.isActive) throw new LedgerValidationError(`Account is inactive: ${account.name}`);
  return account;
}

async function loadSecurity(id: string, expectedCurrency: string) {
  const [security] = await db
    .select()
    .from(securities)
    .where(and(eq(securities.id, id), isNull(securities.deletedAt)));
  if (!security) throw new LedgerValidationError(`Security not found: ${id}`);
  if (security.currency !== expectedCurrency) {
    throw new LedgerValidationError(
      `${security.ticker} is ${security.currency} but the account is ${expectedCurrency} — ` +
        "trade it from the matching-currency brokerage account",
    );
  }
  return security;
}

async function findCategory(entityId: string, name: string, kind: "income" | "expense") {
  const [category] = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.entityId, entityId),
        eq(categories.name, name),
        eq(categories.kind, kind),
        isNull(categories.deletedAt),
      ),
    );
  if (!category) {
    throw new LedgerValidationError(
      `Category "${name}" (${kind}) is missing for this entity — seed it before booking trades`,
    );
  }
  return category;
}

async function findEquityAccount(entityId: string) {
  const [equity] = await db
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.entityId, entityId), eq(accounts.type, "equity"), isNull(accounts.deletedAt)),
    );
  if (!equity) throw new LedgerValidationError("This entity has no equity account");
  return equity;
}

interface LotState {
  tradeId: string;
  transactionId: string;
  /** The buy's transaction date — FIFO order key and preview display. */
  buyDate: string;
  quantity: bigint;
  totalMinor: bigint;
  totalRonMinor: bigint;
  positionAccountId: string;
  consumedQuantity: bigint;
  allocatedMinor: bigint;
  allocatedRonMinor: bigint;
}

/**
 * Live FIFO lots for (cash account, security): buy trades ordered by
 * (date, created_at, id) — the deterministic tiebreaker pick — each with its
 * live consumed state and its position leg (RON basis source).
 */
async function loadLots(tx: LedgerTx, accountId: string, securityId: string): Promise<LotState[]> {
  // The trade date lives on the TRANSACTION (trades carry no date of their
  // own); (date, created_at, id) is the deterministic FIFO tiebreaker pick.
  const buyRows = (
    await tx
      .select({ trade: trades, date: transactions.date })
      .from(trades)
      .innerJoin(transactions, eq(trades.transactionId, transactions.id))
      .where(
        and(
          eq(trades.accountId, accountId),
          eq(trades.securityId, securityId),
          eq(trades.kind, "buy"),
          isNull(trades.deletedAt),
        ),
      )
      .orderBy(asc(transactions.date), asc(trades.createdAt), asc(trades.id))
  ).map((r) => ({ ...r.trade, buyDate: r.date }));
  if (buyRows.length === 0) return [];

  const consumed = await tx
    .select({
      buyTradeId: lotConsumptions.buyTradeId,
      quantity: sql<string>`coalesce(sum(${lotConsumptions.quantity}), 0)`,
      basis: sql<string>`coalesce(sum(${lotConsumptions.costBasisMinor}), 0)`,
      basisRon: sql<string>`coalesce(sum(${lotConsumptions.costBasisRonMinor}), 0)`,
    })
    .from(lotConsumptions)
    .where(
      and(
        inArray(
          lotConsumptions.buyTradeId,
          buyRows.map((b) => b.id),
        ),
        isNull(lotConsumptions.deletedAt),
      ),
    )
    .groupBy(lotConsumptions.buyTradeId);
  const consumedByLot = new Map(consumed.map((c) => [c.buyTradeId, c]));

  // The buy's position leg: the non-cash, positive posting of its
  // transaction. Its account is the position account; its amount_ron is the
  // lot's stored RON basis — the single stored source (never recomputed
  // from the rate, avoiding double rounding).
  const positionLegs = await tx
    .select()
    .from(postings)
    .where(
      and(
        inArray(
          postings.transactionId,
          buyRows.map((b) => b.transactionId),
        ),
        isNull(postings.deletedAt),
      ),
    );
  const positionByTx = new Map(
    positionLegs
      .filter((p) => p.accountId !== accountId && p.amount > 0)
      .map((p) => [p.transactionId, p]),
  );

  return buyRows.map((buy) => {
    const positionLeg = positionByTx.get(buy.transactionId);
    if (!positionLeg) {
      throw new LedgerValidationError(
        `Buy trade ${buy.id} has no live position leg — its transaction is inconsistent`,
      );
    }
    const c = consumedByLot.get(buy.id);
    return {
      tradeId: buy.id,
      transactionId: buy.transactionId,
      buyDate: buy.buyDate,
      quantity: parseQuantity(buy.quantity),
      totalMinor: BigInt(buy.total),
      totalRonMinor: BigInt(positionLeg.amountRon),
      positionAccountId: positionLeg.accountId,
      consumedQuantity: c ? parseQuantity(c.quantity) : 0n,
      allocatedMinor: c ? BigInt(c.basis) : 0n,
      allocatedRonMinor: c ? BigInt(c.basisRon) : 0n,
    };
  });
}

interface ConsumptionSpec {
  buyTradeId: string;
  quantity: bigint;
  costBasisMinor: bigint;
  costBasisRonMinor: bigint;
}

/**
 * The FIFO walk with CUMULATIVE-FLOOR allocation: each slice is the
 * difference of cumulative floors target(x) = ⌊total × x / quantity⌋, so the
 * sum of a lot's slices equals the cumulative target at every step and the
 * lot's exact total at exhaustion — no bani created or destroyed, the final
 * slice absorbs the remainder by construction. Identical formula for both
 * currencies. Pure; throws on over-consumption BEFORE the caller writes.
 */
export function planFifoConsumption(
  lots: {
    tradeId: string;
    quantity: bigint;
    totalMinor: bigint;
    totalRonMinor: bigint;
    consumedQuantity: bigint;
    allocatedMinor: bigint;
    allocatedRonMinor: bigint;
  }[],
  sellQuantity: bigint,
  context: string,
): ConsumptionSpec[] {
  const totalRemaining = lots.reduce((s, lot) => s + (lot.quantity - lot.consumedQuantity), 0n);
  if (sellQuantity > totalRemaining) {
    throw new LedgerValidationError(
      `Selling ${formatQuantity(sellQuantity)} but only ${formatQuantity(totalRemaining)} ` +
        `held across live lots of ${context}`,
    );
  }
  const specs: ConsumptionSpec[] = [];
  let left = sellQuantity;
  for (const lot of lots) {
    if (left === 0n) break;
    const remaining = lot.quantity - lot.consumedQuantity;
    if (remaining === 0n) continue;
    const take = remaining < left ? remaining : left;
    const cumulative = lot.consumedQuantity + take;
    const target = (lot.totalMinor * cumulative) / lot.quantity;
    const targetRon = (lot.totalRonMinor * cumulative) / lot.quantity;
    specs.push({
      buyTradeId: lot.tradeId,
      quantity: take,
      costBasisMinor: target - lot.allocatedMinor,
      costBasisRonMinor: targetRon - lot.allocatedRonMinor,
    });
    left -= take;
  }
  return specs;
}

export async function executeTrade(input: TradeInput): Promise<TradeResult> {
  assertPositiveMinor(input.totalMinor, "The trade total");
  assertPositiveMinor(input.totalRonMinor, "The RON total");
  const cash = await loadAccount(input.accountId);
  if (cash.type !== "brokerage") {
    throw new LedgerValidationError("Trades book against a brokerage cash account");
  }
  const rate = resolveTradeRate({
    currency: cash.currency,
    totalMinor: input.totalMinor,
    totalRonMinor: input.totalRonMinor,
  });

  switch (input.kind) {
    case "buy":
      return executeBuy(input, cash, rate);
    case "sell":
      return executeSell(input, cash, rate);
    case "dividend":
    case "fee":
      return executeCashEvent(input, cash, rate);
  }
}

type Account = Awaited<ReturnType<typeof loadAccount>>;

async function executeBuy(input: BuySellInput, cash: Account, rate: string | null): Promise<TradeResult> {
  if (!input.positionAccountId) {
    throw new LedgerValidationError("A buy needs the paired position account");
  }
  const position = await loadAccount(input.positionAccountId);
  if (
    position.id === cash.id ||
    position.type !== "position" ||
    position.entityId !== cash.entityId ||
    position.currency !== cash.currency ||
    position.owner !== cash.owner
  ) {
    throw new LedgerValidationError(
      "The paired account must be a `position` account with the same entity, currency, and owner as the cash account",
    );
  }
  const security = await loadSecurity(input.securityId, cash.currency);
  const quantity = parseQuantity(input.quantity);
  assertPositiveMinor(input.priceMinor, "The share price");

  return db.transaction(async (tx) => {
    const transactionId = await createTransaction(
      {
        entityId: cash.entityId,
        date: input.date,
        description: `Buy ${trimQty(quantity)} ${security.ticker}`,
        kind: "trade",
        notes: input.notes ?? null,
        postings: [
          { accountId: cash.id, amount: -input.totalMinor, amountRon: -input.totalRonMinor },
          { accountId: position.id, amount: input.totalMinor, amountRon: input.totalRonMinor },
        ],
      },
      tx,
    );
    const [trade] = await tx
      .insert(trades)
      .values({
        accountId: cash.id,
        securityId: security.id,
        transactionId,
        kind: "buy",
        quantity: formatQuantity(quantity),
        price: input.priceMinor,
        total: input.totalMinor,
        fxRateToRon: rate,
      })
      .returning({ id: trades.id });
    return { transactionId, tradeId: trade.id };
  });
}

async function executeSell(input: BuySellInput, cash: Account, rate: string | null): Promise<TradeResult> {
  const security = await loadSecurity(input.securityId, cash.currency);
  const quantity = parseQuantity(input.quantity);
  assertPositiveMinor(input.priceMinor, "The share price");
  const equity = await findEquityAccount(cash.entityId);

  return db.transaction(async (tx) => {
    // Reads inside the same transaction the writes commit in — the guard
    // and the walk see exactly the state the sell will mutate.
    const lots = await loadLots(tx, cash.id, security.id);
    const specs = planFifoConsumption(
      lots,
      quantity,
      `${security.ticker} in ${cash.name}`,
    );

    const positionAccountIds = new Set(
      specs.map((s) => lots.find((l) => l.tradeId === s.buyTradeId)!.positionAccountId),
    );
    if (positionAccountIds.size !== 1) {
      throw new LedgerValidationError(
        "The consumed lots span more than one position account — repair the data before selling",
      );
    }
    const [positionAccountId] = positionAccountIds;

    const basisMinor = specs.reduce((s, c) => s + c.costBasisMinor, 0n);
    const basisRonMinor = specs.reduce((s, c) => s + c.costBasisRonMinor, 0n);
    const basis = Number(basisMinor);
    const basisRon = Number(basisRonMinor);
    const gain = input.totalMinor - basis;
    const gainRon = input.totalRonMinor - basisRon;

    if ((basis === 0) !== (basisRon === 0)) {
      throw new LedgerValidationError(
        "This sell consumes a dust quantity whose basis rounds to zero in one currency only — " +
          "sell a slightly larger quantity",
      );
    }

    // Gain leg category by the sign of the SECURITY-currency gain
    // (amendment 1); when that is exactly zero, the RON gain decides.
    const gainCategory =
      gain !== 0 || gainRon !== 0
        ? await findCategory(
            cash.entityId,
            (gain !== 0 ? gain > 0 : gainRon > 0) ? "Investment gains" : "Investment losses",
            (gain !== 0 ? gain > 0 : gainRon > 0) ? "income" : "expense",
          )
        : null;

    const legs: PostingInput[] = [
      { accountId: cash.id, amount: input.totalMinor, amountRon: input.totalRonMinor },
    ];
    if (basis !== 0) {
      legs.push({ accountId: positionAccountId, amount: -basis, amountRon: -basisRon });
    }
    if (gainRon !== 0) {
      // The equity account is RON: its amount IS the RON gain value.
      legs.push({ accountId: equity.id, amount: -gainRon, amountRon: -gainRon, categoryId: gainCategory!.id });
    } else if (gain !== 0) {
      throw new LedgerValidationError(
        "This sell has a non-zero foreign-currency gain that rounds to exactly zero RON — " +
          "adjust the quantity so the RON ledger can carry it",
      );
    }

    const transactionId = await createTransaction(
      {
        entityId: cash.entityId,
        date: input.date,
        description: `Sell ${trimQty(quantity)} ${security.ticker}`,
        kind: "trade",
        notes: input.notes ?? null,
        postings: legs,
      },
      tx,
    );
    const [trade] = await tx
      .insert(trades)
      .values({
        accountId: cash.id,
        securityId: security.id,
        transactionId,
        kind: "sell",
        quantity: formatQuantity(quantity),
        price: input.priceMinor,
        total: input.totalMinor,
        fxRateToRon: rate,
      })
      .returning({ id: trades.id });
    await tx.insert(lotConsumptions).values(
      specs.map((s) => ({
        sellTradeId: trade.id,
        buyTradeId: s.buyTradeId,
        quantity: formatQuantity(s.quantity),
        costBasisMinor: Number(s.costBasisMinor),
        costBasisRonMinor: Number(s.costBasisRonMinor),
      })),
    );
    return {
      transactionId,
      tradeId: trade.id,
      realizedGainMinor: gain,
      realizedGainRonMinor: gainRon,
    };
  });
}

async function executeCashEvent(
  input: CashEventInput,
  cash: Account,
  rate: string | null,
): Promise<TradeResult> {
  const isDividend = input.kind === "dividend";
  if (isDividend && !input.securityId) {
    throw new LedgerValidationError("A dividend comes from a holding — pick the security");
  }
  const security = input.securityId ? await loadSecurity(input.securityId, cash.currency) : null;
  const equity = await findEquityAccount(cash.entityId);
  const category = isDividend
    ? await findCategory(cash.entityId, "Dividends", "income")
    : await findCategory(cash.entityId, "Brokerage fees", "expense");

  const sign = isDividend ? 1 : -1;
  const description = isDividend
    ? `${security!.ticker} dividend`
    : security
      ? `Brokerage fee (${security.ticker})`
      : "Brokerage fee";

  return db.transaction(async (tx) => {
    const transactionId = await createTransaction(
      {
        entityId: cash.entityId,
        date: input.date,
        description,
        kind: "trade",
        notes: input.notes ?? null,
        postings: [
          { accountId: cash.id, amount: sign * input.totalMinor, amountRon: sign * input.totalRonMinor },
          // Equity is the RON P&L leg; its amount is the RON value.
          { accountId: equity.id, amount: -sign * input.totalRonMinor, amountRon: -sign * input.totalRonMinor, categoryId: category.id },
        ],
      },
      tx,
    );
    if (!security) return { transactionId, tradeId: null };
    const [trade] = await tx
      .insert(trades)
      .values({
        accountId: cash.id,
        securityId: security.id,
        transactionId,
        kind: input.kind,
        quantity: "0",
        price: 0,
        total: input.totalMinor,
        fxRateToRon: rate,
      })
      .returning({ id: trades.id });
    return { transactionId, tradeId: trade.id };
  });
}

function trimQty(scaled: bigint): string {
  return formatQuantity(scaled).replace(/\.?0+$/, "");
}

export interface SellPreviewLot {
  buyDate: string;
  lotQuantity: string;
  previouslyConsumed: string;
  consuming: string;
  costBasisMinor: number;
  costBasisRonMinor: number;
}

export type SellPreview =
  | {
      ok: true;
      heldQuantity: string;
      lots: SellPreviewLot[];
      basisMinor: number;
      basisRonMinor: number;
      /** Null until both totals are entered. */
      gainMinor: number | null;
      gainRonMinor: number | null;
      gainCategoryName: "Investment gains" | "Investment losses" | null;
    }
  | { ok: false; heldQuantity: string; requestedQuantity: string };

/**
 * READ-ONLY dry run of the sell (Stage-3 preview surface): the SAME loadLots
 * + planFifoConsumption the booking path runs, with the writes replaced by a
 * structured result — there is no parallel preview math to diverge (the
 * parity test pins this). Over-consumption comes back as { ok: false } with
 * the held quantity instead of a thrown error, so the form can say "you hold
 * 12.5, cannot sell 15" before anyone presses Book. Booking re-runs the walk
 * authoritatively inside its own transaction; the preview is advisory.
 */
export async function previewSell(input: {
  accountId: string;
  securityId: string;
  quantity: string;
  totalMinor?: number | null;
  totalRonMinor?: number | null;
}): Promise<SellPreview> {
  const cash = await loadAccount(input.accountId);
  if (cash.type !== "brokerage") {
    throw new LedgerValidationError("Trades book against a brokerage cash account");
  }
  const security = await loadSecurity(input.securityId, cash.currency);
  const quantity = parseQuantity(input.quantity);
  const lots = await db.transaction((tx) => loadLots(tx, cash.id, security.id));
  const held = lots.reduce((s, l) => s + (l.quantity - l.consumedQuantity), 0n);

  let specs: ReturnType<typeof planFifoConsumption>;
  try {
    specs = planFifoConsumption(lots, quantity, `${security.ticker} in ${cash.name}`);
  } catch (error) {
    if (error instanceof LedgerValidationError) {
      return {
        ok: false,
        heldQuantity: formatQuantity(held),
        requestedQuantity: formatQuantity(quantity),
      };
    }
    throw error;
  }

  const byId = new Map(lots.map((l) => [l.tradeId, l]));
  const previewLots = specs.map((s) => {
    const lot = byId.get(s.buyTradeId)!;
    return {
      buyDate: lot.buyDate,
      lotQuantity: formatQuantity(lot.quantity),
      previouslyConsumed: formatQuantity(lot.consumedQuantity),
      consuming: formatQuantity(s.quantity),
      costBasisMinor: Number(s.costBasisMinor),
      costBasisRonMinor: Number(s.costBasisRonMinor),
    };
  });
  const basisMinor = previewLots.reduce((s, l) => s + l.costBasisMinor, 0);
  const basisRonMinor = previewLots.reduce((s, l) => s + l.costBasisRonMinor, 0);
  const gainMinor = input.totalMinor != null ? input.totalMinor - basisMinor : null;
  const gainRonMinor = input.totalRonMinor != null ? input.totalRonMinor - basisRonMinor : null;
  const gainCategoryName =
    gainMinor === null || gainRonMinor === null || (gainMinor === 0 && gainRonMinor === 0)
      ? null
      : (gainMinor !== 0 ? gainMinor > 0 : gainRonMinor > 0)
        ? ("Investment gains" as const)
        : ("Investment losses" as const);

  return {
    ok: true,
    heldQuantity: formatQuantity(held),
    lots: previewLots,
    basisMinor,
    basisRonMinor,
    gainMinor,
    gainRonMinor,
    gainCategoryName,
  };
}

/** Brokerage cash + position accounts of an entity (owner-filtered on
 * personal profiles). Returns the type so callers filter by it — includes
 * BOTH `brokerage` and `position` through the enum transition. */
export async function listBrokerageAccounts(entityId: string, owner?: "greg" | "andra") {
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
        inArray(accounts.type, ["brokerage", "position"]),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
      ),
    )
    .orderBy(asc(accounts.name));
  // The WHERE clause restricts to these two types; narrow what tsc can't.
  const narrowed = rows.map((r) => ({ ...r, type: r.type as "brokerage" | "position" }));
  return owner ? narrowed.filter((r) => r.owner === owner) : narrowed;
}

/** All live securities (the buy picker filters by account currency). */
export async function listSecurities() {
  return db
    .select({
      id: securities.id,
      ticker: securities.ticker,
      name: securities.name,
      currency: securities.currency,
    })
    .from(securities)
    .where(isNull(securities.deletedAt))
    .orderBy(asc(securities.ticker));
}

/** Open holdings of one brokerage cash account (remaining > 0 across live
 * lots) — feeds the sell picker so unheld securities aren't offered. */
export async function listHoldings(accountId: string) {
  const buys = await db
    .select({
      tradeId: trades.id,
      securityId: trades.securityId,
      ticker: securities.ticker,
      name: securities.name,
      quantity: trades.quantity,
    })
    .from(trades)
    .innerJoin(securities, eq(trades.securityId, securities.id))
    .where(
      and(eq(trades.accountId, accountId), eq(trades.kind, "buy"), isNull(trades.deletedAt)),
    );
  if (buys.length === 0) return [];
  const consumed = await db
    .select({
      buyTradeId: lotConsumptions.buyTradeId,
      quantity: sql<string>`coalesce(sum(${lotConsumptions.quantity}), 0)`,
    })
    .from(lotConsumptions)
    .where(
      and(
        inArray(
          lotConsumptions.buyTradeId,
          buys.map((b) => b.tradeId),
        ),
        isNull(lotConsumptions.deletedAt),
      ),
    )
    .groupBy(lotConsumptions.buyTradeId);
  const consumedByLot = new Map(consumed.map((c) => [c.buyTradeId, parseQuantity(c.quantity)]));

  const bySecurity = new Map<string, { ticker: string; name: string; held: bigint }>();
  for (const buy of buys) {
    const entry = bySecurity.get(buy.securityId) ?? { ticker: buy.ticker, name: buy.name, held: 0n };
    entry.held += parseQuantity(buy.quantity) - (consumedByLot.get(buy.tradeId) ?? 0n);
    bySecurity.set(buy.securityId, entry);
  }
  return [...bySecurity.entries()]
    .filter(([, e]) => e.held > 0n)
    .map(([securityId, e]) => ({
      securityId,
      ticker: e.ticker,
      name: e.name,
      heldQuantity: formatQuantity(e.held),
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Inline security creation for the buy form: ticker is normalized and
 * unique; currency is LOCKED to the account's currency by the caller. */
export async function getOrCreateSecurity(input: {
  ticker: string;
  name: string;
  currency: "RON" | "EUR" | "USD";
}) {
  const ticker = input.ticker.trim().toUpperCase();
  const name = input.name.trim();
  if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) {
    throw new LedgerValidationError("Ticker must be 1-12 letters/digits (e.g. VUAA, AAPL)");
  }
  if (!name) throw new LedgerValidationError("Security name is required");
  const [existing] = await db
    .select()
    .from(securities)
    .where(and(eq(securities.ticker, ticker), isNull(securities.deletedAt)));
  if (existing) {
    if (existing.currency !== input.currency) {
      throw new LedgerValidationError(
        `${ticker} already exists in ${existing.currency} — one security, one currency`,
      );
    }
    return { id: existing.id, ticker: existing.ticker, name: existing.name, currency: existing.currency };
  }
  const [created] = await db
    .insert(securities)
    .values({ ticker, name, currency: input.currency })
    .returning();
  return { id: created.id, ticker: created.ticker, name: created.name, currency: created.currency };
}

export interface DividendTaxEstimate {
  /** DISPLAY-ONLY, config-sourced. Nothing is ever booked from this — the
   * real annual CASS threshold calculation is Phase 5. */
  estimate: true;
  dividendTaxRonMinor: number;
  cassRonMinor: number;
  dividendTaxRule: ActiveRule;
  cassRule: ActiveRule;
}

/** Flagged per-dividend ESTIMATE from the seeded (placeholder) tax rules. */
export async function estimateDividendTaxes(
  date: string,
  dividendRonMinor: number,
): Promise<DividendTaxEstimate> {
  const dividendTaxRule = await getActiveRule("dividend_tax", date);
  const cassRule = await getActiveRule("cass_dividend", date);
  const byBps = (bps: number) => Math.round((dividendRonMinor * bps) / 10_000);
  return {
    estimate: true,
    dividendTaxRonMinor: byBps(dividendTaxRule.rateBps),
    cassRonMinor: byBps(cassRule.rateBps),
    dividendTaxRule,
    cassRule,
  };
}
