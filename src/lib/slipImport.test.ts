import { describe, expect, it } from "vitest";
import { buildSlipDraft, type KnownGame, type SlipExtraction } from "./slipImport";

const game: KnownGame = { id: "g1", sportKey: "soccer_x", sportTitle: "League", commence: "2026-11-06T20:30:00Z", home: "Hamburger SV", away: "Borussia Monchengladbach" };
const NOW = "2026-11-06T10:00:00.000Z";

const leg = (over: Partial<SlipExtraction["legs"][number]> = {}): SlipExtraction["legs"][number] => ({
  game_id: "none", home: "Home FC", away: "Away FC", kickoff: "2026-11-07T18:00", market: "h2h", side: "home", line: null, description: null, odds: 2, ...over,
});
const slip = (over: Partial<SlipExtraction> = {}): SlipExtraction => ({
  is_bet_slip: true, bookmaker: "Betsafe", stake: 5, total_odds: null, placed_at: "2026-11-06T09:00", legs: [leg()], left_out: [], notes: [], ...over,
});
const build = (over: Partial<SlipExtraction> = {}) => buildSlipDraft(slip(over), [game], NOW);

describe("reading a bet slip", () => {
  it("keeps the slip's details on a typed game", () => {
    const d = build();
    expect(d.book).toBe("Betsafe");
    expect(d.stake).toBe(5);
    expect(d.placedAt).toBe("2026-11-06T09:00");
    expect(d.warnings).toEqual([]);
    expect(d.legs[0]).toMatchObject({ gameId: undefined, sportKey: "manual", home: "Home FC", selection: "Home FC", price: 2, commence: "2026-11-07T18:00" });
  });

  it("uses the saved game's names and kickoff when matched", () => {
    const d = build({ legs: [leg({ game_id: "g1", home: "HSV", away: "Gladbach", kickoff: null, side: "away" })] });
    expect(d.legs[0]).toMatchObject({ gameId: "g1", sportKey: "soccer_x", home: "Hamburger SV", selection: "Borussia Monchengladbach", commence: game.commence });
  });

  it("doesn't trust a game id that isn't in the list", () => {
    expect(build({ legs: [leg({ game_id: "made-up" })] }).legs[0].gameId).toBeUndefined();
  });

  it("maps every kind of selection", () => {
    const d = build({
      legs: [
        leg({ side: "draw" }),
        leg({ market: "totals", side: "over", line: 2.5 }),
        leg({ market: "spreads", side: "away", line: 1.5 }),
      ],
    });
    expect(d.legs.map((l) => [l.selection, l.point])).toEqual([["Draw", undefined], ["Over", 2.5], ["Away FC", 1.5]]);
  });

  it("skips legs that can't be saved and says so", () => {
    const d = build({
      legs: [
        leg({ market: "totals", side: "home", line: 2.5 }),
        leg({ market: "totals", side: "over", line: null }),
        leg({ market: "spreads", side: "draw", line: 1 }),
        leg({ home: " " }),
      ],
    });
    expect(d.legs).toEqual([]);
    expect(d.warnings).toHaveLength(4);
  });

  it("warns when a kickoff is missing or unreadable", () => {
    const d = build({ legs: [leg({ kickoff: null }), leg({ kickoff: "Saturday-ish" })] });
    expect(d.legs.map((l) => l.commence)).toEqual(["2026-11-06T09:00", "2026-11-06T09:00"]);
    expect(d.warnings).toHaveLength(2);
    expect(build({ placed_at: null, legs: [leg({ kickoff: null })] }).legs[0].commence).toBe(NOW);
  });

  it("uses the total as a single's odds", () => {
    const d = build({ total_odds: 2.4, legs: [leg({ odds: null })] });
    expect(d.legs[0].price).toBe(2.4);
    expect(d.warnings).toEqual([]);
  });

  it("splits a parlay's total when leg odds are missing, and warns", () => {
    const d = build({ total_odds: 6, legs: [leg({ odds: 1.5 }), leg({ odds: null }), leg({ odds: null })] });
    expect(d.legs.map((l) => l.price)).toEqual([1.5, 2, 2]);
    expect(d.warnings).toHaveLength(1);
  });

  it("skips a leg with no odds and no total to use", () => {
    const d = build({ legs: [leg({ odds: null })] });
    expect(d.legs).toEqual([]);
    expect(d.warnings[0]).toContain("odds couldn't be read");
  });

  it("flags a total that doesn't match the legs, but keeps it", () => {
    const d = build({ total_odds: 5, legs: [leg({ odds: 2 }), leg({ odds: 2 })] });
    expect(d.totalOdds).toBe(5);
    expect(d.warnings[0]).toContain("multiply to 4.00");
    expect(build({ total_odds: 4.02, legs: [leg({ odds: 2 }), leg({ odds: 2 })] }).warnings).toEqual([]);
  });

  it("passes on what it left out and any notes", () => {
    const d = build({ left_out: ["Over 9.5 corners"], notes: ["Stake was in dollars."] });
    expect(d.warnings).toEqual(["Left out because this app can't track it: Over 9.5 corners", "Stake was in dollars."]);
  });

  it("drops an empty bookmaker and a zero stake", () => {
    const d = build({ bookmaker: "  ", stake: 0 });
    expect(d.book).toBeNull();
    expect(d.stake).toBeNull();
  });
});
