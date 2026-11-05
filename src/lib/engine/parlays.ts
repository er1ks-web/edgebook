import type { Strategy } from "../strategy";
import type { AiItem, Parlay, Pick } from "../types";
import { expectedValue, stakeFor } from "./odds";
import { canBetAt, inWindow, isExchange, toPick, type Selection } from "./picks";

const MAX_CANDIDATES = 22;

/**
 * Builds parlays one book at a time, because a ticket has to be placed at a single
 * book at that book's own prices. Legs come from different events only: legs from
 * the same game are correlated, so multiplying their probabilities would be wrong.
 */
export function buildParlays(
  selections: Selection[],
  s: Strategy,
  ai: Record<string, AiItem> = {},
  now = Date.now(),
): Parlay[] {
  const c = s.parlay;
  if (!c.enabled) return [];
  const maxLegs = Math.min(Math.max(c.minLegs, c.maxLegs), 6);

  const byBook = new Map<string, Pick[]>();
  for (const sel of selections) {
    if (!inWindow(sel.event.commence_time, s, now)) continue;
    const review = ai[sel.key];
    if (review?.verdict === "pass") continue;
    for (const offer of sel.offers) {
      // Exchanges match single bets, so they don't sell tickets at these combined prices.
      if (isExchange(offer.book)) continue;
      if (!canBetAt(offer.book, s) || offer.price < c.legMinOdds || offer.price > c.legMaxOdds) continue;
      if (expectedValue(offer.marketProb, offer.price) * 100 > s.maxEvPct) continue;
      const leg = toPick(sel, offer, s, review);
      if (leg.ev * 100 < c.legMinEvPct) continue;
      const legs = byBook.get(offer.book) ?? [];
      legs.push(leg);
      byBook.set(offer.book, legs);
    }
  }

  const all: Parlay[] = [];
  for (const [book, legs] of byBook) {
    const pool = legs.sort((a, b) => b.ev - a.ev).slice(0, MAX_CANDIDATES);
    const chosen: Pick[] = [];

    const walk = (start: number, odds: number, prob: number) => {
      if (chosen.length >= c.minLegs && odds >= c.minCombinedOdds) {
        const ev = expectedValue(prob, odds);
        if (ev > 0) {
          const stake = stakeFor(prob, odds, s.bankroll, c.kellyFraction, c.maxStakePct);
          all.push({
            id: `${book}:${chosen.map((l) => l.key).sort().join("+")}`,
            book,
            bookTitle: chosen[0].bookTitle,
            legs: [...chosen],
            odds,
            hitProb: prob,
            ev,
            stake,
            payout: Math.round(stake * odds * 100) / 100,
          });
        }
      }
      if (chosen.length === maxLegs) return;
      for (let i = start; i < pool.length; i++) {
        const leg = pool[i];
        if (chosen.some((l) => l.eventId === leg.eventId)) continue;
        if (chosen.filter((l) => l.sportKey === leg.sportKey).length >= c.maxPerSport) continue;
        const nextOdds = odds * leg.price;
        const nextProb = prob * leg.prob;
        if (nextOdds > c.maxCombinedOdds || nextProb * 100 < c.minHitProbPct) continue;
        chosen.push(leg);
        walk(i + 1, nextOdds, nextProb);
        chosen.pop();
      }
    };
    walk(0, 1, 1);
  }

  // Keep tickets that differ from each other, or the list is one parlay in many forms.
  const kept: Parlay[] = [];
  for (const p of all.sort((a, b) => b.ev - a.ev)) {
    const keys = new Set(p.legs.map((l) => l.key));
    const tooSimilar = kept.some((k) => {
      const shorter = Math.min(k.legs.length, p.legs.length);
      const shared = k.legs.filter((l) => keys.has(l.key)).length;
      return shared >= (shorter > 2 ? shorter - 1 : shorter);
    });
    if (!tooSimilar) kept.push(p);
    if (kept.length === c.count) break;
  }
  return kept;
}
