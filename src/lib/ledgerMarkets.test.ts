import { describe, expect, it } from "vitest";
import { applyLegResults, gradeLeg } from "./engine/settle";
import { createManualBet, ManualBetSchema } from "./manualBet";
import { buildSlipDraft, type SlipExtraction } from "./slipImport";

const typedLeg = (selection: string, market = "other") => ({
  sportKey: "manual", sportTitle: "Added by hand", commence: "2026-11-08T15:00:00Z",
  home: "Arsenal", away: "Chelsea", market, selection, price: 1.8,
});
const input = (legs: object[]) => ({ strategyId: "s", book: "Betsafe", stake: 5, odds: 1.8, placedAt: "2026-11-07T10:00:00Z", legs });

describe("any bet type in the ledger", () => {
  it("saves a typed bet with its own wording, settled by hand", () => {
    const bet = createManualBet(ManualBetSchema.parse(input([typedLeg("Over 9.5 corners")])), "S", false);
    expect(bet.legs[0]).toMatchObject({ market: "other", label: "Over 9.5 corners", handSettle: true, point: undefined });
  });

  it("mixes typed and standard bets in one parlay", () => {
    const bet = createManualBet(ManualBetSchema.parse(input([typedLeg("Both teams to score: Yes"), typedLeg("Arsenal", "h2h")])), "S", false);
    expect(bet.kind).toBe("parlay");
    expect(bet.legs.map((l) => l.label)).toEqual(["Both teams to score: Yes", "Arsenal to win"]);
  });

  it("needs a description, but no line or team match", () => {
    expect(ManualBetSchema.safeParse(input([typedLeg("  ")])).success).toBe(false);
    expect(ManualBetSchema.safeParse(input([typedLeg("Haaland to score anytime")])).success).toBe(true);
    expect(ManualBetSchema.safeParse(input([typedLeg("x".repeat(121))])).success).toBe(false);
  });

  it("is never graded from the score, but settles once marked", () => {
    const bet = createManualBet(ManualBetSchema.parse(input([typedLeg("Over 9.5 corners")])), "S", false);
    expect(gradeLeg(bet.legs[0], { home: 3, away: 2 })).toBe("pending");
    const won = applyLegResults({ ...bet, legs: [{ ...bet.legs[0], result: "won" }] });
    expect(won.status).toBe("won");
    expect(won.returned).toBe(9);
  });
});

describe("reading any bet type from a slip", () => {
  const leg = (over: Partial<SlipExtraction["legs"][number]>): SlipExtraction["legs"][number] => ({
    game_id: "none", home: "Arsenal", away: "Chelsea", kickoff: "2026-11-08T17:30", market: "other", side: "other", line: null, description: "Both teams to score: Yes", odds: 1.7, ...over,
  });
  const slip = (legs: SlipExtraction["legs"]): SlipExtraction => ({
    is_bet_slip: true, bookmaker: "Betsafe", stake: 5, total_odds: null, placed_at: null, legs, left_out: [], notes: [],
  });

  it("keeps the slip's wording", () => {
    const d = buildSlipDraft(slip([leg({}), leg({ description: "Over 4.5 cards" })]), [], "2026-11-07T10:00:00.000Z");
    expect(d.legs.map((l) => [l.market, l.selection, l.point])).toEqual([["other", "Both teams to score: Yes", undefined], ["other", "Over 4.5 cards", undefined]]);
    expect(d.warnings).toEqual([]);
  });

  it("skips a typed bet with no description", () => {
    const d = buildSlipDraft(slip([leg({ description: null }), leg({ description: " " })]), [], "2026-11-07T10:00:00.000Z");
    expect(d.legs).toEqual([]);
    expect(d.warnings).toHaveLength(2);
  });

  it("ignores a stray line on a typed bet", () => {
    const d = buildSlipDraft(slip([leg({ line: 9.5, description: "Over 9.5 corners" })]), [], "2026-11-07T10:00:00.000Z");
    expect(d.legs[0].point).toBeUndefined();
  });
});
