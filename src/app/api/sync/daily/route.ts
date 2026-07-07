/**
 * THE one daily batch job (parked-plan Vercel-cron discipline: one
 * invocation, not frequent polling): latest BNR FX rates + a price snapshot
 * for every held security via the configured source. Idempotent — both
 * halves upsert on their unique keys.
 *
 * No price source is configured yet (manual entry is the path until real
 * tickers exist to test API coverage against). Locally this is triggered by
 * hand; Vercel cron wires to it at deployment (Phase 7). Guard: when
 * SYNC_TOKEN is set in the environment, the x-sync-token header must match
 * — unset in local dev, REQUIRED before any public deployment.
 */
import { NextResponse } from "next/server";
import { syncLatestRates } from "@/lib/fx/sync";
import { syncDailyPrices } from "@/lib/investments/prices";

export async function POST(request: Request) {
  const token = process.env.SYNC_TOKEN;
  if (token && request.headers.get("x-sync-token") !== token) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const fx = await syncLatestRates();
  const prices = await syncDailyPrices();
  return NextResponse.json({ fx, prices });
}
