import { describe, expect, it } from "vitest";
import { createManualBet, ManualBetSchema } from "../manualBet";
import { applyTweaks, isComplete, QUESTIONS, shorten, sportsFor, strategyFromAnswers, type Answers } from "../questionnaire";
import { PRESETS, StrategySchema, type Strategy } from "../strategy";
import type { Bet, BetLeg, Pick, RawEvent } from "../types";
import { assessSlip, legsAtBook } from "./slip";
import { blendedAdjustmentPts, buildAiBets, selectGames } from "./aiPicks";
import { devig, expectedValue, kelly, stakeFor } from "./odds";
import { buildParlays } from "./parlays";
import { evaluate, findPicks, leagueCoverage, regulationTimeBooks, selectionKey, toPick } from "./picks";
import { applyLegResults, closingValue, gradeLeg, ledgerStats } from "./settle";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const fresh = new Date(NOW - 60_000).toISOString();
const later = new Date(NOW + 24 * 3_600_000).toISOString();

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  ...PRESETS[0],
  markets: ["h2h", "spreads", "totals"],
  minOdds: 1.01,
  maxOdds: 100,
  ...over,
});

function event(id: string, sharp: [number, number], soft: [number, number], sport = "soccer_epl"): RawEvent {
  const h2h = (book: string, title: string, p: [number, number]) => ({
    key: book,
    title,
    last_update: fresh,
    markets: [{ key: "h2h", outcomes: [{ name: `${id} Home`, price: p[0] }, { name: `${id} Away`, price: p[1] }] }],
  });
  return {
    id,
    sport_key: sport,
    commence_time: later,
    home_team: `${id} Home`,
    away_team: `${id} Away`,
    bookmakers: [h2h("pinnacle", "Pinnacle", sharp), h2h("softbook", "Soft Book", soft)],
  };
}

describe("odds math", () => {
  it("removes margin so probabilities sum to 1", () => {
    for (const method of ["power", "multiplicative"] as const) {
      const fair = devig([1.5, 4.2, 6.5], method);
      expect(fair.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });

  it("returns 50/50 for a symmetric market", () => {
    expect(devig([1.91, 1.91], "power")[0]).toBeCloseTo(0.5, 6);
  });

  it("the power method charges longshots more margin", () => {
    const power = devig([1.25, 3.9], "power");
    const mult = devig([1.25, 3.9], "multiplicative");
    expect(power[1]).toBeLessThan(mult[1]);
  });

  it("computes EV and Kelly", () => {
    expect(expectedValue(0.5, 2.2)).toBeCloseTo(0.1);
    expect(kelly(0.5, 2.2)).toBeCloseTo(0.1 / 1.2);
    expect(kelly(0.4, 2)).toBe(0);
  });

  it("caps stakes at the maximum percentage", () => {
    expect(stakeFor(0.9, 2, 1000, 1, 2)).toBe(20);
    expect(stakeFor(0.51, 2, 1000, 0.25, 5)).toBe(5);
  });
});

describe("picks", () => {
  it("finds a soft price that beats the sharp line", () => {
    const sels = evaluate([event("a", [1.95, 1.95], [2.15, 1.72])], strategy(), NOW);
    const { picks } = findPicks(sels, strategy(), {}, NOW);
    expect(picks).toHaveLength(1);
    expect(picks[0].book).toBe("softbook");
    expect(picks[0].selection).toBe("a Home");
    expect(picks[0].marketProb).toBeCloseTo(0.5, 5);
    expect(picks[0].ev).toBeCloseTo(0.075, 3);
  });

  it("finds nothing when no book beats fair value", () => {
    const sels = evaluate([event("a", [1.95, 1.95], [1.9, 1.9])], strategy(), NOW);
    expect(findPicks(sels, strategy(), {}, NOW).picks).toHaveLength(0);
  });

  it("does not value a sharp book against itself", () => {
    const sels = evaluate([event("a", [2.5, 1.5], [1.9, 1.9])], strategy(), NOW);
    const home = sels.find((s) => s.name === "a Home")!;
    expect(home.offers.map((o) => o.book)).toEqual(["softbook"]);
  });

  it("drops stale prices", () => {
    const e = event("a", [1.95, 1.95], [2.15, 1.72]);
    e.bookmakers[1].last_update = new Date(NOW - 5 * 3_600_000).toISOString();
    const { picks } = findPicks(evaluate([e], strategy(), NOW), strategy(), {}, NOW);
    expect(picks).toHaveLength(0);
  });

  it("treats implausibly large edges as errors", () => {
    const sels = evaluate([event("a", [1.95, 1.95], [3.5, 1.2])], strategy(), NOW);
    expect(findPicks(sels, strategy(), {}, NOW).picks).toHaveLength(0);
  });

  it("only offers books the strategy can bet at", () => {
    const s = strategy({ betBooks: ["other"] });
    const sels = evaluate([event("a", [1.95, 1.95], [2.15, 1.72])], s, NOW);
    expect(findPicks(sels, s, {}, NOW).picks).toHaveLength(0);
  });

  it("pairs spread sides on the same handicap only", () => {
    const e: RawEvent = {
      id: "s",
      sport_key: "basketball_nba",
      commence_time: later,
      home_team: "H",
      away_team: "A",
      bookmakers: ["pinnacle", "softbook"].map((key) => ({
        key,
        title: key,
        last_update: fresh,
        markets: [{
          key: "spreads",
          outcomes: [
            { name: "H", price: 1.9, point: -3.5 },
            { name: "A", price: 1.9, point: 3.5 },
            { name: "H", price: 1.7, point: -2.5 },
            { name: "A", price: 2.1, point: 2.5 },
          ],
        }],
      })),
    };
    const sels = evaluate([e], strategy(), NOW);
    expect(sels).toHaveLength(4);
    expect(sels.find((x) => x.name === "H" && x.point === -3.5)!.fairProb).toBeCloseTo(0.5, 5);
    expect(sels.find((x) => x.name === "H" && x.point === -2.5)!.fairProb!).toBeGreaterThan(0.5);
  });

  it("skips quarter lines", () => {
    const e = event("q", [1.9, 1.9], [1.9, 1.9]);
    e.bookmakers.forEach((b) => {
      b.markets = [{ key: "totals", outcomes: [{ name: "Over", price: 1.9, point: 2.25 }, { name: "Under", price: 1.9, point: 2.25 }] }];
    });
    expect(evaluate([e], strategy(), NOW)).toHaveLength(0);
  });

  it("clamps AI adjustments and removes passed picks", () => {
    const s = strategy();
    const sels = evaluate([event("a", [1.95, 1.95], [2.15, 1.72])], s, NOW);
    const key = selectionKey("a", "h2h", "a Home");
    const base = { key, confidence: "high" as const, summary: "", risks: [], sources: [] };

    const boosted = findPicks(sels, s, { [key]: { ...base, verdict: "back", adjustmentPts: 50 } }, NOW);
    expect(boosted.picks[0].prob).toBeCloseTo(0.53, 5);

    const passed = findPicks(sels, s, { [key]: { ...base, verdict: "pass", adjustmentPts: 0 } }, NOW);
    expect(passed.picks).toHaveLength(0);
    expect(passed.rejected).toHaveLength(1);

    const cut = findPicks(sels, s, { [key]: { ...base, verdict: "lean", adjustmentPts: -1 } }, NOW);
    expect(cut.picks[0].ev).toBeCloseTo(0.49 * 2.15 - 1, 3);

    // A cut that takes the pick below the EV floor removes it.
    const belowFloor = findPicks(sels, s, { [key]: { ...base, verdict: "lean", adjustmentPts: -3 } }, NOW);
    expect(belowFloor.picks).toHaveLength(0);
  });
});

describe("parlays", () => {
  const events = [
    event("a", [1.95, 1.95], [2.1, 1.75]),
    event("b", [1.95, 1.95], [2.08, 1.76]),
    event("c", [1.95, 1.95], [2.06, 1.77]),
    event("d", [1.95, 1.95], [2.05, 1.78], "basketball_nba"),
  ];
  const s = strategy({ parlay: { ...PRESETS[0].parlay, minCombinedOdds: 3, maxCombinedOdds: 12, minHitProbPct: 5 } });

  it("multiplies prices and probabilities across legs", () => {
    const parlays = buildParlays(evaluate(events, s, NOW), s, {}, NOW);
    expect(parlays.length).toBeGreaterThan(0);
    const p = parlays[0];
    expect(p.odds).toBeCloseTo(p.legs.reduce((a, l) => a * l.price, 1), 6);
    expect(p.hitProb).toBeCloseTo(p.legs.reduce((a, l) => a * l.prob, 1), 6);
    expect(p.ev).toBeCloseTo(p.hitProb * p.odds - 1, 6);
  });

  it("never mixes books or repeats an event", () => {
    for (const p of buildParlays(evaluate(events, s, NOW), s, {}, NOW)) {
      expect(new Set(p.legs.map((l) => l.book)).size).toBe(1);
      expect(new Set(p.legs.map((l) => l.eventId)).size).toBe(p.legs.length);
    }
  });

  it("respects leg counts, odds range, and the per-sport limit", () => {
    const limited = { ...s, parlay: { ...s.parlay, minLegs: 3, maxLegs: 3, maxPerSport: 2, minCombinedOdds: 1.1, maxCombinedOdds: 50, minHitProbPct: 1 } };
    const parlays = buildParlays(evaluate(events, limited, NOW), limited, {}, NOW);
    expect(parlays.length).toBeGreaterThan(0);
    for (const p of parlays) {
      expect(p.legs).toHaveLength(3);
      expect(p.legs.filter((l) => l.sportKey === "soccer_epl").length).toBeLessThanOrEqual(2);
    }
  });

  it("leaves out legs the AI passed on", () => {
    const passed = selectionKey("a", "h2h", "a Home");
    const ai = { [passed]: { key: passed, verdict: "pass" as const, adjustmentPts: 0, confidence: "high" as const, summary: "", risks: [], sources: [] } };
    for (const p of buildParlays(evaluate(events, s, NOW), s, ai, NOW)) {
      expect(p.legs.some((l) => l.key === passed)).toBe(false);
    }
  });

  it("returns nothing when disabled", () => {
    const off = { ...s, parlay: { ...s.parlay, enabled: false } };
    expect(buildParlays(evaluate(events, off, NOW), off, {}, NOW)).toEqual([]);
  });
});

describe("bets added by hand", () => {
  const leg = {
    gameId: "game1", sportKey: "soccer_epl", sportTitle: "EPL", commence: "2026-11-05T17:45:00Z",
    home: "Home FC", away: "Away FC", market: "h2h" as const, selection: "Home FC", price: 2.1,
  };
  const input = { strategyId: "s", book: "Unibet (NL)", stake: 5, odds: 2.1, placedAt: "2026-11-05T17:00:00Z", legs: [leg] };
  const parse = (over: object) => ManualBetSchema.safeParse({ ...input, ...over });
  const build = (over: object = {}) => createManualBet(ManualBetSchema.parse({ ...input, ...over }), "My strategy", false);

  it("accepts a started game and keeps the odds you got", () => {
    const bet = build();
    expect(bet).toMatchObject({ kind: "single", odds: 2.1, stake: 5, bookTitle: "Unibet (NL)", status: "pending", manual: true, evAtPlacement: 0, strategyName: "My strategy" });
    expect(bet.legs[0]).toMatchObject({ eventId: "game1", label: "Home FC to win", handSettle: false, result: "pending" });
    expect(bet.placedAt).toBe("2026-11-05T17:00:00.000Z");
  });

  it("uses edited total odds for a single leg", () => {
    expect(build({ odds: 2.25 }).legs[0].price).toBe(2.25);
  });

  it("builds parlays and settles them normally", () => {
    const second = { ...leg, gameId: "game2", market: "totals" as const, selection: "Over", point: 2.5, price: 1.9 };
    const bet = build({ legs: [leg, second], odds: 3.99 });
    expect(bet.kind).toBe("parlay");
    expect(bet.legs[1].label).toBe("Over 2.5");
    const settled = applyLegResults({ ...bet, legs: bet.legs.map((l) => ({ ...l, result: "won" as const })) });
    expect(settled.status).toBe("won");
    expect(settled.returned).toBeCloseTo(19.95, 2);
  });

  it("marks typed games and hockey for settling by hand", () => {
    const { gameId: _unused, ...typed } = leg;
    const hand = build({ legs: [typed] }).legs[0];
    expect(hand.handSettle).toBe(true);
    expect(hand.eventId).toMatch(/^manual-/);
    expect(build({ legs: [{ ...leg, sportKey: "icehockey_nhl" }] }).legs[0].handSettle).toBe(true);
  });

  it("gives every typed game its own id", () => {
    const { gameId: _unused, ...typed } = leg;
    const bet = build({ legs: [typed, { ...typed, home: "Other", away: "Team", selection: "Other" }], odds: 4 });
    expect(bet.legs[0].eventId).not.toBe(bet.legs[1].eventId);
  });

  it("rejects bets it couldn't settle or count", () => {
    expect(parse({ stake: 0 }).success).toBe(false);
    expect(parse({ odds: 1 }).success).toBe(false);
    expect(parse({ book: " " }).success).toBe(false);
    expect(parse({ legs: [] }).success).toBe(false);
    expect(parse({ placedAt: "nope" }).success).toBe(false);
    expect(parse({ legs: [{ ...leg, selection: "Someone else" }] }).success).toBe(false);
    expect(parse({ legs: [{ ...leg, market: "totals", selection: "Over" }] }).success).toBe(false);
    expect(parse({ legs: [{ ...leg, market: "totals", selection: "Home FC", point: 2.5 }] }).success).toBe(false);
    expect(parse({ legs: [{ ...leg, home: "" }] }).success).toBe(false);
  });

  it("doesn't count toward expected profit", () => {
    const won = applyLegResults({ ...build(), legs: [{ ...build().legs[0], result: "won" }] });
    expect(ledgerStats([won])).toMatchObject({ expected: 0, settled: 1, avgClv: null });
  });
});

describe("regulation-time books", () => {
  // Real prices for Montréal Canadiens vs Utah Mammoth, 2026-11-05.
  const line = (key: string, over: number, under: number, draw: boolean) => ({
    key,
    title: key,
    last_update: fresh,
    markets: [
      { key: "h2h", outcomes: [{ name: "H", price: 2 }, { name: "A", price: 2 }, ...(draw ? [{ name: "Draw", price: 4 }] : [])] },
      { key: "totals", outcomes: [{ name: "Over", price: over, point: 6.5 }, { name: "Under", price: under, point: 6.5 }] },
    ],
  });
  const hockey: RawEvent = {
    id: "m",
    sport_key: "icehockey_nhl",
    commence_time: later,
    home_team: "H",
    away_team: "A",
    bookmakers: [
      line("pinnacle", 1.83, 2.07, false),
      line("williamhill", 1.91, 1.91, false),
      line("sport888", 1.91, 1.91, false),
      line("unibet_nl", 2.2, 1.67, true),
      line("onexbet", 2.1, 1.8, true),
      line("coolbet", 2.12, 1.73, true),
    ],
  };
  const s = strategy({ markets: ["h2h", "totals"], fairSource: "consensus", minReferenceBooks: 2 });

  it("identifies books offering a draw in an overtime sport", () => {
    expect([...regulationTimeBooks(hockey)].sort()).toEqual(["coolbet", "onexbet", "unibet_nl"]);
  });

  it("removes the false edge on real hockey prices", () => {
    const sels = evaluate([hockey], s, NOW);
    const over = sels.find((x) => x.name === "Over")!;
    expect(over.offers.map((o) => o.book).sort()).toEqual(["pinnacle", "sport888", "williamhill"]);
    const best = Math.max(...over.offers.map((o) => expectedValue(o.marketProb, o.price)));
    expect(best).toBeLessThan(0.05);
  });

  it("would have shown a large fake edge without this", () => {
    expect(expectedValue(0.5, 2.2)).toBeCloseTo(0.1, 5);
  });

  it("settles hockey on two-way prices, not on a draw", () => {
    const sels = evaluate([hockey], s, NOW);
    expect(sels.some((x) => x.name === "Draw")).toBe(false);
  });

  it("drops three-way hockey books even with no two-way book to compare", () => {
    const only: RawEvent = { ...hockey, bookmakers: [line("onexbet", 2.1, 1.8, true), line("coolbet", 2.12, 1.73, true)] };
    expect(evaluate([only], s, NOW)).toHaveLength(0);
  });

  it("leaves soccer alone, where a draw is a normal result", () => {
    const soccer: RawEvent = { ...hockey, sport_key: "soccer_epl" };
    expect(regulationTimeBooks(soccer).size).toBe(0);
    expect(evaluate([soccer], s, NOW).some((x) => x.name === "Draw")).toBe(true);
  });

  it("leaves other sports alone when every book offers a draw", () => {
    const rugby: RawEvent = { ...hockey, sport_key: "rugbyleague_nrl", bookmakers: [line("onexbet", 2, 2, true), line("coolbet", 2, 2, true)] };
    expect(regulationTimeBooks(rugby).size).toBe(0);
  });

  it("applies to other sports when books disagree about a draw", () => {
    const hoops: RawEvent = { ...hockey, sport_key: "basketball_euroleague", bookmakers: [line("pinnacle", 1.9, 1.9, false), line("onexbet", 2.2, 1.7, true)] };
    expect([...regulationTimeBooks(hoops)]).toEqual(["onexbet"]);
  });
});

describe("custom parlay slip", () => {
  const s = strategy({ markets: ["h2h"], bankroll: 1000 });
  const soft = (id: string, price: number, other = "softbook", otherPrice = price): RawEvent => {
    const e = event(id, [1.95, 1.95], [price, 1.7]);
    e.bookmakers.push({
      key: other,
      title: other === "softbook" ? "Soft Book" : "Second Book",
      last_update: fresh,
      markets: [{ key: "h2h", outcomes: [{ name: `${id} Home`, price: otherPrice }, { name: `${id} Away`, price: 1.7 }] }],
    });
    return e;
  };
  const legOf = (e: RawEvent, st = s, ai = {}) => {
    const sels = evaluate([e], st, NOW);
    const sel = sels.find((x) => x.name === e.home_team)!;
    return toPick(sel, sel.offers.sort((a, b) => b.price - a.price)[0], st, (ai as Record<string, never>)[sel.key]);
  };
  const assess = (legs: Pick[], book?: string) => assessSlip(legs, s, book, NOW);

  it("asks for at least two legs", () => {
    expect(assess([]).verdict).toBe("incomplete");
    expect(assess([legOf(soft("a", 2.1))]).verdict).toBe("incomplete");
  });

  it("multiplies odds and chances at one book, and calls real value good", () => {
    const r = assess([legOf(soft("a", 2.1)), legOf(soft("b", 2.1))]);
    expect(r.verdict).toBe("good");
    expect(r.chosen!.book).toBe("softbook");
    expect(r.chosen!.odds).toBeCloseTo(4.41, 6);
    expect(r.chosen!.hitProb).toBeCloseTo(0.25, 5);
    expect(r.chosen!.ev).toBeCloseTo(0.1025, 3);
    expect(r.stake).toBeGreaterThan(0);
    expect(r.payout).toBeCloseTo(r.stake * 4.41, 1);
  });

  it("uses one book's real prices, not each leg's best price", () => {
    const a = legOf(soft("a", 2.3, "second", 2.0));
    const b = legOf(soft("b", 2.0, "second", 2.2));
    const r = assess([a, b]);
    expect(a.book).toBe("softbook");
    expect(b.book).toBe("second");
    expect(r.chosen!.odds).toBeCloseTo(4.6, 6);
    expect(r.chosen!.odds).toBeLessThan(a.price * b.price);
    expect(r.books.map((x) => x.book).sort()).toEqual(["second", "softbook"]);
  });

  it("lets you price it at a chosen book and points to a better one", () => {
    const legs = [legOf(soft("a", 2.3, "second", 2.0)), legOf(soft("b", 2.0, "second", 2.2))];
    const best = assess(legs).chosen!.book;
    const other = best === "softbook" ? "second" : "softbook";
    const r = assess(legs, other);
    expect(r.chosen!.book).toBe(other);
    expect(r.reasons.join(" ")).toContain("is better for this parlay");
  });

  it("calls a negative edge poor, with no stake", () => {
    const r = assess([legOf(soft("a", 1.8)), legOf(soft("b", 1.8))]);
    expect(r.verdict).toBe("poor");
    expect(r.stake).toBe(0);
  });

  it("flags a weak leg, and how much removing it helps", () => {
    const r = assess([legOf(soft("a", 2.2)), legOf(soft("b", 2.2)), legOf(soft("c", 1.85))]);
    expect(r.verdict).toBe("thin");
    const note = r.reasons.find((x) => x.includes("c Home"))!;
    expect(note).toContain("Without it the edge would be +21.0%");
  });

  it("won't price two legs from the same game", () => {
    const e = soft("a", 2.1);
    const sels = evaluate([e], s, NOW);
    const legs = sels.map((x) => toPick(x, x.offers[0], s));
    const r = assess(legs);
    expect(r.verdict).toBe("same-game");
    expect(r.stake).toBe(0);
  });

  it("says so when no single book offers every leg", () => {
    const a = legOf(soft("a", 2.1));
    const b = legOf(soft("b", 2.1));
    a.offers = a.offers!.filter((o) => o.book === "softbook");
    b.offers = b.offers!.filter((o) => o.book === "other");
    b.offers.push({ book: "other", bookTitle: "Other", price: 2, marketProb: 0.5, prob: 0.5 });
    expect(assess([a, b]).verdict).toBe("no-book");
  });

  it("doesn't count exchanges as parlay books", () => {
    const e = event("x", [1.95, 1.95], [1.9, 1.9]);
    e.bookmakers.push({ key: "matchbook", title: "Matchbook", last_update: fresh, markets: [{ key: "h2h", outcomes: [{ name: "x Home", price: 2.5 }, { name: "x Away", price: 1.5 }] }] });
    const wide = { ...s, maxEvPct: 100 };
    const sel = evaluate([e], wide, NOW).find((v) => v.name === "x Home")!;
    const pick = toPick(sel, sel.offers.find((o) => o.book === "matchbook")!, wide);
    expect(pick.book).toBe("matchbook");
    expect(pick.offers!.map((o) => o.book)).not.toContain("matchbook");
    expect(pick.offers!.map((o) => o.book)).toContain("softbook");
  });

  it("rejects a game that has started", () => {
    const leg = { ...legOf(soft("a", 2.1)), commence: new Date(NOW - 60_000).toISOString() };
    expect(assess([leg, legOf(soft("b", 2.1))]).verdict).toBe("started");
  });

  it("warns about long shots", () => {
    const legs = ["a", "b", "c", "d", "e"].map((id) => legOf(soft(id, 2.1)));
    const r = assess(legs);
    expect(r.chosen!.hitProb).toBeCloseTo(0.03125, 4);
    expect(r.reasons.join(" ")).toContain("long shot");
  });

  it("carries AI adjustments into every book's price", () => {
    const e = soft("a", 2.1);
    const sel = evaluate([e], s, NOW).find((x) => x.name === e.home_team)!;
    const ai = { key: sel.key, verdict: "back" as const, adjustmentPts: 2, confidence: "high" as const, summary: "", risks: [], sources: [] };
    const pick = toPick(sel, sel.offers[0], s, ai);
    for (const o of pick.offers!) expect(o.prob).toBeCloseTo(o.marketProb + 0.02, 6);
  });

  it("logs legs at the chosen book's prices", () => {
    const r = assess([legOf(soft("a", 2.3, "second", 2.0)), legOf(soft("b", 2.0, "second", 2.2))], "second");
    const legs = legsAtBook(r.chosen!);
    expect(legs.map((l) => [l.book, l.price])).toEqual([["second", 2.0], ["second", 2.2]]);
  });
});

describe("questionnaire", () => {
  const answers: Answers = {
    leagues: ["soccer_top", "tennis"], goal: ["steady"], risk: ["low"], bankroll: ["250"], style: ["singles"],
    markets: ["h2h", "totals"], volume: ["few"], timing: ["24"], trust: ["market"], research: ["3"], region: ["uk"],
  };
  const available = ["soccer_epl", "soccer_italy_serie_a", "tennis_atp_paris_masters", "basketball_nba"];
  const base = PRESETS[0];
  const built = () => strategyFromAnswers(answers, base, available).strategy;
  const tweaks = { name: "Mine", description: "d", instructions: "i", minEvPct: 1, minOdds: 1.25, maxOdds: 2.2, maxPicks: 5, kellyFraction: 0.1, maxStakePct: 1 };

  it("has an option for every question, and knows when it's complete", () => {
    expect(isComplete(answers)).toBe(true);
    expect(isComplete({ ...answers, goal: [] })).toBe(false);
    for (const q of QUESTIONS) expect(q.options.length).toBeGreaterThan(1);
  });

  it("turns answers into valid settings", () => {
    const s = built();
    expect(StrategySchema.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({ bankroll: 250, kellyFraction: 0.1, maxStakePct: 1, minOdds: 1.25, maxOdds: 2.2, maxHoursAhead: 24, regions: ["uk"], markets: ["h2h", "totals"] });
    expect(s.parlay.enabled).toBe(false);
    expect(s.ai).toMatchObject({ aiWeightPct: 15, maxAdjustmentPts: 2, gamesToResearch: 3, maxSearches: 9, picksCount: 2 });
  });

  it("every combination of single answers stays valid and capped", () => {
    for (const goal of ["steady", "balanced", "payouts"]) for (const risk of ["low", "medium", "high"]) for (const style of ["singles", "mix", "parlays"]) {
      const s = strategyFromAnswers({ ...answers, goal: [goal], risk: [risk], style: [style] }, base, available).strategy;
      expect(StrategySchema.safeParse(s).success).toBe(true);
      expect(s.kellyFraction).toBeLessThanOrEqual(0.35);
      expect(s.maxStakePct).toBeLessThanOrEqual(3);
      expect(s.parlay.minLegs).toBeLessThanOrEqual(s.parlay.maxLegs);
      expect(s.minOdds).toBeLessThan(s.maxOdds);
    }
  });

  it("only uses leagues that are active, and expands tennis", () => {
    expect(built().sports).toEqual(["soccer_epl", "soccer_italy_serie_a", "tennis_atp_paris_masters"]);
    expect(sportsFor(["nfl"], available)).toEqual([]);
  });

  it("keeps current leagues and warns when none are active", () => {
    const r = strategyFromAnswers({ ...answers, leagues: ["nfl"] }, base, available);
    expect(r.strategy.sports).toEqual(base.sports);
    expect(r.warnings[0]).toContain("kept");
  });

  it("drops the sharp source where sharp books aren't listed", () => {
    const s = strategyFromAnswers({ ...answers, region: ["us"] }, base, available).strategy;
    expect(s).toMatchObject({ fairSource: "consensus", minReferenceBooks: 4 });
  });

  it("warns about a very expensive refresh", () => {
    const all = strategyFromAnswers({ ...answers, leagues: ["soccer_top", "soccer_europe", "nba", "nhl"], markets: ["h2h", "totals", "spreads"] }, base, []);
    expect(all.warnings.some((w) => w.includes("credits"))).toBe(true);
  });

  it("never lets Claude raise stakes or pick counts", () => {
    const s = applyTweaks(built(), { ...tweaks, kellyFraction: 1, maxStakePct: 50, maxPicks: 500 });
    expect(s).toMatchObject({ kellyFraction: 0.1, maxStakePct: 1, maxPicks: 5 });
    const lower = applyTweaks(built(), { ...tweaks, kellyFraction: 0.05, maxStakePct: 0.5 });
    expect(lower).toMatchObject({ kellyFraction: 0.05, maxStakePct: 0.5 });
  });

  it("keeps Claude's other changes inside limits and valid", () => {
    const wild = applyTweaks(built(), { ...tweaks, minEvPct: -20, minOdds: 50, maxOdds: 1.01 });
    expect(wild.minEvPct).toBe(0.5);
    expect(wild.minOdds).toBeLessThan(wild.maxOdds);
    expect(StrategySchema.safeParse(wild).success).toBe(true);
    const notNumber = applyTweaks(built(), { ...tweaks, minOdds: Number.NaN, maxOdds: Number.NaN });
    expect(notNumber).toMatchObject({ minOdds: 1.25, maxOdds: 2.2 });
  });

  it("shortens long text at a sentence or word, never mid-word", () => {
    expect(shorten("Short.", 240)).toBe("Short.");
    expect(shorten("First sentence here. Second sentence runs far too long to fit", 30)).toBe("First sentence here.");
    expect(shorten("oneveryverylongwordfollowedby more words", 36)).toBe("oneveryverylongwordfollowedby more…");
    expect(shorten("x".repeat(50), 10).length).toBeLessThanOrEqual(10);
  });

  it("keeps the base name when Claude's name is blank", () => {
    expect(applyTweaks(built(), { ...tweaks, name: "  " }).name).toBe(base.name);
  });
});

describe("AI picks", () => {
  const s = strategy({ markets: ["h2h"], ai: { ...PRESETS[0].ai, maxAdjustmentPts: 5, aiWeightPct: 50, minEdgePct: 2, gamesToResearch: 2, picksCount: 1 } });
  const games = [event("a", [1.95, 1.95], [2.04, 1.8]), event("b", [1.95, 1.95], [2.02, 1.82])];
  const keyA = selectionKey("a", "h2h", "a Home");
  const keyB = selectionKey("b", "h2h", "b Home");
  const prediction = (gameId: string, pickId: string, chance: number, confidence: "low" | "medium" | "high" = "high") => ({
    gameId, pickId, confidence, summary: `why ${gameId}`, risks: ["risk"], sources: [], chances: { [pickId]: chance },
  });
  const candidates = () => selectGames(evaluate(games, s, NOW), s, NOW);

  it("researches the soonest games, up to the limit", () => {
    const soon = { ...event("soon", [1.95, 1.95], [2.04, 1.8]), commence_time: new Date(NOW + 3_600_000).toISOString() };
    const three = [...games, soon];
    const picked = selectGames(evaluate(three, s, NOW), s, NOW);
    expect(picked.map((g) => g.event.id)).toEqual(["soon", "a"]);
  });

  it("offers only the main line of a market", () => {
    const e = event("t", [1.95, 1.95], [2.04, 1.8]);
    e.bookmakers.forEach((b) => {
      b.markets.push({ key: "totals", outcomes: [{ name: "Over", price: 1.9, point: 2.5 }, { name: "Under", price: 1.9, point: 2.5 }] });
    });
    e.bookmakers[0].markets.push({ key: "totals", outcomes: [{ name: "Over", price: 2.4, point: 3.5 }, { name: "Under", price: 1.5, point: 3.5 }] });
    const wide = strategy({ markets: ["h2h", "totals"], fairSource: "consensus" });
    const [game] = selectGames(evaluate([e], wide, NOW), wide, NOW);
    expect(new Set(game.selections.filter((x) => x.market === "totals").map((x) => x.point))).toEqual(new Set([2.5]));
  });

  it("blends toward Claude's estimate, scaled by confidence and capped", () => {
    expect(blendedAdjustmentPts(0.5, 0.56, "high", s)).toBeCloseTo(3, 6);
    expect(blendedAdjustmentPts(0.5, 0.56, "low", s)).toBeCloseTo(1, 6);
    expect(blendedAdjustmentPts(0.5, 0.9, "high", s)).toBe(5);
    expect(blendedAdjustmentPts(0.5, 0.1, "high", s)).toBe(-5);
  });

  it("recommends a bet when Claude's pick clears the minimum edge", () => {
    const { bets } = buildAiBets(candidates(), [prediction("a", keyA, 0.56)], s);
    expect(bets).toHaveLength(1);
    expect(bets[0]).toMatchObject({ book: "softbook", price: 2.04, aiChance: 0.56 });
    expect(bets[0].prob).toBeCloseTo(0.53, 5);
    expect(bets[0].ev).toBeCloseTo(0.53 * 2.04 - 1, 5);
    expect(bets[0].minPrice).toBeCloseTo(1.02 / 0.53, 5);
    expect(bets[0].ai?.summary).toBe("why a");
  });

  it("moves a pick to the watchlist when the price is too low", () => {
    const { bets, passes } = buildAiBets(candidates(), [prediction("a", keyA, 0.48)], s);
    expect(bets).toHaveLength(0);
    const pass = passes.find((p) => p.eventId === "a")!;
    expect(pass.watch).toMatchObject({ bestPrice: 2.04, book: "Soft Book" });
    expect(pass.watch!.minPrice).toBeCloseTo(1.02 / 0.49, 5);
  });

  it("respects a no-bet decision even when the price looks good", () => {
    const none = { ...prediction("a", "none", 0.5), summary: "Too uncertain" };
    const { bets, passes } = buildAiBets(candidates(), [none], s);
    expect(bets).toHaveLength(0);
    expect(passes.find((p) => p.eventId === "a")!.reason).toBe("Too uncertain");
  });

  it("ignores picks and probabilities it can't trust", () => {
    const made = buildAiBets(candidates(), [prediction("a", "made-up-id", 0.9)], s);
    expect(made.bets).toHaveLength(0);
    const silly = buildAiBets(candidates(), [{ ...prediction("a", keyA, 0.6), chances: { [keyA]: 60 } }], s);
    expect(silly.bets).toHaveLength(0);
  });

  it("keeps the strongest bets up to the limit and explains the rest", () => {
    const { bets, passes } = buildAiBets(candidates(), [prediction("a", keyA, 0.58), prediction("b", keyB, 0.58)], s);
    expect(bets).toHaveLength(1);
    expect(bets[0].eventId).toBe("a");
    expect(passes.find((p) => p.eventId === "b")!.reason).toContain("limit of 1");
  });

  it("does not bet on games it didn't research", () => {
    const { bets, passes } = buildAiBets(candidates(), [], s);
    expect(bets).toHaveLength(0);
    expect(passes.every((p) => p.reason === "Not covered by the research.")).toBe(true);
  });
});

describe("league coverage", () => {
  const s = strategy({ sports: ["soccer_epl", "basketball_nba", "tennis_atp"], minEvPct: 5 });

  it("reports loaded, out-of-window, and below-minimum leagues", () => {
    const soon = event("a", [1.95, 1.95], [2.04, 1.8]);
    const far = { ...event("b", [1.95, 1.95], [2.15, 1.72], "basketball_nba"), commence_time: new Date(NOW + 30 * 86_400_000).toISOString() };
    const events = [soon, far];
    const sels = evaluate(events, s, NOW);
    const { picks } = findPicks(sels, s, {}, NOW);
    const [epl, nba, tennis] = leagueCoverage(s, events, sels, picks, ["soccer_epl", "basketball_nba"], NOW);

    expect(epl).toMatchObject({ loaded: true, games: 1, gamesInWindow: 1, picks: 0 });
    expect(epl.bestEv!).toBeCloseTo(0.02, 3);
    expect(nba).toMatchObject({ loaded: true, games: 1, gamesInWindow: 0, bestEv: null });
    expect(tennis).toMatchObject({ loaded: false, games: 0, title: "tennis_atp" });
  });
});

describe("real feed shapes", () => {
  // Prices taken from a real odds API response, 2026-11-05.
  const FEED_NOW = Date.parse("2026-11-05T16:20:00Z");
  const updated = "2026-11-05T16:19:30Z";
  const threeWay = (key: string, title: string, home: number, away: number, draw: number, lay?: [number, number, number]) => ({
    key,
    title,
    last_update: updated,
    markets: [
      { key: "h2h", last_update: updated, outcomes: [{ name: "Anderlecht", price: home }, { name: "Salzburg", price: away }, { name: "Draw", price: draw }] },
      ...(lay ? [{ key: "h2h_lay", last_update: updated, outcomes: [{ name: "Anderlecht", price: lay[0] }, { name: "Salzburg", price: lay[1] }, { name: "Draw", price: lay[2] }] }] : []),
    ],
  });
  const fixture: RawEvent = {
    id: "9604c5b1",
    sport_key: "soccer_uefa_europa_league",
    sport_title: "UEFA Europa League",
    commence_time: "2026-11-05T17:45:00Z",
    home_team: "Anderlecht",
    away_team: "Salzburg",
    bookmakers: [
      threeWay("pinnacle", "Pinnacle", 2.05, 3.42, 3.97),
      threeWay("betfair_ex_eu", "Betfair", 2.08, 3.55, 4.1, [2.1, 3.6, 4.2]),
      threeWay("matchbook", "Matchbook", 2.08, 3.55, 4.1, [2.1, 3.6, 4.2]),
      threeWay("unibet_nl", "Unibet (NL)", 2.07, 3.55, 3.9),
      threeWay("pmu_fr", "PMU (FR)", 1.88, 3.15, 3.45),
    ],
  };
  const s = strategy({ markets: ["h2h"], maxOdds: 10, minEvPct: -100 });

  it("ignores exchange lay prices, which aren't bets you can back", () => {
    const sels = evaluate([fixture], s, FEED_NOW);
    expect(sels.map((x) => x.name).sort()).toEqual(["Anderlecht", "Draw", "Salzburg"]);
    for (const sel of sels) for (const o of sel.offers) expect([2.1, 3.6, 4.2]).not.toContain(o.price);
  });

  it("produces sane fair chances that sum to 1", () => {
    const sels = evaluate([fixture], s, FEED_NOW);
    expect(sels.reduce((a, x) => a + x.fairProb!, 0)).toBeCloseTo(1, 6);
    expect(sels.find((x) => x.name === "Anderlecht")!.fairProb!).toBeGreaterThan(0.45);
    expect(sels.find((x) => x.name === "Anderlecht")!.fairProb!).toBeLessThan(0.5);
  });

  it("charges exchange commission on winnings and marks the price", () => {
    const home = evaluate([fixture], s, FEED_NOW).find((x) => x.name === "Anderlecht")!;
    const betfair = home.offers.find((o) => o.book === "betfair_ex_eu")!;
    expect(betfair.price).toBeCloseTo(1 + 1.08 * 0.95, 6);
    expect(betfair.bookTitle).toBe("Betfair (after 5% fee)");
    expect(home.offers.find((o) => o.book === "unibet_nl")!.price).toBe(2.07);
  });

  it("skips games already in play, whose prices are not comparable", () => {
    const started = { ...fixture, commence_time: "2026-11-05T14:30:00Z" };
    const sels = evaluate([started], s, FEED_NOW);
    expect(findPicks(sels, s, {}, FEED_NOW).picks).toHaveLength(0);
    expect(buildParlays(sels, s, {}, FEED_NOW)).toHaveLength(0);
  });

  it("never builds parlays on an exchange", () => {
    const other = (id: string): RawEvent => ({
      ...fixture,
      id,
      bookmakers: [threeWay("pinnacle", "Pinnacle", 2.05, 3.42, 3.97), threeWay("betfair_ex_eu", "Betfair", 2.4, 3.9, 4.6)],
    });
    const loose = { ...s, parlay: { ...s.parlay, minCombinedOdds: 1.1, maxCombinedOdds: 100, legMaxOdds: 10, legMinEvPct: -100, minHitProbPct: 0.1 } };
    const parlays = buildParlays(evaluate([other("a"), other("b")], loose, FEED_NOW), { ...loose, maxEvPct: 100 }, {}, FEED_NOW);
    expect(parlays).toHaveLength(0);
  });
});

const leg = (over: Partial<BetLeg>): BetLeg => ({
  key: "k", eventId: "e", sportKey: "x", sportTitle: "X", commence: later, home: "H", away: "A",
  market: "h2h", selection: "H", label: "", price: 2, prob: 0.5, result: "pending", ...over,
});
const bet = (legs: BetLeg[], over: Partial<Bet> = {}): Bet => ({
  id: "b", placedAt: later, kind: legs.length > 1 ? "parlay" : "single", book: "x", bookTitle: "X",
  strategyId: "s", strategyName: "S", stake: 10, odds: legs.reduce((a, l) => a * l.price, 1),
  evAtPlacement: 0.05, legs, status: "pending", returned: 0, demo: false, ...over,
});

describe("settling", () => {
  it("grades moneyline, draw, totals and spreads", () => {
    expect(gradeLeg(leg({ selection: "H" }), { home: 2, away: 1 })).toBe("won");
    expect(gradeLeg(leg({ selection: "A" }), { home: 2, away: 1 })).toBe("lost");
    expect(gradeLeg(leg({ selection: "H" }), { home: 1, away: 1 })).toBe("lost");
    expect(gradeLeg(leg({ selection: "Draw" }), { home: 1, away: 1 })).toBe("won");
    const over = leg({ market: "totals", selection: "Over", point: 2.5 });
    expect(gradeLeg(over, { home: 2, away: 1 })).toBe("won");
    expect(gradeLeg({ ...over, selection: "Under" }, { home: 2, away: 1 })).toBe("lost");
    expect(gradeLeg({ ...over, point: 3 }, { home: 2, away: 1 })).toBe("push");
    const spread = leg({ market: "spreads", selection: "H", point: -1.5 });
    expect(gradeLeg(spread, { home: 2, away: 1 })).toBe("lost");
    expect(gradeLeg(spread, { home: 3, away: 1 })).toBe("won");
    expect(gradeLeg({ ...spread, selection: "A", point: 1 }, { home: 2, away: 1 })).toBe("push");
  });

  it("settles parlays: any loss loses, pushes drop out", () => {
    const won = leg({ result: "won", price: 2 });
    const pending = leg({ result: "pending", price: 2 });
    expect(applyLegResults(bet([won, pending])).status).toBe("pending");
    expect(applyLegResults(bet([won, leg({ result: "lost" })])).returned).toBe(0);
    expect(applyLegResults(bet([won, won])).returned).toBe(40);
    const reduced = applyLegResults(bet([won, leg({ result: "push", price: 3 })]));
    expect(reduced.status).toBe("won");
    expect(reduced.returned).toBe(20);
    const allPush = applyLegResults(bet([leg({ result: "push" })]));
    expect(allPush.status).toBe("push");
    expect(allPush.returned).toBe(10);
  });

  it("measures closing line value and ledger totals", () => {
    const beat = bet([leg({ price: 2.1, closingProb: 0.5, result: "won" })], { odds: 2.1 });
    expect(closingValue(beat)).toBeCloseTo(0.05);
    const a = applyLegResults(beat);
    const b = applyLegResults(bet([leg({ result: "lost" })]));
    const stats = ledgerStats([a, b]);
    expect(stats.net).toBeCloseTo(1);
    expect(stats.roi).toBeCloseTo(0.05);
    expect(stats.hitRate).toBe(0.5);
    expect(stats.avgClv).toBeCloseTo(0.05);
  });
});
