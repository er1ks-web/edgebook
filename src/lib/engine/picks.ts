import type { Strategy } from "../strategy";
import type { AiItem, LeagueCoverage, MarketKey, Pick, RawEvent, RawOutcome } from "../types";
import { devig, expectedValue, stakeFor } from "./odds";

export const SHARP_BOOKS = new Set([
  "pinnacle",
  "betfair_ex_eu",
  "betfair_ex_uk",
  "betfair_ex_au",
  "matchbook",
  "smarkets",
  "demo_sharp",
]);
const SHARP_WEIGHT = 3;

/** Exchanges charge commission on winnings, which the listed price doesn't include. */
export const isExchange = (book: string) =>
  book.startsWith("betfair_ex_") || book === "matchbook" || book === "smarkets";

export const netOfCommission = (price: number, commissionPct: number) =>
  1 + (price - 1) * (1 - commissionPct / 100);

/** One price offered for a selection, valued against the other books. */
export interface Offer {
  key: string;
  book: string;
  bookTitle: string;
  price: number;
  marketProb: number;
  referenceBooks: number;
}

export interface Selection {
  key: string;
  event: RawEvent;
  market: MarketKey;
  name: string;
  point?: number;
  label: string;
  /** Market fair probability from every reference book, used for closing line value. */
  fairProb: number | null;
  offers: Offer[];
}

export const selectionKey = (eventId: string, market: string, name: string, point?: number) =>
  `${eventId}|${market}|${name}|${point ?? ""}`;

export function labelFor(market: MarketKey, name: string, point?: number) {
  if (market === "h2h") return name === "Draw" ? "Draw" : `${name} to win`;
  if (market === "totals") return `${name} ${point}`;
  return `${name} ${point! > 0 ? "+" : ""}${point}`;
}

const isQuarterLine = (point?: number) =>
  point !== undefined && Math.abs(point * 2 - Math.round(point * 2)) > 1e-9;

type BookLine = { title: string; outcomes: RawOutcome[] };

/**
 * Finds books pricing a game on regulation time only, in sports where the real result
 * includes overtime. They offer a draw when others don't. Their match-winner, totals
 * and spread bets are different bets from everyone else's, so comparing them creates
 * fake edges, and final scores can't settle them.
 */
export function regulationTimeBooks(event: RawEvent): Set<string> {
  if (event.sport_key.startsWith("soccer_")) return new Set();
  const h2hSize = (b: RawEvent["bookmakers"][number]) => b.markets.find((m) => m.key === "h2h")?.outcomes.length;
  const threeWay = event.bookmakers.filter((b) => h2hSize(b) === 3);
  const anyTwoWay = event.bookmakers.some((b) => h2hSize(b) === 2);
  if (!anyTwoWay && !event.sport_key.startsWith("icehockey_")) return new Set();
  return new Set(threeWay.map((b) => b.key));
}

/** Groups each book's outcomes into comparable lines, such as totals at 2.5. */
function linesForEvent(event: RawEvent, s: Strategy, now: number) {
  const lines = new Map<string, Map<string, BookLine>>();
  const regulation = regulationTimeBooks(event);
  for (const book of event.bookmakers) {
    if (regulation.has(book.key)) continue;
    for (const market of book.markets) {
      if (!s.markets.includes(market.key as MarketKey)) continue;
      const updated = market.last_update ?? book.last_update;
      if (updated && now - Date.parse(updated) > s.maxStalenessMin * 60_000) continue;

      const add = (lineKey: string, outcomes: RawOutcome[]) => {
        if (outcomes.some((o) => isQuarterLine(o.point))) return; // these settle as half wins
        const line = lines.get(lineKey) ?? new Map<string, BookLine>();
        line.set(book.key, { title: book.title, outcomes });
        lines.set(lineKey, line);
      };

      if (market.key === "h2h") {
        add("h2h", market.outcomes);
        continue;
      }
      // A book can post several lines per market, so split them by point.
      const byLine = new Map<string, RawOutcome[]>();
      for (const o of market.outcomes) {
        if (o.point === undefined) continue;
        // Spreads pair at opposite signs, so key them on the home team's handicap.
        const linePoint =
          market.key === "totals" ? o.point : o.name === event.home_team ? o.point : -o.point;
        const k = `${market.key}:${linePoint}`;
        byLine.set(k, [...(byLine.get(k) ?? []), o]);
      }
      for (const [k, outcomes] of byLine) add(k, outcomes);
    }
  }
  return lines;
}

/** Values every price in the feed. Independent of the strategy's pick filters. */
export function evaluate(events: RawEvent[], s: Strategy, now = Date.now()): Selection[] {
  const selections: Selection[] = [];

  for (const event of events) {
    for (const [lineKey, books] of linesForEvent(event, s, now)) {
      const market = lineKey.split(":")[0] as MarketKey;
      const size = Math.max(...[...books.values()].map((b) => b.outcomes.length));
      if (size < 2) continue;

      // Margin-free probabilities per book, using only books quoting the full set.
      const quotes = [...books.entries()]
        .filter(([, b]) => b.outcomes.length === size && b.outcomes.every((o) => o.price > 1))
        .map(([key, b]) => {
          const probs = devig(b.outcomes.map((o) => o.price), s.devig);
          return {
            key,
            title: b.title,
            sharp: SHARP_BOOKS.has(key),
            outcomes: b.outcomes.map((o, i) => ({ ...o, prob: probs[i] })),
          };
        });
      if (!quotes.length) continue;

      const fairFor = (name: string, excludeBook?: string) => {
        const refs = quotes.filter(
          (q) => q.key !== excludeBook && (s.fairSource === "consensus" || q.sharp),
        );
        let sum = 0;
        let weight = 0;
        for (const q of refs) {
          const o = q.outcomes.find((x) => x.name === name);
          if (!o) continue;
          const w = q.sharp ? SHARP_WEIGHT : 1;
          sum += o.prob * w;
          weight += w;
        }
        return weight ? { prob: sum / weight, count: refs.length } : null;
      };

      for (const base of quotes[0].outcomes) {
        const sel: Selection = {
          key: selectionKey(event.id, market, base.name, base.point),
          event,
          market,
          name: base.name,
          point: base.point,
          label: labelFor(market, base.name, base.point),
          fairProb: fairFor(base.name)?.prob ?? null,
          offers: [],
        };
        for (const q of quotes) {
          const outcome = q.outcomes.find((o) => o.name === base.name);
          // Leave the book out of its own reference price, or it partly grades itself.
          const fair = fairFor(base.name, q.key);
          if (!outcome || !fair || fair.count < s.minReferenceBooks) continue;
          const exchange = isExchange(q.key);
          sel.offers.push({
            key: sel.key,
            book: q.key,
            bookTitle: exchange ? `${q.title} (after ${s.exchangeCommissionPct}% fee)` : q.title,
            price: exchange ? netOfCommission(outcome.price, s.exchangeCommissionPct) : outcome.price,
            marketProb: fair.prob,
            referenceBooks: fair.count,
          });
        }
        selections.push(sel);
      }
    }
  }
  return selections;
}

export function clampAdjustment(pts: number, s: Strategy) {
  return Math.max(-s.ai.maxAdjustmentPts, Math.min(s.ai.maxAdjustmentPts, pts));
}

export function toPick(sel: Selection, offer: Offer, s: Strategy, ai?: AiItem): Pick {
  const adjustment = ai ? clampAdjustment(ai.adjustmentPts, s) / 100 : 0;
  const adjusted = (marketProb: number) => Math.min(0.99, Math.max(0.01, marketProb + adjustment));
  const prob = adjusted(offer.marketProb);
  return {
    key: sel.key,
    eventId: sel.event.id,
    sportKey: sel.event.sport_key,
    sportTitle: sel.event.sport_title ?? sel.event.sport_key,
    commence: sel.event.commence_time,
    home: sel.event.home_team,
    away: sel.event.away_team,
    market: sel.market,
    selection: sel.name,
    point: sel.point,
    label: sel.label,
    book: offer.book,
    bookTitle: offer.bookTitle,
    price: offer.price,
    marketProb: offer.marketProb,
    prob,
    ev: expectedValue(prob, offer.price),
    stake: stakeFor(prob, offer.price, s.bankroll, s.kellyFraction, s.maxStakePct),
    referenceBooks: offer.referenceBooks,
    ai,
    offers: sel.offers
      .filter((o) => !isExchange(o.book) && canBetAt(o.book, s) && expectedValue(o.marketProb, o.price) * 100 <= s.maxEvPct)
      .map((o) => ({ book: o.book, bookTitle: o.bookTitle, price: o.price, marketProb: o.marketProb, prob: adjusted(o.marketProb) })),
  };
}

export function inWindow(commence: string, s: Strategy, now: number) {
  const hours = (Date.parse(commence) - now) / 3_600_000;
  return hours > 0 && hours >= s.minHoursAhead && hours <= s.maxHoursAhead;
}

export function canBetAt(book: string, s: Strategy) {
  return s.betBooks.length === 0 || s.betBooks.includes(book);
}

/** Says what happened to each league in a scan, including those with no picks. */
export function leagueCoverage(
  s: Strategy,
  events: RawEvent[],
  selections: Selection[],
  picks: Pick[],
  loadedSports: string[],
  now = Date.now(),
): LeagueCoverage[] {
  return s.sports.map((sportKey) => {
    const games = events.filter((e) => e.sport_key === sportKey);
    const evs = selections
      .filter((x) => x.event.sport_key === sportKey && inWindow(x.event.commence_time, s, now))
      .flatMap((x) => x.offers)
      .filter((o) => canBetAt(o.book, s) && o.price >= s.minOdds && o.price <= s.maxOdds)
      .map((o) => expectedValue(o.marketProb, o.price))
      .filter((ev) => ev * 100 <= s.maxEvPct);
    return {
      sportKey,
      title: games[0]?.sport_title ?? sportKey,
      loaded: loadedSports.includes(sportKey),
      games: games.length,
      gamesInWindow: games.filter((e) => inWindow(e.commence_time, s, now)).length,
      picks: picks.filter((p) => p.sportKey === sportKey).length,
      bestEv: evs.length ? Math.max(...evs) : null,
    };
  });
}

const RANKERS: Record<Strategy["rankBy"], (a: Pick, b: Pick) => number> = {
  ev: (a, b) => b.ev - a.ev,
  stake: (a, b) => b.stake - a.stake,
  probability: (a, b) => b.prob - a.prob,
};

export function findPicks(
  selections: Selection[],
  s: Strategy,
  ai: Record<string, AiItem> = {},
  now = Date.now(),
): { picks: Pick[]; rejected: Pick[] } {
  const best: Pick[] = [];
  const rejected: Pick[] = [];

  for (const sel of selections) {
    if (!inWindow(sel.event.commence_time, s, now)) continue;
    const review = ai[sel.key];
    const options = sel.offers
      // Very large "edges" are usually a stale price or a mismatched line, not value.
      .filter((o) => expectedValue(o.marketProb, o.price) * 100 <= s.maxEvPct)
      .filter((o) => canBetAt(o.book, s) && o.price >= s.minOdds && o.price <= s.maxOdds)
      .map((o) => toPick(sel, o, s, review))
      .sort((a, b) => b.ev - a.ev);
    const top = options[0];
    if (!top) continue;

    if (review?.verdict === "pass") {
      if (expectedValue(top.marketProb, top.price) * 100 >= s.minEvPct) rejected.push(top);
      continue;
    }
    if (top.ev * 100 >= s.minEvPct) best.push(top);
  }

  best.sort(RANKERS[s.rankBy]);
  const perEvent = new Map<string, number>();
  const picks = best.filter((p) => {
    const n = perEvent.get(p.eventId) ?? 0;
    if (n >= s.maxPicksPerEvent) return false;
    perEvent.set(p.eventId, n + 1);
    return true;
  });
  return { picks: picks.slice(0, s.maxPicks), rejected };
}
