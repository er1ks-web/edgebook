import { DEMO_SPORTS, demoEvents } from "./demo";
import { buildParlays } from "./engine/parlays";
import { evaluate, findPicks, leagueCoverage, type Selection } from "./engine/picks";
import { fetchOdds, hasOddsKey, OddsApiError, type Quota } from "./oddsApi";
import { readOddsCache, readState, updateOddsCache, updateState, type OddsCache } from "./store";
import type { Strategy } from "./strategy";
import type { AiItem, Parlay, Pick, RawEvent, ScanResult } from "./types";

/** A refresh inside this window reuses the cached odds rather than spending credits. */
const MIN_REFETCH_MS = 5 * 60_000;
export const REVIEW_MAX_AGE_MS = 12 * 3_600_000;

const cacheKey = (sport: string, s: Strategy) =>
  `${sport}|${[...s.regions].sort().join(",")}|${[...s.markets].sort().join(",")}`;

/** false: saved odds only. "missing": fetch only leagues with none saved. true: refresh. */
export type RefreshMode = boolean | "missing";

export interface LoadedEvents {
  mode: "demo" | "live";
  events: RawEvent[];
  loadedSports: string[];
  fetchedAt: string | null;
  quota: Quota;
  warnings: string[];
}

export async function loadEvents(s: Strategy, refresh: RefreshMode): Promise<LoadedEvents> {
  if (!hasOddsKey()) {
    const events = s.sports.flatMap((sport) => demoEvents(sport));
    const warnings = events.length
      ? []
      : [`None of this strategy's sports have demo data. Pick from: ${DEMO_SPORTS.map((d) => d.title).join(", ")}.`];
    return { mode: "demo", events, loadedSports: DEMO_SPORTS.map((d) => d.key), fetchedAt: new Date().toISOString(), quota: { remaining: null, used: null }, warnings };
  }

  const cache = await readOddsCache();
  const warnings: string[] = [];
  const updates: OddsCache = {};
  let quota: Quota | null = null;
  const now = Date.now();

  await Promise.all(
    s.sports.map(async (sport) => {
      const key = cacheKey(sport, s);
      const cached = cache[key];
      if (!refresh) return;
      if (cached && (refresh === "missing" || now - Date.parse(cached.fetchedAt) < MIN_REFETCH_MS)) return;
      try {
        const { data, quota: q } = await fetchOdds(sport, s.regions, s.markets);
        updates[key] = { fetchedAt: new Date().toISOString(), events: data };
        if (q.remaining !== null && (quota?.remaining == null || q.remaining < quota.remaining)) quota = q;
      } catch (err) {
        const message = err instanceof OddsApiError ? err.message : "network error";
        warnings.push(`Couldn't refresh ${sport}: ${message}`);
      }
    }),
  );

  if (Object.keys(updates).length) await updateOddsCache(updates);
  const merged = { ...cache, ...updates };
  if (quota) {
    const latest = quota;
    await updateState((state) => { state.quota = latest; });
  }

  const entries = s.sports.map((sport) => merged[cacheKey(sport, s)]).filter(Boolean);
  if (!entries.length) {
    warnings.push("No odds loaded yet for this strategy. Press Refresh odds to fetch them.");
  } else if (entries.length < s.sports.length) {
    warnings.push("Some of this strategy's sports have no odds loaded yet. Press Refresh odds.");
  }
  const oldest = entries.length ? Math.min(...entries.map((e) => Date.parse(e.fetchedAt))) : null;
  if (oldest !== null && now - oldest > s.maxStalenessMin * 60_000) {
    warnings.push(
      `These odds are older than your ${s.maxStalenessMin} minute freshness limit, so most prices are filtered out. Press Refresh odds.`,
    );
  }

  return {
    mode: "live",
    events: entries.flatMap((e) => e.events),
    loadedSports: s.sports.filter((sport) => merged[cacheKey(sport, s)]),
    fetchedAt: oldest === null ? null : new Date(oldest).toISOString(),
    quota: quota ?? (await readState()).quota,
    warnings,
  };
}

function bookList(events: RawEvent[]) {
  const books = new Map<string, string>();
  for (const e of events) for (const b of e.bookmakers) books.set(b.key, b.title);
  return [...books].map(([key, title]) => ({ key, title })).sort((a, b) => a.title.localeCompare(b.title));
}

/** Records the latest pre-game fair price on open bets, to measure closing line value. */
async function trackClosingPrices(selections: Selection[]) {
  const fair = new Map(selections.filter((s) => s.fairProb !== null).map((s) => [s.key, s.fairProb!]));
  const now = Date.now();
  await updateState((state) => {
    for (const bet of state.bets) {
      if (bet.status !== "pending" || bet.demo) continue;
      for (const leg of bet.legs) {
        const prob = fair.get(leg.key);
        if (prob !== undefined && Date.parse(leg.commence) > now) leg.closingProb = prob;
      }
    }
  });
}

export function reviewItems(strategyId: string, reviews: Awaited<ReturnType<typeof readState>>["reviews"]) {
  const review = reviews[strategyId];
  if (!review || Date.now() - Date.parse(review.at) > REVIEW_MAX_AGE_MS) return { review: null, items: {} as Record<string, AiItem> };
  return { review, items: review.items };
}

export async function runScan(s: Strategy, refresh: RefreshMode): Promise<ScanResult> {
  const loaded = await loadEvents(s, refresh);
  const selections = evaluate(loaded.events, s);
  if (loaded.mode === "live" && refresh) await trackClosingPrices(selections);

  const { reviews } = await readState();
  const { review, items } = reviewItems(s.id, reviews);
  const { picks, rejected } = findPicks(selections, s, items);
  const parlays = buildParlays(selections, s, items);

  const warnings = [...loaded.warnings];
  if (s.fairSource === "sharp" && loaded.events.length && !selections.some((x) => x.offers.length)) {
    warnings.push("No sharp reference book priced these games. Try the Broad consensus source or add a region.");
  }

  if (s.sports.some((k) => k.startsWith("icehockey_")) && !s.markets.includes("h2h")) {
    warnings.push(
      "Hockey totals and spreads need Match winner turned on too. Without it, Edgebook can't tell which books price regulation time only, so hockey edges may be false.",
    );
  }

  let ai: ScanResult["ai"] = null;
  if (review) {
    const { items: _items, ...rest } = review;
    ai = rest;
  }

  return {
    mode: loaded.mode,
    fetchedAt: loaded.fetchedAt,
    quota: loaded.quota,
    picks,
    parlays,
    rejected,
    stats: {
      events: loaded.events.length,
      evaluated: selections.length,
      books: bookList(loaded.events),
      leagues: leagueCoverage(s, loaded.events, selections, picks, loaded.loadedSports),
    },
    ai,
    warnings,
  };
}

/** The selections worth paying to research: top singles first, then parlay legs. */
export function reviewCandidates(picks: Pick[], parlays: Parlay[], limit: number): Pick[] {
  const seen = new Map<string, Pick>();
  for (const p of picks) if (seen.size < limit && !seen.has(p.key)) seen.set(p.key, p);
  for (const parlay of parlays) {
    for (const leg of parlay.legs) if (seen.size < limit && !seen.has(leg.key)) seen.set(leg.key, leg);
  }
  return [...seen.values()];
}
