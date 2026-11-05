import type { Bet, BetCheck, BetLeg } from "../types";

/** An edge this large is usually a mistyped price or a different bet, not value. */
const SUSPECT_EDGE = 0.15;

export interface BetMath {
  /** Market fair chance for each leg, by key. Null when it can't be priced. */
  fair: Record<string, number | null>;
  hitProb: number | null;
  ev: number | null;
  sameGame: boolean;
  suspect: boolean;
}

export const upcomingLegs = (bet: Bet, now = Date.now()): BetLeg[] =>
  bet.legs.filter((l) => l.result === "pending" && Date.parse(l.commence) > now);

/** Compares the odds taken with the market's fair chance for every leg. */
export function betMath(bet: Bet, fairByKey: Map<string, number>): BetMath {
  const fair = Object.fromEntries(bet.legs.map((l) => [l.key, fairByKey.get(l.key) ?? null]));
  const sameGame = new Set(bet.legs.map((l) => l.eventId)).size < bet.legs.length;
  const known = bet.legs.every((l) => fair[l.key] !== null);
  // Outcomes in one game affect each other, so multiplying them would be wrong.
  const hitProb = known && !sameGame ? bet.legs.reduce((a, l) => a * fair[l.key]!, 1) : null;
  const ev = hitProb === null ? null : hitProb * bet.odds - 1;
  const suspect = bet.legs.some((l) => fair[l.key] !== null && fair[l.key]! * l.price - 1 > SUSPECT_EDGE);
  return { fair, hitProb, ev, sameGame, suspect };
}

const LABELS: [number, BetCheck["label"]][] = [[8, "Strong"], [6, "Fair"], [4, "Weak"], [1, "Poor"]];

export function ratingLabel(rating: number): BetCheck["label"] {
  return LABELS.find(([floor]) => rating >= floor)![1];
}

/**
 * Keeps the rating honest about the numbers: however good the story sounds, a bet priced
 * below its fair chance can't rate above 5, and a price that looks wrong can't rate above 4.
 */
export function finalRating(aiRating: number, math: BetMath): { rating: number; note?: string } {
  const start = Number.isFinite(aiRating) ? Math.round(Math.min(10, Math.max(1, aiRating))) : 5;
  if (math.suspect && start > 4) {
    return {
      rating: 4,
      note: "These odds are far above the market's price. Check that the bet and odds were entered correctly, because this usually means a different bet rather than real value.",
    };
  }
  if (math.ev !== null && math.ev < 0 && start > 5) {
    return { rating: 5, note: "Capped at 5, because the odds taken are below the market's fair price." };
  }
  return { rating: start };
}
