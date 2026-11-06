import type { Strategy } from "../strategy";
import type { AiBet, AiItem, AiPass, Parlay, Pick, RawEvent } from "../types";
import { expectedValue } from "./odds";
import { canBetAt, clampAdjustment, inWindow, toPick, type Offer, type Selection } from "./picks";

export interface GameCandidate {
  event: RawEvent;
  selections: Selection[];
}

export type Confidence = "low" | "medium" | "high";

export interface GamePrediction {
  gameId: string;
  /** Selection key Claude would back, or "none". */
  pickId: string;
  confidence: Confidence;
  summary: string;
  risks: string[];
  sources: { title: string; url: string }[];
  /** Claude's probability per selection key, as 0 to 1. */
  chances: Record<string, number>;
  /** How strong Claude thinks the case is, from 1 to 10. */
  conviction?: number;
}

/** Less sure estimates move the final probability less. */
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { low: 1 / 3, medium: 2 / 3, high: 1 };

const usable = (o: Offer, s: Strategy) =>
  canBetAt(o.book, s) &&
  o.price >= s.minOdds &&
  o.price <= s.maxOdds &&
  // A huge gap from the market is usually a stale price, whatever the prediction says.
  expectedValue(o.marketProb, o.price) * 100 <= s.maxEvPct;

/** Best picks aren't held to an edge, but a huge gap from the market still means a stale price. */
const bookable = (o: Offer, s: Strategy) => canBetAt(o.book, s) && expectedValue(o.marketProb, o.price) * 100 <= s.maxEvPct;

/**
 * Chooses which games to pay to research: soonest first, because lineups and injury
 * news are most complete close to kickoff. Each game offers the match result plus the
 * most widely quoted line of each other market, so Claude isn't asked about every line.
 */
export function usableGames(selections: Selection[], s: Strategy, now = Date.now()): GameCandidate[] {
  const games = new Map<string, Selection[]>();
  for (const sel of selections) {
    if (!inWindow(sel.event.commence_time, s, now)) continue;
    if (!sel.offers.length) continue;
    games.set(sel.event.id, [...(games.get(sel.event.id) ?? []), sel]);
  }

  const candidates: GameCandidate[] = [];
  for (const sels of games.values()) {
    const chosen = sels.filter((x) => x.market === "h2h");
    for (const market of ["totals", "spreads"] as const) {
      const ofMarket = sels.filter((x) => x.market === market);
      if (!ofMarket.length) continue;
      const lineOf = (x: Selection) =>
        market === "totals" ? x.point : x.name === x.event.home_team ? x.point : -(x.point ?? 0);
      const main = [...ofMarket].sort((a, b) => b.offers.length - a.offers.length)[0];
      chosen.push(...ofMarket.filter((x) => lineOf(x) === lineOf(main)));
    }
    const open = s.ai.pickStyle === "best" ? bookable : usable;
    if (chosen.some((x) => x.offers.some((o) => open(o, s)))) {
      candidates.push({ event: chosen[0].event, selections: chosen });
    }
  }
  return candidates
    .sort((a, b) => Date.parse(a.event.commence_time) - Date.parse(b.event.commence_time));
}

/** "Every game" still stops here, because one press would otherwise have no spending limit. */
export const MAX_RESEARCH_ALL = 40;

export const researchLimit = (s: Strategy) => (s.ai.researchAll ? MAX_RESEARCH_ALL : s.ai.gamesToResearch);

export const selectGames = (selections: Selection[], s: Strategy, now = Date.now()): GameCandidate[] =>
  usableGames(selections, s, now).slice(0, researchLimit(s));

/** Runs work on groups of items, a few at a time. One failed group doesn't lose the others. */
export async function inBatches<T, R>(
  items: T[],
  size: number,
  concurrency: number,
  work: (batch: T[]) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const results: PromiseSettledResult<R>[] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await work(batches[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return results;
}

/** Moves from the market toward Claude's estimate by the strategy's weight, within its cap. */
export function blendedAdjustmentPts(marketProb: number, aiChance: number, confidence: Confidence, s: Strategy) {
  const move = (aiChance - marketProb) * (s.ai.aiWeightPct / 100) * CONFIDENCE_WEIGHT[confidence] * 100;
  return clampAdjustment(move, s);
}

export const flatStake = (bankroll: number, pct: number) => Math.floor(bankroll * pct) / 100;

/** A soft book's price usually sits a few percent under fair, so that much still counts as fair. */
const FAIR_PRICE_GAP = -0.06;
const GOOD_PRICE_GAP = 0.01;

/** How the price compares with the market. This informs a best pick but doesn't block it. */
export function priceTag(marketProb: number, price: number): "good" | "fair" | "short" {
  const gap = expectedValue(marketProb, price);
  return gap >= GOOD_PRICE_GAP ? "good" : gap >= FAIR_PRICE_GAP ? "fair" : "short";
}

const MIN_PARLAY_CONVICTION = 5;

/** Parlays from the strongest picks, from the fewest legs up, each priced at one book. */
export function buildBestParlays(bets: AiBet[], s: Strategy): Parlay[] {
  if (!s.parlay.enabled) return [];
  const pool = bets
    .filter((b) => (b.conviction ?? 0) >= MIN_PARLAY_CONVICTION)
    .sort((a, b) => b.aiChance - a.aiChance);
  const parlays: Parlay[] = [];
  for (let size = s.parlay.minLegs; size <= Math.min(s.parlay.maxLegs, pool.length); size++) {
    const chosen = pool.slice(0, size);
    let best: Parlay | null = null;
    for (const { book, bookTitle } of chosen[0].offers ?? []) {
      const legs: Pick[] = [];
      for (const leg of chosen) {
        const offer = leg.offers?.find((o) => o.book === book);
        if (offer) legs.push({ ...leg, book, bookTitle, price: offer.price, prob: offer.prob, ev: expectedValue(offer.prob, offer.price), offers: undefined });
      }
      if (legs.length < size) continue;
      const odds = legs.reduce((a, l) => a * l.price, 1);
      if (best && odds <= best.odds) continue;
      const hitProb = legs.reduce((a, l) => a * l.prob, 1);
      const stake = flatStake(s.bankroll, s.parlay.maxStakePct);
      best = { id: `best-${size}`, book, bookTitle, legs, odds, hitProb, ev: expectedValue(hitProb, odds), stake, payout: Math.round(stake * odds * 100) / 100 };
    }
    if (best && best.odds >= s.parlay.minCombinedOdds && best.odds <= s.parlay.maxCombinedOdds && best.hitProb * 100 >= s.parlay.minHitProbPct) {
      parlays.push(best);
    }
  }
  return parlays;
}

/**
 * Recommends what Claude thinks is most likely to come in, strongest case first. The price
 * doesn't decide it, but the app still shows how it compares, so a poor one is visible.
 */
export function buildBestPicks(
  games: GameCandidate[],
  predictions: GamePrediction[],
  s: Strategy,
): { bets: AiBet[]; parlays: Parlay[]; passes: AiPass[] } {
  const bets: AiBet[] = [];
  const passes: AiPass[] = [];

  for (const { event, selections } of games) {
    const base = {
      eventId: event.id,
      fixture: `${event.home_team} vs ${event.away_team}`,
      sportTitle: event.sport_title ?? event.sport_key,
      commence: event.commence_time,
    };
    const pass = (reason: string) => passes.push({ ...base, reason });

    const p = predictions.find((x) => x.gameId === event.id);
    if (!p) {
      pass("Not covered by the research.");
      continue;
    }
    const sel = selections.find((x) => x.key === p.pickId);
    if (!sel) {
      pass(p.summary || "Claude didn't find a strong enough case for any bet.");
      continue;
    }
    const aiChance = p.chances[sel.key];
    if (aiChance === undefined || !(aiChance > 0 && aiChance < 1)) {
      pass(`Claude chose ${sel.label} but gave no usable probability.`);
      continue;
    }
    const open = sel.offers.filter((o) => bookable(o, s));
    if (!open.length) {
      pass(`Claude likes ${sel.label}, but none of your books offers it.`);
      continue;
    }
    const options = open.filter((o) => o.price >= s.minOdds && o.price <= s.maxOdds).sort((a, b) => b.price - a.price);
    if (!options.length) {
      const top = Math.max(...open.map((o) => o.price));
      pass(`Claude likes ${sel.label}, but its odds of ${top.toFixed(2)} are outside your limits of ${s.minOdds} to ${s.maxOdds}.`);
      continue;
    }
    const offer = options[0];
    const review: AiItem = {
      key: sel.key,
      verdict: "back",
      adjustmentPts: blendedAdjustmentPts(offer.marketProb, aiChance, p.confidence, s),
      confidence: p.confidence,
      summary: p.summary,
      risks: p.risks,
      sources: p.sources,
    };
    const pick = toPick(sel, offer, s, review);
    bets.push({
      ...pick,
      stake: Math.min(flatStake(s.bankroll, s.ai.flatStakePct), flatStake(s.bankroll, s.maxStakePct)),
      aiChance,
      minPrice: lowestPrice(pick.prob, 0),
      conviction: p.conviction ?? 5,
    });
  }

  bets.sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0) || b.aiChance - a.aiChance);
  for (const b of bets.slice(s.ai.picksCount)) {
    passes.push({
      eventId: b.eventId,
      fixture: `${b.home} vs ${b.away}`,
      sportTitle: b.sportTitle,
      commence: b.commence,
      reason: `${b.label} qualified, but stronger picks filled your limit of ${s.ai.picksCount}.`,
    });
  }
  return { bets: bets.slice(0, s.ai.picksCount), parlays: buildBestParlays(bets, s), passes };
}

export const lowestPrice = (prob: number, minEdgePct: number) => (1 + minEdgePct / 100) / prob;

/**
 * A bet is recommended only when Claude chose it and the price supports it after
 * blending. Otherwise the game is listed as a pass, with the reason.
 */
export function buildAiBets(
  games: GameCandidate[],
  predictions: GamePrediction[],
  s: Strategy,
): { bets: AiBet[]; passes: AiPass[] } {
  const bets: AiBet[] = [];
  const passes: AiPass[] = [];

  for (const { event, selections } of games) {
    const base = {
      eventId: event.id,
      fixture: `${event.home_team} vs ${event.away_team}`,
      sportTitle: event.sport_title ?? event.sport_key,
      commence: event.commence_time,
    };
    const pass = (reason: string, watch?: AiPass["watch"]) => passes.push({ ...base, reason, watch });

    const p = predictions.find((x) => x.gameId === event.id);
    if (!p) {
      pass("Not covered by the research.");
      continue;
    }
    const sel = selections.find((x) => x.key === p.pickId);
    if (!sel) {
      pass(p.summary || "Claude didn't find a bet worth backing.");
      continue;
    }
    const aiChance = p.chances[sel.key];
    if (aiChance === undefined || !(aiChance > 0 && aiChance < 1)) {
      pass(`Claude chose ${sel.label} but gave no usable probability.`);
      continue;
    }

    const options = sel.offers.filter((o) => usable(o, s)).sort((a, b) => b.price - a.price);
    if (!options.length) {
      pass(`Claude likes ${sel.label}, but no usable book offers it within your odds limits.`);
      continue;
    }

    const review = (adjustmentPts: number): AiItem => ({
      key: sel.key,
      verdict: "back",
      adjustmentPts,
      confidence: p.confidence,
      summary: p.summary,
      risks: p.risks,
      sources: p.sources,
    });
    const priced = options
      .map((o) => toPick(sel, o, s, review(blendedAdjustmentPts(o.marketProb, aiChance, p.confidence, s))))
      .sort((a, b) => b.ev - a.ev);
    const best = priced[0];
    const minPrice = lowestPrice(best.prob, s.ai.minEdgePct);

    if (best.ev * 100 < s.ai.minEdgePct) {
      pass(p.summary, {
        label: sel.label,
        minPrice,
        bestPrice: best.price,
        book: best.bookTitle,
      });
      continue;
    }
    bets.push({ ...best, aiChance, minPrice });
  }

  bets.sort((a, b) => b.ev - a.ev);
  const kept = bets.slice(0, s.ai.picksCount);
  for (const b of bets.slice(s.ai.picksCount)) {
    passes.push({
      eventId: b.eventId,
      fixture: `${b.home} vs ${b.away}`,
      sportTitle: b.sportTitle,
      commence: b.commence,
      reason: `${b.label} qualified, but stronger bets filled your limit of ${s.ai.picksCount}.`,
    });
  }
  return { bets: kept, passes };
}
