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
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBpsPercent, formatMinor, parseAmountToMinor } from "@/lib/format";
import { impliedRate, displayQuantity } from "@/lib/investments/trade-rules";
import type { SellPreview } from "@/lib/investments/service";
import { useTranslatedError } from "@/components/use-translated-error";
import type { AppError } from "@/lib/app-error";
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
  moneyFieldClass,
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
  const t = useTranslations("investments");
  const tForms = useTranslations("forms");
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
  const [newSecError, setNewSecError] = useState<AppError | null>(null);
  const [previewState, setPreviewState] = useState<{
    key: string;
    result: SellPreview | { error: AppError };
  } | null>(null);
  const [bnrState, setBnrState] = useState<{ key: string; rate: string | null } | null>(null);
  const [estimateState, setEstimateState] = useState<{
    key: string;
    value: { dividendTaxRonMinor: number; dividendTaxRateBps: number } | { error: AppError };
  } | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [pending, startTransition] = useTransition();
  const [previewPending, startPreview] = useTransition();
  const translateError = useTranslatedError();

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
        {t("noBrokerage")}
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
          {t("modeBuy")}
        </button>
        <button
          type="button"
          className={mode === "sell" ? toggleOnClass : toggleOffClass}
          onClick={() => switchMode("sell")}
        >
          {t("modeSell")}
        </button>
        <button
          type="button"
          className={mode === "dividend" ? toggleOnClass : toggleOffClass}
          onClick={() => switchMode("dividend")}
        >
          {t("modeDividend")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-[var(--density-field-gap)] sm:grid-cols-2">
        <label className={labelClass}>
          {t("brokerageAccount")}
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
            {t("positionAccount")}
            <Select
              items={positionCandidates.map((a) => ({ value: a.id, label: a.name }))}
              value={positionAccountId}
              onValueChange={(v) => setPositionChoice(v ?? "")}
            >
              <SelectTrigger className={fieldClass}>
                <SelectValue placeholder={t("positionPlaceholder")} />
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
        {t("security")}
        <Select
          items={securityItems}
          value={securityId}
          onValueChange={(v) => setSecurityId(v ?? "")}
        >
          <SelectTrigger className={fieldClass}>
            <SelectValue
              placeholder={
                mode === "sell" && securityItems.length === 0
                  ? t("nothingHeld")
                  : t("pickSecurity")
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
                {t("ticker")}
                <input
                  className={fieldClass}
                  value={newTicker}
                  onChange={(e) => setNewTicker(e.target.value)}
                  placeholder={t("tickerPlaceholder")}
                />
              </label>
              <label className={labelClass}>
                {t("securityName")}
                <input
                  className={fieldClass}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                />
              </label>
            </div>
            <p className="text-caption text-text-muted">
              {t("currencyLocked", { currency })}
            </p>
            {newSecError && <p className={errorClass}>{translateError(newSecError)}</p>}
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={createSecurity}>
                {t("createSecurity")}
              </Button>
              <button type="button" className={ghostButtonClass} onClick={() => setNewSecOpen(false)}>
                {tForms("cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`${ghostButtonClass} self-start`}
            onClick={() => setNewSecOpen(true)}
          >
            {t("newSecurity", { currency })}
          </button>
        ))}

      <div className="grid grid-cols-2 gap-[var(--density-field-gap)] sm:grid-cols-4">
        <label className={labelClass}>
          {tForms("date")}
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
              {t("shares")}
              <input
                className={moneyFieldClass}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={t("sharesPlaceholder")}
              />
            </label>
            <label className={labelClass}>
              {t("pricePerShare", { currency })}
              <input
                className={moneyFieldClass}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={t("pricePlaceholder")}
              />
            </label>
          </>
        )}
        <label className={labelClass}>
          {mode === "dividend" ? t("netDividend", { currency }) : t("totalForeign", { currency })}
          <input
            className={moneyFieldClass}
            value={totalForeign}
            onChange={(e) => setTotalForeign(e.target.value)}
            placeholder={mode === "dividend" ? t("dividendPlaceholder") : t("totalPlaceholder")}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-[var(--density-field-gap)] sm:grid-cols-2">
        <label className={labelClass}>
          {mode === "dividend" ? t("ronDividend") : mode === "buy" ? t("ronBuy") : t("ronSell")}
          <input
            className={moneyFieldClass}
            value={totalRon}
            onChange={(e) => setTotalRon(e.target.value)}
            placeholder={t("ronPlaceholder")}
          />
        </label>
        {!isRonAccount && (
          <div className={labelClass}>
            {t("impliedRate")}
            <p className="flex h-[var(--density-control-height)] items-center gap-2 font-numeric text-secondary text-text-primary">
              {rate ? (
                <>
                  <span>{t("rateValue", { currency, rate: rate.rate })}</span>
                  {bnrHint && (
                    <span className="text-caption text-text-muted">{t("bnrThatDay", { rate: bnrHint })}</span>
                  )}
                </>
              ) : (
                <span className="text-text-muted">{t("enterBothTotals")}</span>
              )}
            </p>
          </div>
        )}
      </div>

      {rate && !rate.reconciles && (
        <p className={errorClass}>
          {t("reconcileError")}
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

      {error && <p className={errorClass}>{translateError(error)}</p>}
      <div>
        <Button type="submit" disabled={!canBook || pending}>
          {pending
            ? t("booking")
            : mode === "buy"
              ? t("bookBuy")
              : mode === "sell"
                ? t("bookSell")
                : t("bookDividend")}
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
  estimate: { dividendTaxRonMinor: number; dividendTaxRateBps: number } | { error: AppError } | null;
  held: string | undefined;
}) {
  const locale = useLocale();
  const t = useTranslations("investments");
  const translateError = useTranslatedError();
  if (!estimate) {
    return (
      <p className="text-caption text-text-muted">
        {held
          ? `${t("youHold", { quantity: displayQuantity(held) })} `
          : ""}
        {t("enterRonHint")}
      </p>
    );
  }
  if ("error" in estimate) return <p className={errorClass}>{translateError(estimate.error)}</p>;
  return (
    <div className="flex flex-col gap-1.5 rounded-input border border-dashed border-border-hairline p-3">
      <div>
        <Badge variant="outline">
          <span className="text-status-warning-text">{t("estimateNothingBooked")}</span>
        </Badge>
      </div>
      <p className="text-caption text-text-muted">
        {t("roughIndication", {
          rate: formatBpsPercent(estimate.dividendTaxRateBps, locale),
          amount: formatMinor(estimate.dividendTaxRonMinor, "RON", locale),
        })}
      </p>
      <p className="text-caption text-text-muted">
        {t("cassAnnualNote")}
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
  preview: SellPreview | { error: AppError } | null;
  pending: boolean;
  currency: string;
  held: string | undefined;
}) {
  const locale = useLocale();
  const t = useTranslations("investments");
  const translateError = useTranslatedError();
  if (pending) {
    return <p className="text-caption text-text-muted">{t("previewingFifo")}</p>;
  }
  if (!preview) {
    return held ? (
      <p className="text-caption text-text-muted">{t("youHold", { quantity: displayQuantity(held) })}</p>
    ) : null;
  }
  if ("error" in preview) return <p className={errorClass}>{translateError(preview.error)}</p>;
  if (!preview.ok) {
    return (
      <p className={errorClass}>
        {t("cannotSell", {
          held: displayQuantity(preview.heldQuantity),
          requested: displayQuantity(preview.requestedQuantity),
        })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-input border border-border-hairline p-3">
      <p className="text-caption text-text-muted">
        {t("fifoIntro")}
      </p>
      <table className="w-full text-secondary">
        <thead>
          <tr className="text-caption text-text-muted">
            <th className="pb-1 text-left font-normal">{t("colLotBought")}</th>
            <th className="pb-1 text-right font-normal">{t("colConsuming")}</th>
            <th className="pb-1 text-right font-normal">{t("colBasis", { currency })}</th>
            <th className="pb-1 text-right font-normal">{t("colBasis", { currency: "RON" })}</th>
          </tr>
        </thead>
        <tbody>
          {preview.lots.map((lot, i) => (
            <tr key={i} className="border-t border-border-hairline">
              <td className="py-1 text-text-primary">{lot.buyDate}</td>
              <td className="py-1 text-right font-numeric tabular-nums">
                {t("consumingOf", {
                  consuming: displayQuantity(lot.consuming),
                  lotQuantity: displayQuantity(lot.lotQuantity),
                })}
              </td>
              <td className="py-1 text-right font-numeric tabular-nums">
                {formatMinor(lot.costBasisMinor, currency, locale)}
              </td>
              <td className="py-1 text-right font-numeric tabular-nums">
                {formatMinor(lot.costBasisRonMinor, "RON", locale)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border-hairline text-text-primary">
            <td className="py-1">{t("consumedBasis")}</td>
            <td />
            <td className="py-1 text-right font-numeric tabular-nums">
              {formatMinor(preview.basisMinor, currency, locale)}
            </td>
            <td className="py-1 text-right font-numeric tabular-nums">
              {formatMinor(preview.basisRonMinor, "RON", locale)}
            </td>
          </tr>
        </tbody>
      </table>
      {preview.gainMinor !== null && preview.gainRonMinor !== null ? (
        <p className="text-secondary">
          {t.rich(preview.gainMinor >= 0 ? "realizedGain" : "realizedLoss", {
            amount: formatMinor(Math.abs(preview.gainMinor), currency, locale),
            amountRon: formatMinor(Math.abs(preview.gainRonMinor), "RON", locale),
            s: (chunks) => (
              <span
                className={
                  preview.gainRonMinor! >= 0
                    ? "text-status-positive-text"
                    : "text-status-negative-text"
                }
              >
                {chunks}
              </span>
            ),
            a: (chunks) => <span className="font-numeric tabular-nums">{chunks}</span>,
            r: (chunks) => <span className="font-numeric tabular-nums">{chunks}</span>,
          })}
          {preview.gainCategoryName && (
            <span className="text-text-muted"> {t("booksTo", { category: preview.gainCategoryName })}</span>
          )}
        </p>
      ) : (
        <p className="text-caption text-text-muted">
          {t("enterTotalsGain", { currency })}
        </p>
      )}
    </div>
  );
}
