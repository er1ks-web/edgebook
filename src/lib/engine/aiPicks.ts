import type { Strategy } from "../strategy";
import type { AiBet, AiItem, AiPass, RawEvent } from "../types";
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
}

/** Less sure estimates move the final probability less. */
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { low: 1 / 3, medium: 2 / 3, high: 1 };

const usable = (o: Offer, s: Strategy) =>
  canBetAt(o.book, s) &&
  o.price >= s.minOdds &&
  o.price <= s.maxOdds &&
  // A huge gap from the market is usually a stale price, whatever the prediction says.
  expectedValue(o.marketProb, o.price) * 100 <= s.maxEvPct;

/**
 * Chooses which games to pay to research: soonest first, because lineups and injury
 * news are most complete close to kickoff. Each game offers the match result plus the
 * most widely quoted line of each other market, so Claude isn't asked about every line.
 */
export function selectGames(selections: Selection[], s: Strategy, now = Date.now()): GameCandidate[] {
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
    if (chosen.some((x) => x.offers.some((o) => usable(o, s)))) {
      candidates.push({ event: chosen[0].event, selections: chosen });
    }
  }
  return candidates
    .sort((a, b) => Date.parse(a.event.commence_time) - Date.parse(b.event.commence_time))
    .slice(0, s.ai.gamesToResearch);
}

/** Moves from the market toward Claude's estimate by the strategy's weight, within its cap. */
export function blendedAdjustmentPts(marketProb: number, aiChance: number, confidence: Confidence, s: Strategy) {
  const move = (aiChance - marketProb) * (s.ai.aiWeightPct / 100) * CONFIDENCE_WEIGHT[confidence] * 100;
  return clampAdjustment(move, s);
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
