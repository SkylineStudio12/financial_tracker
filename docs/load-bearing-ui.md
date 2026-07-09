# Load-bearing UI — placement that carries meaning

Some UI elements communicate through their PLACEMENT, PROMINENCE, or FORM —
not just their copy. A layout edit that looks cosmetic can silently break a
deliberate UX decision. This registry names those elements so future edits
(restyles, extractions, "tidying") check here first.

**The general principle:** an element is load-bearing if its placement,
prominence, or form communicates something about **correctness**,
**completeness**, or **informed consent** — as opposed to pure aesthetics.
When in doubt, ask before moving. (This registry backs judgment flag 2,
"Domain semantics", in `docs/review-standards.md`.)

i18n note (2026-07-09): copy for these elements is migrating into the
`messages/` catalogs (Stage 3 chunks). Extraction preserves meaning by
design, but the Stage-4 Romanian wording must keep each marker's force —
"ESTIMATE" must stay a warning, "excludes N unpriced" must stay impossible
to read as a clean total.

---

## 1. Sell preview panel (trade form, sell mode)

**What:** `SellPreviewPanel` in `src/components/investments/trade-form.tsx` —
renders the FIFO lots about to be consumed, the consumed basis, and the
realized gain in BOTH currencies, ABOVE the Book button, before anything
books. Over-consumption renders as "you hold X, cannot sell Y".

**Why placement matters:** it makes a sell an informed action instead of a
black-box commit. The gating is code, not convention: `canBook` in the form
requires `preview.ok` for sells — Book stays disabled until the preview
succeeds.

**The deeper invariant:** the preview is `previewSell` in
`src/lib/investments/service.ts` — the SAME `loadLots` +
`planFifoConsumption` walk the booking path runs, with writes replaced by a
structured result. There is no parallel preview math; a parity test pins
preview-equals-booking. Booking still re-runs the walk authoritatively in
its own transaction (the preview is advisory, never trusted as a write plan).

**Breaking edits:** moving the panel below/after Book, hiding it behind a
toggle, enabling Book without `preview.ok`, or "optimizing" the preview with
independent math — each reintroduces black-box selling or lets preview and
booking diverge.

## 2. Honest empty/stale/unpriced states (investment cards + holdings table)

**What:** `src/components/investments/dashboard-cards.tsx` (its header
comment states the three honesty rules) and
`src/components/investments/holdings-table.tsx`:
- "Excludes N unpriced holding(s) (basis X RON)" — `HonestyLines`, rendered
  WITH the headline total, not in a tooltip or footnote.
- Stale prices carry their real date ("as of <date>"), per row and as the
  oldest-stale line on the summary.
- Absence renders as absence: "no holdings", "N holdings, unpriced",
  "no price — not valued", an em-dash — NEVER "0.00 RON".
- The totals row names how many holdings it excludes.

**Why placement matters:** an incomplete total must never read as complete,
and zero is a real number — absence is not zero. The exclusion line's
adjacency to the total is the honesty; the total is only trustworthy
together with its caveat.

**Breaking edits:** burying the exclusion line (tooltip, collapsed section,
smaller-than-legible type) so the total looks clean; rendering an unpriced
holding as 0; dropping the stale date while keeping the stale price.

## 3. Dividend estimate panel (trade form, dividend mode)

**What:** `DividendEstimatePanel` in
`src/components/investments/trade-form.tsx` — DASHED border
(`border-dashed`), a badge reading "ESTIMATE — nothing is booked", a rough
dividend-tax indication, and deliberately NO per-dividend CASS figure (the
copy explains CASS is an annual-threshold calculation that a single dividend
cannot determine; it belongs to the Phase-5 yearly report).

**Why form matters:** the visual contrast with the solid-bordered sell
preview IS the message — one is an estimate that books nothing, the other
describes an imminent booking. The absent CASS number is content: showing
any per-dividend CASS figure would assert a computation the domain says
cannot exist at this granularity.

**Breaking edits:** restyling it to match the real preview (solid border,
same badge treatment); adding a per-dividend CASS number "for
completeness"; dropping the "nothing is booked" marker. Related markers
elsewhere are catalog-driven since Stage 3b/3c (`common.estimate` —
ESTIMATE/ESTIMARE) and must keep warning force in every locale.

## 4. Import review inbox (statement imports)

**What:** `src/components/import/import-inbox.tsx` — every staged statement
row books only through explicit confirmation. Per row: Book is disabled
unless the row is `pending` AND its category requirement is satisfied
(`bookingNeedsCategory` in `src/lib/import/booking-rules.ts`); the
confidence badge renders destructive-variant when not high. The bulk action
is explicitly scoped: "Confirm all high-confidence" books high-confidence
rows only — low-confidence, overlap-suspect, and category-less rows stay
for review.

**Why placement matters:** the confirm-gate is the human safety layer
between a parser's guess and the ledger. Confidence and blocking states are
visible on the row they gate, at the moment of decision.

**Breaking edits:** auto-booking on import; letting low-confidence or
category-less rows through the bulk action; hiding the confidence badge or
moving it away from the Book control it justifies.

---

## Maintenance

Add an entry when a new element's placement/prominence/form carries
correctness, completeness, or consent semantics. Entries change only by
owner-confirmed commit. If an element is removed or redesigned, update its
entry in the same unit of work — a stale entry is worse than none.
