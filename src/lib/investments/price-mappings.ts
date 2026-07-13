export type PriceProvider = "stooq" | "eodhd";

export interface VerifiedPriceMapping {
  ticker: string;
  currency: "USD" | "EUR";
  stooq: string;
  eodhd: string;
}

export const VERIFIED_PRICE_MAPPINGS = [
  { ticker: "AAPL", currency: "USD", stooq: "aapl.us", eodhd: "AAPL.US" },
  { ticker: "ADBE", currency: "USD", stooq: "adbe.us", eodhd: "ADBE.US" },
  { ticker: "ALAB", currency: "USD", stooq: "alab.us", eodhd: "ALAB.US" },
  { ticker: "AMAT", currency: "USD", stooq: "amat.us", eodhd: "AMAT.US" },
  { ticker: "AMD", currency: "USD", stooq: "amd.us", eodhd: "AMD.US" },
  { ticker: "AMZN", currency: "USD", stooq: "amzn.us", eodhd: "AMZN.US" },
  { ticker: "ASML", currency: "USD", stooq: "asml.us", eodhd: "ASML.US" },
  { ticker: "BAC", currency: "USD", stooq: "bac.us", eodhd: "BAC.US" },
  { ticker: "BRO", currency: "USD", stooq: "bro.us", eodhd: "BRO.US" },
  { ticker: "CORT", currency: "USD", stooq: "cort.us", eodhd: "CORT.US" },
  { ticker: "CRDO", currency: "USD", stooq: "crdo.us", eodhd: "CRDO.US" },
  { ticker: "CRM", currency: "USD", stooq: "crm.us", eodhd: "CRM.US" },
  { ticker: "DHI", currency: "USD", stooq: "dhi.us", eodhd: "DHI.US" },
  { ticker: "DUOL", currency: "USD", stooq: "duol.us", eodhd: "DUOL.US" },
  { ticker: "EXE", currency: "USD", stooq: "exe.us", eodhd: "EXE.US" },
  { ticker: "GSK", currency: "USD", stooq: "gsk.us", eodhd: "GSK.US" },
  { ticker: "JPM", currency: "USD", stooq: "jpm.us", eodhd: "JPM.US" },
  { ticker: "MCO", currency: "USD", stooq: "mco.us", eodhd: "MCO.US" },
  { ticker: "MELI", currency: "USD", stooq: "meli.us", eodhd: "MELI.US" },
  { ticker: "META", currency: "USD", stooq: "meta.us", eodhd: "META.US" },
  { ticker: "MSFT", currency: "USD", stooq: "msft.us", eodhd: "MSFT.US" },
  { ticker: "NFLX", currency: "USD", stooq: "nflx.us", eodhd: "NFLX.US" },
  { ticker: "NOW", currency: "USD", stooq: "now.us", eodhd: "NOW.US" },
  { ticker: "NU", currency: "USD", stooq: "nu.us", eodhd: "NU.US" },
  { ticker: "NVDA", currency: "USD", stooq: "nvda.us", eodhd: "NVDA.US" },
  { ticker: "NVO", currency: "USD", stooq: "nvo.us", eodhd: "NVO.US" },
  { ticker: "NVR", currency: "USD", stooq: "nvr.us", eodhd: "NVR.US" },
  { ticker: "PINS", currency: "USD", stooq: "pins.us", eodhd: "PINS.US" },
  { ticker: "PLTR", currency: "USD", stooq: "pltr.us", eodhd: "PLTR.US" },
  { ticker: "RACE", currency: "USD", stooq: "race.us", eodhd: "RACE.US" },
  { ticker: "SNPS", currency: "USD", stooq: "snps.us", eodhd: "SNPS.US" },
  { ticker: "SPOT", currency: "USD", stooq: "spot.us", eodhd: "SPOT.US" },
  { ticker: "UBER", currency: "USD", stooq: "uber.us", eodhd: "UBER.US" },
  { ticker: "V", currency: "USD", stooq: "v.us", eodhd: "V.US" },
  { ticker: "VRT", currency: "USD", stooq: "vrt.us", eodhd: "VRT.US" },
  { ticker: "WMB", currency: "USD", stooq: "wmb.us", eodhd: "WMB.US" },
  { ticker: "XOM", currency: "USD", stooq: "xom.us", eodhd: "XOM.US" },
  { ticker: "BMW", currency: "EUR", stooq: "bmw.de", eodhd: "BMW.XETRA" },
  { ticker: "CEBT", currency: "EUR", stooq: "cebt.de", eodhd: "CEBT.XETRA" },
  { ticker: "INN1", currency: "EUR", stooq: "inn1.de", eodhd: "INN1.XETRA" },
  { ticker: "LYP6", currency: "EUR", stooq: "lyp6.de", eodhd: "LYP6.XETRA" },
  { ticker: "SPP1", currency: "EUR", stooq: "spp1.de", eodhd: "SPP1.XETRA" },
  { ticker: "SPPE", currency: "EUR", stooq: "sppe.de", eodhd: "SPPE.XETRA" },
  { ticker: "SPPY", currency: "EUR", stooq: "sppy.de", eodhd: "SPPY.XETRA" },
  { ticker: "UIQI", currency: "EUR", stooq: "uiqi.de", eodhd: "UIQI.XETRA" },
  { ticker: "V50A", currency: "EUR", stooq: "v50a.de", eodhd: "V50A.XETRA" },
  { ticker: "XSX6", currency: "EUR", stooq: "xsx6.de", eodhd: "XSX6.XETRA" },
] as const satisfies readonly VerifiedPriceMapping[];

export function providerMappings() {
  return VERIFIED_PRICE_MAPPINGS.flatMap((mapping) => [
    { ticker: mapping.ticker, currency: mapping.currency, provider: "stooq" as const, symbol: mapping.stooq },
    { ticker: mapping.ticker, currency: mapping.currency, provider: "eodhd" as const, symbol: mapping.eodhd },
  ]);
}
