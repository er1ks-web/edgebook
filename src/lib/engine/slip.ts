import type { Strategy } from "../strategy";
import type { Pick, PickOffer } from "../types";
import { expectedValue, stakeFor } from "./odds";
import { isExchange } from "./picks";

export const MAX_SLIP_LEGS = 6;
const GOOD_EDGE = 0.02;
const LONG_SHOT_CHANCE = 0.05;

export type SlipVerdict = "incomplete" | "good" | "thin" | "poor" | "started" | "same-game" | "no-book";

export interface SlipLeg {
  pick: Pick;
  price: number;
  prob: number;
  ev: number;
}

export interface SlipBook {
  book: string;
  bookTitle: string;
  odds: number;
  hitProb: number;
  ev: number;
  legs: SlipLeg[];
}

export interface SlipAssessment {
  verdict: SlipVerdict;
  headline: string;
  reasons: string[];
  books: SlipBook[];
  /** The book being priced. Null when no single book offers every leg. */
  chosen: SlipBook | null;
  stake: number;
  payout: number;
}

/** Where a leg can be placed as part of a parlay. Exchanges don't sell parlays. */
function legOffers(pick: Pick): PickOffer[] {
  if (pick.offers?.length) return pick.offers;
  if (isExchange(pick.book)) return [];
  return [{ book: pick.book, bookTitle: pick.bookTitle, price: pick.price, marketProb: pick.marketProb, prob: pick.prob }];
}

function pricedBooks(legs: Pick[]): SlipBook[] {
  const titles = new Map<string, string>();
  for (const l of legs) for (const o of legOffers(l)) titles.set(o.book, o.bookTitle);

  const books: SlipBook[] = [];
  for (const [book, bookTitle] of titles) {
    const atBook = legs.map((pick) => {
      const offer = legOffers(pick).find((o) => o.book === book);
      return offer ? { pick, price: offer.price, prob: offer.prob, ev: expectedValue(offer.prob, offer.price) } : null;
    });
    if (atBook.some((l) => l === null)) continue;
    const slipLegs = atBook as SlipLeg[];
    const odds = slipLegs.reduce((a, l) => a * l.price, 1);
    const hitProb = slipLegs.reduce((a, l) => a * l.prob, 1);
    books.push({ book, bookTitle, odds, hitProb, ev: expectedValue(hitProb, odds), legs: slipLegs });
  }
  return books.sort((a, b) => b.ev - a.ev);
}

const percent = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

function oneIn(prob: number) {
  const n = 1 / prob;
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

/** Prices a custom parlay at each book offering every leg, and says if it's worth betting. */
export function assessSlip(legs: Pick[], s: Strategy, preferredBook?: string, now = Date.now()): SlipAssessment {
  const empty = { books: [] as SlipBook[], chosen: null, stake: 0, payout: 0 };
  if (legs.length < 2) {
    return { ...empty, verdict: "incomplete", headline: "Add at least 2 picks", reasons: [] };
  }

  const books = pricedBooks(legs);
  const chosen = books.find((b) => b.book === preferredBook) ?? books[0] ?? null;
  const base = { books, chosen };

  const started = legs.filter((l) => Date.parse(l.commence) <= now);
  if (started.length) {
    return {
      ...base,
      verdict: "started",
      headline: "Includes a game that has started",
      reasons: [`${started.map((l) => l.label).join(", ")} can't be judged at these prices. Remove it.`],
      stake: 0,
      payout: 0,
    };
  }

  const games = new Set(legs.map((l) => l.eventId));
  if (games.size < legs.length) {
    return {
      ...base,
      verdict: "same-game",
      headline: "Two legs are from the same game",
      reasons: [
        "Outcomes in one game affect each other, so multiplying their chances gives a wrong answer, and books usually price these differently. Edgebook can't judge this parlay. Use legs from different games.",
      ],
      stake: 0,
      payout: 0,
    };
  }

  if (!chosen) {
    return {
      ...base,
      verdict: "no-book",
      headline: "No single book offers every leg",
      reasons: [
        "A parlay has to be placed at one bookmaker, and none of your books has a price for all of these legs. Exchanges such as Betfair and Matchbook don't count, because they don't sell parlays. Remove a leg, or allow more books in Strategy.",
      ],
      stake: 0,
      payout: 0,
    };
  }

  const reasons: string[] = [];
  const weak = chosen.legs.filter((l) => l.ev < 0);
  reasons.push(`It should hit about ${(chosen.hitProb * 100).toFixed(1)}% of the time, or roughly 1 in ${oneIn(chosen.hitProb)}.`);

  for (const leg of weak) {
    const rest = chosen.legs.filter((l) => l !== leg);
    const without = expectedValue(rest.reduce((a, l) => a * l.prob, 1), rest.reduce((a, l) => a * l.price, 1));
    reasons.push(
      rest.length >= 2
        ? `${leg.pick.label} has a ${percent(leg.ev)} edge at ${chosen.bookTitle}, which drags the parlay down. Without it the edge would be ${percent(without)}.`
        : `${leg.pick.label} has a ${percent(leg.ev)} edge at ${chosen.bookTitle}, which drags the parlay down.`,
    );
  }
  if (chosen.hitProb < LONG_SHOT_CHANCE) reasons.push("That's a long shot, so expect many losses between wins.");
  if (legs.length >= 5) reasons.push("Every extra leg adds more risk and another chance for one bad price to hurt the ticket.");
  if (books[0] && chosen.book !== books[0].book) {
    reasons.push(`${books[0].bookTitle} is better for this parlay, at ${books[0].odds.toFixed(2)} and a ${percent(books[0].ev)} edge.`);
  }
  if (books.length > 1) reasons.push(`Prices compared across ${books.length} books that offer every leg.`);

  const stake = chosen.ev > 0 ? stakeFor(chosen.hitProb, chosen.odds, s.bankroll, s.parlay.kellyFraction, s.parlay.maxStakePct) : 0;
  const payout = Math.round(stake * chosen.odds * 100) / 100;

  if (chosen.ev < 0) {
    return { ...base, verdict: "poor", headline: `Poor value: ${percent(chosen.ev)} edge`, reasons, stake, payout };
  }
  if (chosen.ev >= GOOD_EDGE && weak.length === 0) {
    return { ...base, verdict: "good", headline: `Good value: ${percent(chosen.ev)} edge`, reasons, stake, payout };
  }
  return { ...base, verdict: "thin", headline: `Thin value: ${percent(chosen.ev)} edge`, reasons, stake, payout };
}

/** The legs as they'd be logged, at the chosen book's own prices. */
export function legsAtBook(book: SlipBook): Pick[] {
  return book.legs.map((l) => ({
    ...l.pick,
    book: book.book,
    bookTitle: book.bookTitle,
    price: l.price,
    prob: l.prob,
    ev: l.ev,
    offers: undefined,
  }));
}
