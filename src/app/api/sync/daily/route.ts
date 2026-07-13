/**
 * THE one daily batch job (parked-plan Vercel-cron discipline: one
 * invocation, not frequent polling): latest BNR FX rates + one 20-call EODHD
 * rotation. Idempotent — both halves upsert on their unique keys.
 *
 * SCHEDULING STATUS: this route is manual/localhost-only today. No automatic
 * job invokes it; Vercel cron wiring remains a Phase 7 deployment task. The
 * roughly 2.4-day full ticker rotation assumes that future daily execution.
 * Locally this is triggered by hand. Guard: when
 * SYNC_TOKEN is set in the environment, the x-sync-token header must match
 * — unset in local dev, REQUIRED before any public deployment.
 */
import { NextResponse } from "next/server";
import { syncLatestRates } from "@/lib/fx/sync";
import { syncEodhdPrices } from "@/lib/investments/eodhd";

export async function POST(request: Request) {
  const token = process.env.SYNC_TOKEN;
  if (token && request.headers.get("x-sync-token") !== token) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  if (!process.env.EODHD_API_TOKEN) {
    return NextResponse.json({ error: "EODHD_API_TOKEN is not configured" }, { status: 503 });
  }
  const fx = await syncLatestRates();
  const prices = await syncEodhdPrices();
  return NextResponse.json({ fx, prices });
}
