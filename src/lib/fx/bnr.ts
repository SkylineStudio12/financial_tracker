/**
 * Fetching and parsing of BNR (National Bank of Romania) reference rates.
 * BNR publishes one XML per banking day (weekends/holidays have no rate) and
 * yearly datasets with every banking day of a year.
 */
import { XMLParser } from "fast-xml-parser";

/** Currencies we track, matching the currency enum minus RON. */
export const BNR_CURRENCIES = ["EUR", "USD"] as const;
export type BnrCurrency = (typeof BNR_CURRENCIES)[number];

export interface BnrDailyRates {
  /** Banking day the rates were published for, YYYY-MM-DD. */
  date: string;
  rates: { currency: BnrCurrency; rateToRon: string }[];
}

const LATEST_URL = "https://www.bnr.ro/nbrfxrates.xml";
const yearlyUrl = (year: number) =>
  `https://www.bnr.ro/files/xml/years/nbrfxrates${year}.xml`;

// Keep tag values as strings: rates go into a numeric column and must not
// round-trip through floats.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
});

type RateNode = { "#text": string; "@_currency": string; "@_multiplier"?: string };
type CubeNode = { "@_date": string; Rate: RateNode | RateNode[] };

const asArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

function parseDataSet(xml: string): BnrDailyRates[] {
  const parsed = parser.parse(xml) as {
    DataSet?: { Body?: { Cube?: CubeNode | CubeNode[] } };
  };
  const cubes = parsed.DataSet?.Body?.Cube;
  if (!cubes) throw new Error("Unexpected BNR XML: no Cube elements found");

  return asArray(cubes).map((cube) => ({
    date: cube["@_date"],
    rates: asArray(cube.Rate)
      .filter((rate): rate is RateNode & { "@_currency": BnrCurrency } =>
        (BNR_CURRENCIES as readonly string[]).includes(rate["@_currency"]),
      )
      .map((rate) => ({
        currency: rate["@_currency"],
        // Some currencies are quoted per N units (multiplier attribute).
        // EUR/USD are per 1 unit, but normalize defensively.
        rateToRon: rate["@_multiplier"]
          ? (Number(rate["#text"]) / Number(rate["@_multiplier"])).toFixed(6)
          : rate["#text"],
      })),
  }));
}

async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { accept: "application/xml" } });
  if (!response.ok) {
    throw new Error(`BNR request failed: ${response.status} ${response.statusText} (${url})`);
  }
  return response.text();
}

/** Rates for the most recent banking day. */
export async function fetchLatestRates(): Promise<BnrDailyRates> {
  const days = parseDataSet(await fetchXml(LATEST_URL));
  return days[days.length - 1];
}

/** All banking days of a year (current year: up to the latest published day). */
export async function fetchYearRates(year: number): Promise<BnrDailyRates[]> {
  return parseDataSet(await fetchXml(yearlyUrl(year)));
}
