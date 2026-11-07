import { describe, expect, it } from "vitest";
import { buildPrompt, leagueName, type PromptContext } from "./promptBuilder";
import { PRESETS, type Strategy } from "./strategy";

const ctx: PromptContext = {
  date: "2026-11-07",
  timeZone: "Europe/Riga",
  bookmaker: "Betsafe",
  leagueTitles: { soccer_epl: "EPL" },
  games: "",
};
const strategy = (over: Partial<Strategy> = {}, ai: Partial<Strategy["ai"]> = {}): Strategy => ({
  ...PRESETS[0],
  name: "Steady",
  description: "Short prices.",
  sports: ["soccer_epl", "soccer_germany_bundesliga2"],
  markets: ["h2h", "totals"],
  bankroll: 50,
  maxStakePct: 10,
  minOdds: 1.25,
  maxOdds: 3.5,
  maxHoursAhead: 24,
  ...over,
  ai: { ...PRESETS[0].ai, pickStyle: "best", flatStakePct: 2, picksCount: 3, instructions: "", ...ai },
});

describe("strategy prompt", () => {
  it("states the strategy's limits", () => {
    const p = buildPrompt(strategy(), ctx);
    expect(p).toContain("MY STRATEGY: Steady\nShort prices.");
    expect(p).toContain("Leagues: EPL, Germany Bundesliga2");
    expect(p).toContain("Bet types: match result (home, draw or away); over/under total goals or points.");
    expect(p).toContain("starting within the next 24 hours");
    expect(p).toContain("between 1.25 and 3.5");
    expect(p).toContain("up to 3 singles");
    expect(p).toContain("Bookmaker: Betsafe");
    expect(p).toContain("Bankroll: €50.00");
  });

  it("uses a flat stake for best picks, capped by the largest stake", () => {
    expect(buildPrompt(strategy(), ctx)).toContain("Singles: €1.00 each, a flat stake.");
    expect(buildPrompt(strategy({ maxStakePct: 1 }, { flatStakePct: 5 }), ctx)).toContain("Singles: €0.50 each");
  });

  it("asks for a price edge and Kelly stakes in value style", () => {
    const p = buildPrompt(strategy({ kellyFraction: 0.25 }, { pickStyle: "value", minEdgePct: 3 }), ctx);
    expect(p).toContain("at least 1.03, which is a 3% edge");
    expect(p).toContain("25% of the Kelly stake");
    expect(p).toContain("Never more than €5.00");
  });

  it("includes parlay rules only when parlays are on", () => {
    const on = buildPrompt(strategy({ parlay: { ...PRESETS[0].parlay, enabled: true, minLegs: 2, maxLegs: 3, count: 2, maxStakePct: 1 } }), ctx);
    expect(on).toContain("PARLAYS: up to 2");
    expect(on).toContain("2 to 3 legs");
    expect(on).toContain("Parlays: €0.50 each");
    const off = buildPrompt(strategy({ parlay: { ...PRESETS[0].parlay, enabled: false } }), ctx);
    expect(off).toContain("PARLAYS: none.");
    expect(off).not.toContain("Parlays: €");
  });

  it("adds the strategy's own words and pasted games", () => {
    const p = buildPrompt(strategy({}, { instructions: "  Favour home teams.  " }), { ...ctx, games: "Arsenal v Chelsea 2.10 3.40 3.50" });
    expect(p).toContain("In my own words:\nFavour home teams.");
    expect(p).toContain("Arsenal v Chelsea 2.10 3.40 3.50");
    expect(p).not.toContain("[Paste the games");
  });

  it("leaves placeholders when details are missing", () => {
    const p = buildPrompt(strategy(), { ...ctx, bookmaker: " " });
    expect(p).toContain("Bookmaker: [BOOKMAKER]");
    expect(p).toContain("[Paste the games and odds here");
    expect(p).not.toContain("In my own words");
  });

  it("describes a later start window", () => {
    expect(buildPrompt(strategy({ minHoursAhead: 2, maxHoursAhead: 48 }), ctx)).toContain("between 2 and 48 hours from now");
  });
});

describe("record and log list", () => {
  it("adds your record when there is one", () => {
    expect(buildPrompt(strategy(), { ...ctx, record: "Overall: 12 bets." })).toContain("MY RECORD SO FAR\nOverall: 12 bets.");
    expect(buildPrompt(strategy(), ctx)).not.toContain("MY RECORD");
  });

  it("asks for a log list the ledger can read", () => {
    const p = buildPrompt(strategy(), ctx);
    expect(p).toContain("Home vs Away | kickoff | bet | odds | stake | your chance % | strength");
    expect(p).toContain("PARLAY | total odds | stake");
  });
});

describe("league names", () => {
  it("prefers the feed's title, then tidies the key", () => {
    expect(leagueName("soccer_epl", { soccer_epl: "EPL" })).toBe("EPL");
    expect(leagueName("basketball_nba", {})).toBe("NBA");
    expect(leagueName("soccer_uefa_europa_conference_league", {})).toBe("UEFA Europa Conference League");
    expect(leagueName("odd", {})).toBe("odd");
  });
});
