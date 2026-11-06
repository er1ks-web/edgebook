import { describe, expect, it } from "vitest";
import { PRESETS, StrategySchema, type Strategy } from "../strategy";
import type { RawEvent } from "../types";
import { buildBestParlays, buildBestPicks, flatStake, type GamePrediction, priceTag, selectGames } from "./aiPicks";
import { evaluate } from "./picks";

const NOW = Date.parse("2026-11-06T10:00:00Z");

const strategy = (over: Partial<Strategy> = {}, ai: Partial<Strategy["ai"]> = {}): Strategy => ({
  ...PRESETS[0],
  markets: ["h2h"],
  fairSource: "consensus",
  minOdds: 1.2,
  maxOdds: 6,
  maxPicksPerEvent: 1,
  bankroll: 100,
  maxStakePct: 5,
  maxEvPct: 40,
  ...over,
  parlay: { ...PRESETS[0].parlay, minLegs: 2, maxLegs: 3, minCombinedOdds: 1.5, maxCombinedOdds: 50, minHitProbPct: 1, maxStakePct: 0.5, ...over.parlay },
  ai: { ...PRESETS[0].ai, pickStyle: "best", flatStakePct: 2, picksCount: 5, ...ai },
});

/** A game with home, draw and away prices at two books. */
const game = (id: string, prices: [number, number, number], hours = 5): RawEvent => ({
  id,
  sport_key: "soccer_x",
  sport_title: "League",
  commence_time: new Date(NOW + hours * 3_600_000).toISOString(),
  home_team: `${id}H`,
  away_team: `${id}A`,
  bookmakers: ["one", "two"].map((key, i) => ({
    key,
    title: key.toUpperCase(),
    markets: [{
      key: "h2h",
      last_update: new Date(NOW - 60_000).toISOString(),
      outcomes: [
        { name: `${id}H`, price: prices[0] + i * 0.02 },
        { name: "Draw", price: prices[1] },
        { name: `${id}A`, price: prices[2] + i * 0.02 },
      ],
    }],
  })),
} as unknown as RawEvent);

const games = [game("a", [1.5, 4.2, 6]), game("b", [2.1, 3.3, 3.4], 6), game("c", [4.6, 3.8, 1.75], 7)];

const predict = (gameId: string, side: string, chance: number, conviction = 6, confidence: GamePrediction["confidence"] = "medium"): GamePrediction => {
  const pickId = side === "none" ? "none" : `${gameId}|h2h|${gameId}${side}|`;
  return { gameId, pickId, confidence, conviction, summary: `why ${gameId}`, risks: [], sources: [], chances: { [pickId]: chance } };
};

const run = (s: Strategy, predictions: GamePrediction[], events = games) =>
  buildBestPicks(selectGames(evaluate(events, s, NOW), s, NOW), predictions, s);

describe("best picks", () => {
  it("recommends a pick with no price edge, unlike value mode", () => {
    const { bets } = run(strategy(), [predict("a", "H", 0.6)]);
    expect(bets).toHaveLength(1);
    expect(bets[0].selection).toBe("aH");
  });

  it("can back an underdog", () => {
    const { bets } = run(strategy(), [predict("c", "H", 0.3, 7)]);
    expect(bets[0].selection).toBe("cH");
    expect(bets[0].price).toBeGreaterThan(4);
  });

  it("ranks by the strength of the case, then by chance", () => {
    const { bets } = run(strategy(), [predict("a", "H", 0.7, 5), predict("b", "H", 0.45, 8), predict("c", "A", 0.6, 5)]);
    expect(bets.map((b) => b.eventId)).toEqual(["b", "a", "c"]);
  });

  it("uses a flat stake, and never more than the largest stake", () => {
    expect(run(strategy(), [predict("a", "H", 0.6)]).bets[0].stake).toBe(2);
    expect(run(strategy({ maxStakePct: 1 }), [predict("a", "H", 0.6)]).bets[0].stake).toBe(1);
    expect(flatStake(55, 2)).toBe(1.1);
  });

  it("takes the best price at a book you can use", () => {
    expect(run(strategy(), [predict("a", "H", 0.6)]).bets[0].book).toBe("two");
    const { bets } = run(strategy({ betBooks: ["one"] }), [predict("a", "H", 0.6)]);
    expect(bets[0].book).toBe("one");
    expect(bets[0].offers?.map((o) => o.book)).toEqual(["one"]);
  });

  it("says why a game has no pick", () => {
    const { passes } = run(strategy(), [predict("a", "none", 0), predict("b", "H", 0)]);
    expect(passes.find((p) => p.eventId === "a")?.reason).toBe("why a");
    expect(passes.find((p) => p.eventId === "b")?.reason).toContain("no usable probability");
    expect(passes.find((p) => p.eventId === "c")?.reason).toBe("Not covered by the research.");
  });

  it("respects your odds limits, and says so", () => {
    const { bets, passes } = run(strategy({ maxOdds: 3 }), [predict("c", "H", 0.3)]);
    expect(bets).toEqual([]);
    expect(passes.find((p) => p.eventId === "c")?.reason).toContain("outside your limits");
  });

  it("keeps to your limit of picks, and lists the rest", () => {
    const { bets, passes } = run(strategy({}, { picksCount: 1 }), [predict("a", "H", 0.6, 9), predict("b", "H", 0.5, 5)]);
    expect(bets).toHaveLength(1);
    expect(passes.find((p) => p.eventId === "b")?.reason).toContain("stronger picks");
  });

  it("defaults saved strategies to best picks", () => {
    const { pickStyle: _a, flatStakePct: _b, ...ai } = PRESETS[0].ai;
    const parsed = StrategySchema.parse({ ...PRESETS[0], ai });
    expect(parsed.ai.pickStyle).toBe("best");
    expect(parsed.ai.flatStakePct).toBe(2);
  });

  it("still shows every game in value style only when the price fits", () => {
    const value = strategy({ maxOdds: 1.3, minOdds: 1.2 }, { pickStyle: "value" });
    expect(selectGames(evaluate(games, value, NOW), value, NOW)).toEqual([]);
  });
});

describe("price tag", () => {
  it("compares the price with the market", () => {
    expect(priceTag(0.5, 2.1)).toBe("good");
    expect(priceTag(0.5, 1.95)).toBe("fair");
    expect(priceTag(0.5, 1.7)).toBe("short");
  });
});

describe("best parlays", () => {
  const strong = [predict("a", "H", 0.65), predict("b", "H", 0.5), predict("c", "A", 0.55)];

  it("builds from the fewest legs up, most likely legs first", () => {
    const { parlays } = run(strategy(), strong);
    expect(parlays.map((p) => p.legs.length)).toEqual([2, 3]);
    expect(parlays[0].legs.map((l) => l.eventId).sort()).toEqual(["a", "c"]);
  });

  it("prices every leg at one book, choosing the best total", () => {
    const [parlay] = run(strategy(), strong).parlays;
    expect(parlay.book).toBe("two");
    expect(parlay.legs.every((l) => l.book === "two")).toBe(true);
    expect(parlay.odds).toBeCloseTo(parlay.legs.reduce((a, l) => a * l.price, 1));
    expect(parlay.hitProb).toBeCloseTo(parlay.legs.reduce((a, l) => a * l.prob, 1));
  });

  it("uses the parlay stake and works out the payout", () => {
    const [parlay] = run(strategy(), strong).parlays;
    expect(parlay.stake).toBe(0.5);
    expect(parlay.payout).toBeCloseTo(0.5 * parlay.odds, 2);
  });

  it("leaves out weak picks", () => {
    const { parlays } = run(strategy(), [predict("a", "H", 0.65, 4), predict("b", "H", 0.5, 4), predict("c", "A", 0.55, 4)]);
    expect(parlays).toEqual([]);
  });

  it("respects your parlay settings", () => {
    expect(run(strategy({ parlay: { ...PRESETS[0].parlay, enabled: false } }), strong).parlays).toEqual([]);
    const narrow = strategy({ parlay: { ...PRESETS[0].parlay, maxCombinedOdds: 1.6 } });
    expect(run(narrow, strong).parlays).toEqual([]);
  });

  it("skips a parlay no single book can take", () => {
    const { bets } = run(strategy(), strong);
    const split = bets.map((b, i) => ({ ...b, offers: b.offers?.filter((o) => o.book === (i ? "two" : "one")) }));
    expect(buildBestParlays(split, strategy())).toEqual([]);
  });
});
