"use client";

/**
 * Manual buy/sell trade entry (Phase 4 Stage 3) over the Stage-2 write path.
 *
 * Honors the service contract:
 * - RATE INVERSION: the user enters BOTH totals as the broker printed them;
 *   the implied rate renders read-only (with a best-effort BNR hint); a pair
 *   that can't reconcile within 1 ban disables Book with a typo message —
 *   the service re-rejects authoritatively.
 * - SELL PREVIEW: the FIFO lots to be consumed, the consumed basis, and the
 *   realized gain in BOTH currencies come from previewSell (the same walk
 *   that books) BEFORE booking; over-consumption shows as "you hold X".
 * - Securities are currency-matched to the account; new ones are created
 *   inline with the currency locked to the account's.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMinor, parseAmountToMinor } from "@/lib/format";
import { impliedRate, displayQuantity } from "@/lib/investments/trade-rules";
import type { SellPreview } from "@/lib/investments/service";
import {
  bnrRateHintAction,
  createSecurityAction,
  estimateDividendAction,
  previewSellAction,
  recordTradeAction,
} from "@/lib/investments/actions";
import {
  errorClass,
  fieldClass,
  ghostButtonClass,
  labelClass,
  toggleOffClass,
  toggleOnClass,
} from "@/components/forms/ui";

interface BrokerageAccount {
  id: string;
  name: string;
  type: "brokerage" | "position";
  currency: "RON" | "EUR" | "USD";
  owner: "greg" | "andra" | null;
}
interface SecurityOption {
  id: string;
  ticker: string;
  name: string;
  currency: "RON" | "EUR" | "USD";
}
interface Holding {
  securityId: string;
  ticker: string;
  name: string;
  heldQuantity: string;
}

const QTY_RE = /^\d+(\.\d{1,8})?$/;

export function TradeForm({
  profileSlug,
  entityId,
  accounts,
  securities: initialSecurities,
  holdingsByAccount,
  today,
}: {
  profileSlug: string;
  entityId: string;
  accounts: BrokerageAccount[];
  securities: SecurityOption[];
  holdingsByAccount: Record<string, Holding[]>;
  today: string;
}) {
  // Typed at last (Stage 4 enum): cash accounts and position accounts are
  // distinguished by account_type, not by name.
  const cashAccounts = useMemo(() => accounts.filter((a) => a.type === "brokerage"), [accounts]);

  const [mode, setMode] = useState<"buy" | "sell" | "dividend">("buy");
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? "");
  const [positionChoice, setPositionChoice] = useState("");
  const [securities, setSecurities] = useState(initialSecurities);
  const [securityId, setSecurityId] = useState("");
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [totalForeign, setTotalForeign] = useState("");
  const [totalRon, setTotalRon] = useState("");
  const [newSecOpen, setNewSecOpen] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [newName, setNewName] = useState("");
  const [newSecError, setNewSecError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<{
    key: string;
    result: SellPreview | { error: string };
  } | null>(null);
  const [bnrState, setBnrState] = useState<{ key: string; rate: string | null } | null>(null);
  const [estimateState, setEstimateState] = useState<{
    key: string;
    value: { dividendTaxRonMinor: number; dividendTaxRateBps: number } | { error: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [previewPending, startPreview] = useTransition();

  const cash = cashAccounts.find((a) => a.id === cashAccountId);
  const positionCandidates = useMemo(
    () =>
      accounts.filter(
        (a) =>
          cash &&
          a.type === "position" &&
          a.currency === cash.currency &&
          a.owner === cash.owner,
      ),
    [accounts, cash],
  );
  // Auto-select the paired position account when exactly one candidate
  // exists (the normal case) — visible, never hidden magic. An explicit
  // user choice wins while it stays a valid candidate; switching accounts
  // invalidates it and falls back automatically (derived, no effect).
  const positionAccountId = positionCandidates.some((c) => c.id === positionChoice)
    ? positionChoice
    : positionCandidates.length === 1
      ? positionCandidates[0].id
      : "";

  const holdings = useMemo(
    () => holdingsByAccount[cashAccountId] ?? [],
    [holdingsByAccount, cashAccountId],
  );
  const buySecurities = useMemo(
    () => securities.filter((s) => cash && s.currency === cash.currency),
    [securities, cash],
  );
  const sellSecurities = useMemo(
    () => holdings.map((h) => ({ id: h.securityId, ticker: h.ticker, name: h.name })),
    [holdings],
  );
  // Dividends offer ALL currency-matched securities (buy-like): a dividend
  // can legitimately arrive after a full exit, so holdings-only would block
  // a real case. The held quantity shows as a hint when there is one.
  const securityItems = (mode === "sell" ? sellSecurities : buySecurities).map((s) => ({
    value: s.id,
    label: `${s.ticker} — ${s.name}`,
  }));
  const heldOfSelected = holdings.find((h) => h.securityId === securityId)?.heldQuantity;

  const totalMinor = parseAmountToMinor(totalForeign);
  const totalRonMinor = parseAmountToMinor(totalRon);
  const priceMinor = parseAmountToMinor(price);
  const quantityValid = QTY_RE.test(quantity.trim());
  const isRonAccount = cash?.currency === "RON";

  const rate =
    !isRonAccount && totalMinor && totalRonMinor && totalMinor > 0 && totalRonMinor > 0
      ? impliedRate(totalRonMinor, totalMinor)
      : null;

  // Best-effort BNR hint for the trade date (display-only, never booked).
  // Keyed derivation: a stale response for a previous date/currency simply
  // stops matching the current key — no synchronous state reset needed.
  const bnrKey =
    cash && cash.currency !== "RON" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `${date}|${cash.currency}`
      : null;
  useEffect(() => {
    if (!bnrKey) return;
    const [hintDate, hintCurrency] = bnrKey.split("|");
    let stale = false;
    bnrRateHintAction({ date: hintDate, currency: hintCurrency as "EUR" | "USD" }).then((r) => {
      if (!stale) setBnrState({ key: bnrKey, rate: r.rate });
    });
    return () => {
      stale = true;
    };
  }, [bnrKey]);
  const bnrHint = bnrState && bnrState.key === bnrKey ? bnrState.rate : null;

  // Debounced sell preview — the same consumption walk that will book.
  // Same keyed derivation: only a response matching the CURRENT inputs is
  // ever shown.
  const previewKey =
    mode === "sell" && cashAccountId && securityId && quantityValid
      ? JSON.stringify([cashAccountId, securityId, quantity.trim(), totalMinor, totalRonMinor])
      : null;
  useEffect(() => {
    if (!previewKey) return;
    const [accountId, keySecurityId, keyQuantity, keyTotal, keyTotalRon] = JSON.parse(
      previewKey,
    ) as [string, string, string, number | null, number | null];
    const timer = setTimeout(() => {
      startPreview(async () => {
        const result = await previewSellAction({
          accountId,
          securityId: keySecurityId,
          quantity: keyQuantity,
          totalMinor: keyTotal,
          totalRonMinor: keyTotalRon,
        });
        setPreviewState({ key: previewKey, result });
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [previewKey]);
  const preview = previewState && previewState.key === previewKey ? previewState.result : null;

  // Display-only dividend tax indication — keyed like the BNR hint; rate AND
  // amount both come from the active tax_rules row via the action (never a
  // literal, so the label percentage self-updates with the config).
  const estimateKey =
    mode === "dividend" &&
    totalRonMinor !== null &&
    totalRonMinor > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `${date}|${totalRonMinor}`
      : null;
  useEffect(() => {
    if (!estimateKey) return;
    const [estDate, estRon] = estimateKey.split("|");
    let stale = false;
    estimateDividendAction({ date: estDate, dividendRonMinor: Number(estRon) }).then((value) => {
      if (!stale) setEstimateState({ key: estimateKey, value });
    });
    return () => {
      stale = true;
    };
  }, [estimateKey]);
  const estimate =
    estimateState && estimateState.key === estimateKey ? estimateState.value : null;

  function switchMode(next: "buy" | "sell" | "dividend") {
    setMode(next);
    setSecurityId("");
    setError(null);
  }

  async function createSecurity() {
    if (!cash) return;
    setNewSecError(null);
    const result = await createSecurityAction({
      ticker: newTicker,
      name: newName,
      currency: cash.currency,
    });
    if ("error" in result) {
      setNewSecError(result.error);
      return;
    }
    setSecurities((prev) =>
      prev.some((s) => s.id === result.id)
        ? prev
        : [...prev, result as SecurityOption].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    );
    setSecurityId(result.id);
    setNewSecOpen(false);
    setNewTicker("");
    setNewName("");
  }

  const amountsOk =
    totalMinor !== null &&
    totalRonMinor !== null &&
    totalMinor > 0 &&
    totalRonMinor > 0 &&
    (isRonAccount ? totalMinor === totalRonMinor : (rate?.reconciles ?? false));
  const canBook =
    !!cash &&
    !!securityId &&
    amountsOk &&
    (mode === "dividend"
      ? true
      : quantityValid &&
        priceMinor !== null &&
        priceMinor > 0 &&
        (mode === "buy"
          ? positionAccountId !== ""
          : preview !== null && "ok" in preview && preview.ok));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await recordTradeAction({
        profileSlug,
        entityId,
        kind: mode,
        accountId: cashAccountId,
        positionAccountId: mode === "buy" ? positionAccountId : undefined,
        securityId,
        date,
        quantity: mode === "dividend" ? undefined : quantity.trim(),
        priceMinor: mode === "dividend" ? undefined : priceMinor!,
        totalMinor: totalMinor!,
        totalRonMinor: totalRonMinor!,
      });
      if (result && "error" in result) setError(result.error);
    });
  }

  if (cashAccounts.length === 0) {
    return (
      <p className="text-secondary text-text-muted">
        This profile has no brokerage account to trade from.
      </p>
    );
  }

  const currency = cash?.currency ?? "USD";

  return (
    <form
      className="flex max-w-2xl flex-col gap-[var(--density-field-gap)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <button
          type="button"
          className={mode === "buy" ? toggleOnClass : toggleOffClass}
          onClick={() => switchMode("buy")}
        >
          Buy
        </button>
        <button
          type="button"
          className={mode === "sell" ? toggleOnClass : toggleOffClass}
          onClick={() => switchMode("sell")}
        >
          Sell
        </button>
        <button
          type="button"
          className={mode === "dividend" ? toggleOnClass : toggleOffClass}
          onClick={() => switchMode("dividend")}
        >
          Dividend
        </button>
      </div>

      <div className="grid grid-cols-1 gap-[var(--density-field-gap)] sm:grid-cols-2">
        <label className={labelClass}>
          Brokerage account
          <Select
            items={cashAccounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
            value={cashAccountId}
            onValueChange={(v) => {
              setCashAccountId(v ?? "");
              setSecurityId("");
            }}
          >
            <SelectTrigger className={fieldClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cashAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {mode === "buy" && (
          <label className={labelClass}>
            Position account
            <Select
              items={positionCandidates.map((a) => ({ value: a.id, label: a.name }))}
              value={positionAccountId}
              onValueChange={(v) => setPositionChoice(v ?? "")}
            >
              <SelectTrigger className={fieldClass}>
                <SelectValue placeholder="Pick the paired positions account…" />
              </SelectTrigger>
              <SelectContent>
                {positionCandidates.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
      </div>

      <label className={labelClass}>
        Security
        <Select
          items={securityItems}
          value={securityId}
          onValueChange={(v) => setSecurityId(v ?? "")}
        >
          <SelectTrigger className={fieldClass}>
            <SelectValue
              placeholder={
                mode === "sell" && securityItems.length === 0
                  ? "Nothing held in this account"
                  : "Pick a security…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {securityItems.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {mode === "buy" &&
        (newSecOpen ? (
          <div className="flex flex-col gap-2 rounded-input border border-border-hairline p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className={labelClass}>
                Ticker
                <input
                  className={fieldClass}
                  value={newTicker}
                  onChange={(e) => setNewTicker(e.target.value)}
                  placeholder="VUAA"
                />
              </label>
              <label className={labelClass}>
                Name
                <input
                  className={fieldClass}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Vanguard S&P 500 UCITS"
                />
              </label>
            </div>
            <p className="text-caption text-text-muted">
              Currency: {currency} — locked to the account, so a mismatched trade is
              impossible by construction.
            </p>
            {newSecError && <p className={errorClass}>{newSecError}</p>}
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={createSecurity}>
                Create security
              </Button>
              <button type="button" className={ghostButtonClass} onClick={() => setNewSecOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`${ghostButtonClass} self-start`}
            onClick={() => setNewSecOpen(true)}
          >
            + New security ({currency})
          </button>
        ))}

      <div className="grid grid-cols-2 gap-[var(--density-field-gap)] sm:grid-cols-4">
        <label className={labelClass}>
          Date
          <input
            type="date"
            className={fieldClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {mode !== "dividend" && (
          <>
            <label className={labelClass}>
              Shares
              <input
                className={`${fieldClass} font-numeric`}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="10"
              />
            </label>
            <label className={labelClass}>
              Price / share ({currency})
              <input
                className={`${fieldClass} font-numeric`}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="102.50"
              />
            </label>
          </>
        )}
        <label className={labelClass}>
          {mode === "dividend" ? `Net dividend (${currency})` : `Total (${currency})`}
          <input
            className={`${fieldClass} font-numeric`}
            value={totalForeign}
            onChange={(e) => setTotalForeign(e.target.value)}
            placeholder={mode === "dividend" ? "12.34" : "1025.00"}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-[var(--density-field-gap)] sm:grid-cols-2">
        <label className={labelClass}>
          {mode === "dividend" ? "Net received" : mode === "buy" ? "Total charged" : "Total received"}{" "}
          (RON) — as the broker printed it
          <input
            className={`${fieldClass} font-numeric`}
            value={totalRon}
            onChange={(e) => setTotalRon(e.target.value)}
            placeholder="4715.00"
          />
        </label>
        {!isRonAccount && (
          <div className={labelClass}>
            Implied broker rate (derived — you never enter a rate)
            <p className="flex h-[var(--density-control-height)] items-center gap-2 font-numeric text-secondary text-text-primary">
              {rate ? (
                <>
                  <span>1 {currency} = {rate.rate} RON</span>
                  {bnrHint && (
                    <span className="text-caption text-text-muted">BNR that day: {bnrHint}</span>
                  )}
                </>
              ) : (
                <span className="text-text-muted">enter both totals</span>
              )}
            </p>
          </div>
        )}
      </div>

      {rate && !rate.reconciles && (
        <p className={errorClass}>
          These amounts don&apos;t reconcile — check for a typo in one of the two totals.
        </p>
      )}

      {mode === "sell" && (
        <SellPreviewPanel
          preview={preview}
          pending={previewPending}
          currency={currency}
          held={heldOfSelected}
        />
      )}

      {mode === "dividend" && (
        <DividendEstimatePanel estimate={estimate} held={heldOfSelected} />
      )}

      {error && <p className={errorClass}>{error}</p>}
      <div>
        <Button type="submit" disabled={!canBook || pending}>
          {pending
            ? "Booking…"
            : mode === "buy"
              ? "Book buy"
              : mode === "sell"
                ? "Book sell"
                : "Book dividend"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Display-only tax indication for a dividend (owner-approved treatment):
 * dashed container (deliberately unlike the sell preview's solid panel —
 * that one shows real about-to-be-booked figures), warning-tone ESTIMATE
 * badge, ≈-prefixed caption-muted number (never the ledger money register),
 * the rate rendered FROM rateBps so it self-updates with tax_rules, and NO
 * per-dividend CASS number at all — CASS is an annual-threshold calculation
 * a single dividend cannot determine; a wrong-shape number would anchor
 * harder than an absence.
 */
function DividendEstimatePanel({
  estimate,
  held,
}: {
  estimate: { dividendTaxRonMinor: number; dividendTaxRateBps: number } | { error: string } | null;
  held: string | undefined;
}) {
  if (!estimate) {
    return (
      <p className="text-caption text-text-muted">
        {held
          ? `You hold ${displayQuantity(held)}. `
          : ""}
        Enter the RON amount to see the rough tax indication.
      </p>
    );
  }
  if ("error" in estimate) return <p className={errorClass}>{estimate.error}</p>;
  return (
    <div className="flex flex-col gap-1.5 rounded-input border border-dashed border-border-hairline p-3">
      <div>
        <Badge variant="outline">
          <span className="text-status-warning-text">ESTIMATE — nothing is booked</span>
        </Badge>
      </div>
      <p className="text-caption text-text-muted">
        Rough indication if this dividend alone were taxed: dividend tax (
        {estimate.dividendTaxRateBps / 100}%): ≈ {formatMinor(estimate.dividendTaxRonMinor, "RON")}.
        The rate is a seeded placeholder pending the accountant.
      </p>
      <p className="text-caption text-text-muted">
        CASS on dividends is calculated ANNUALLY against a threshold — a single dividend
        cannot determine it, so no per-dividend figure is shown; the real calculation
        belongs to the Phase-5 yearly report. Gross amounts and withholding are also a
        Phase-5/accountant question — enter the NET amount that landed. Nothing here is
        written to the ledger.
      </p>
    </div>
  );
}

function SellPreviewPanel({
  preview,
  pending,
  currency,
  held,
}: {
  preview: SellPreview | { error: string } | null;
  pending: boolean;
  currency: string;
  held: string | undefined;
}) {
  if (pending) {
    return <p className="text-caption text-text-muted">Previewing the FIFO consumption…</p>;
  }
  if (!preview) {
    return held ? (
      <p className="text-caption text-text-muted">You hold {displayQuantity(held)}.</p>
    ) : null;
  }
  if ("error" in preview) return <p className={errorClass}>{preview.error}</p>;
  if (!preview.ok) {
    return (
      <p className={errorClass}>
        You hold {displayQuantity(preview.heldQuantity)} — cannot sell{" "}
        {displayQuantity(preview.requestedQuantity)}.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-input border border-border-hairline p-3">
      <p className="text-caption text-text-muted">
        FIFO consumption — what booking will do (same walk, previewed read-only):
      </p>
      <table className="w-full text-secondary">
        <thead>
          <tr className="text-caption text-text-muted">
            <th className="pb-1 text-left font-normal">Lot (bought)</th>
            <th className="pb-1 text-right font-normal">Consuming</th>
            <th className="pb-1 text-right font-normal">Basis ({currency})</th>
            <th className="pb-1 text-right font-normal">Basis (RON)</th>
          </tr>
        </thead>
        <tbody>
          {preview.lots.map((lot, i) => (
            <tr key={i} className="border-t border-border-hairline">
              <td className="py-1 text-text-primary">{lot.buyDate}</td>
              <td className="py-1 text-right font-numeric tabular-nums">
                {displayQuantity(lot.consuming)} of {displayQuantity(lot.lotQuantity)}
              </td>
              <td className="py-1 text-right font-numeric tabular-nums">
                {formatMinor(lot.costBasisMinor, currency)}
              </td>
              <td className="py-1 text-right font-numeric tabular-nums">
                {formatMinor(lot.costBasisRonMinor, "RON")}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border-hairline text-text-primary">
            <td className="py-1">Consumed basis</td>
            <td />
            <td className="py-1 text-right font-numeric tabular-nums">
              {formatMinor(preview.basisMinor, currency)}
            </td>
            <td className="py-1 text-right font-numeric tabular-nums">
              {formatMinor(preview.basisRonMinor, "RON")}
            </td>
          </tr>
        </tbody>
      </table>
      {preview.gainMinor !== null && preview.gainRonMinor !== null ? (
        <p className="text-secondary">
          Realized{" "}
          <span
            className={
              preview.gainRonMinor >= 0 ? "text-status-positive-text" : "text-status-negative-text"
            }
          >
            {preview.gainMinor >= 0 ? "gain" : "loss"} of{" "}
            <span className="font-numeric tabular-nums">
              {formatMinor(Math.abs(preview.gainMinor), currency)}
            </span>{" "}
            /{" "}
            <span className="font-numeric tabular-nums">
              {formatMinor(Math.abs(preview.gainRonMinor), "RON")}
            </span>
          </span>
          {preview.gainCategoryName && (
            <span className="text-text-muted"> → books to {preview.gainCategoryName}</span>
          )}
        </p>
      ) : (
        <p className="text-caption text-text-muted">
          Enter both totals to see the realized gain in {currency} and RON.
        </p>
      )}
    </div>
  );
}
