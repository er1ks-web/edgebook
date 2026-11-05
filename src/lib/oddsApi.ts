import type { RawEvent } from "./types";

const HOST = "https://api.the-odds-api.com/v4";

export interface SportInfo { key: string; title: string; group: string }
export interface ApiScore {
  id: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
}
export interface Quota { remaining: number | null; used: number | null }

export class OddsApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export const hasOddsKey = () => Boolean(process.env.ODDS_API_KEY?.trim());

async function call<T>(pathname: string, params: Record<string, string>) {
  const url = new URL(`${HOST}${pathname}`);
  url.searchParams.set("apiKey", process.env.ODDS_API_KEY!.trim());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    // Never echo the URL, which contains the key.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new OddsApiError(body?.message ?? `Odds API returned ${res.status}`, res.status);
  }
  const header = (name: string) => {
    const value = res.headers.get(name);
    return value === null ? null : Number(value);
  };
  const quota: Quota = { remaining: header("x-requests-remaining"), used: header("x-requests-used") };
  return { data: (await res.json()) as T, quota };
}

export async function fetchSports(): Promise<SportInfo[]> {
  const { data } = await call<(SportInfo & { active: boolean; has_outrights: boolean })[]>("/sports", {});
  return data
    .filter((s) => s.active && !s.has_outrights)
    .map(({ key, title, group }) => ({ key, title, group }));
}

export function fetchOdds(sport: string, regions: string[], markets: string[]) {
  return call<RawEvent[]>(`/sports/${encodeURIComponent(sport)}/odds`, {
    regions: regions.join(","),
    markets: markets.join(","),
    oddsFormat: "decimal",
  });
}

export function fetchScores(sport: string) {
  return call<ApiScore[]>(`/sports/${encodeURIComponent(sport)}/scores`, { daysFrom: "3" });
}
