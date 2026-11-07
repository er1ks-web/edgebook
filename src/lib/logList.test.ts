import { describe, expect, it } from "vitest";
import { classifyBet, parseKickoff, parseLogList } from "./logList";

describe("log list", () => {
  it("reads singles with chance and strength", () => {
    const { bets, problems } = parseLogList(
      [
        "LOG LIST",
        "Home vs Away | kickoff | bet | odds | stake | chance | strength",
        "Arsenal vs Chelsea | 2026-11-08 17:30 | Arsenal to win | 2.10 | €5 | 55% | 7/10",
        "- Inter v Roma | 09.11.2026 20:45 | Over 9.5 corners | 1.85 | 2.50",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(bets).toHaveLength(2);
    expect(bets[0]).toEqual({
      odds: 2.1,
      stake: 5,
      legs: [{ home: "Arsenal", away: "Chelsea", commence: "2026-11-08T17:30", market: "h2h", selection: "Arsenal", label: "Arsenal to win", price: 2.1, chance: 0.55, strength: 7 }],
    });
    expect(bets[1].legs[0]).toMatchObject({ home: "Inter", away: "Roma", commence: "2026-11-09T20:45", market: "other", label: "Over 9.5 corners" });
    expect(bets[1].legs[0].chance).toBeUndefined();
  });

  it("reads a parlay and its legs", () => {
    const { bets, problems } = parseLogList(
      [
        "PARLAY | 3.55 | 2",
        "+ Arsenal vs Chelsea | 2026-11-08 17:30 | Over 2.5 | 1.80 | 60% | 6",
        "+ Inter vs Roma | 2026-11-09 20:45 | Both teams to score: Yes | 1.97 | 52 | 5",
        "Real Madrid vs Valencia | 2026-11-09 21:00 | Draw | 4.20 | 1",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(bets).toHaveLength(2);
    expect(bets[0].odds).toBe(3.55);
    expect(bets[0].stake).toBe(2);
    expect(bets[0].legs.map((l) => [l.market, l.label, l.chance, l.strength])).toEqual([
      ["totals", "Over 2.5", 0.6, 6],
      ["other", "Both teams to score: Yes", 0.52, 5],
    ]);
    expect(bets[1].legs[0]).toMatchObject({ market: "h2h", selection: "Draw" });
  });

  it("reports lines it can't use, and keeps the rest", () => {
    const { bets, problems } = parseLogList(
      [
        "Arsenal Chelsea | 2026-11-08 17:30 | Draw | 3.4 | 5",
        "Arsenal vs Chelsea | 2026-11-08 17:30 | Draw | evens | 5",
        "Arsenal vs Chelsea | 2026-11-08 17:30 | Draw | 3.4 |",
        "+ Inter vs Roma | 2026-11-09 | Draw | 3.2",
        "PARLAY | 3 | 2",
        "+ Inter vs Roma | 2026-11-09 20:45 | Draw | 3.2",
        "Arsenal vs Chelsea | 2026-11-08 17:30 | Draw | 3.4 | 5",
      ].join("\n"),
    );
    expect(bets).toHaveLength(1);
    expect(problems).toHaveLength(5);
  });

  it("keeps a bet with no readable kickoff, for you to fix", () => {
    const { bets } = parseLogList("Arsenal vs Chelsea | Saturday | Draw | 3.4 | 5");
    expect(bets[0].legs[0].commence).toBeNull();
  });

  it("ignores text around the list", () => {
    expect(parseLogList("Here are your bets.\n\nGood luck!").bets).toEqual([]);
  });
});

describe("bet wording", () => {
  it("recognises standard bets", () => {
    expect(classifyBet("arsenal to win", "Arsenal", "Chelsea")).toMatchObject({ market: "h2h", selection: "Arsenal" });
    expect(classifyBet("Under 3.5", "A", "B")).toMatchObject({ market: "totals", selection: "Under", point: 3.5 });
    expect(classifyBet("Chelsea +1.5", "Arsenal", "Chelsea")).toMatchObject({ market: "spreads", selection: "Chelsea", point: 1.5 });
  });

  it("keeps anything else as typed", () => {
    expect(classifyBet("Liverpool to win", "Arsenal", "Chelsea")).toMatchObject({ market: "other", label: "Liverpool to win" });
    expect(classifyBet("Chelsea +1.25", "Arsenal", "Chelsea").market).toBe("other");
    expect(classifyBet("Haaland to score anytime", "A", "B").market).toBe("other");
  });

  it("reads two date styles", () => {
    expect(parseKickoff("2026-11-08 7:05")).toBe("2026-11-08T07:05");
    expect(parseKickoff("8/11/2026, 17:30")).toBe("2026-11-08T17:30");
    expect(parseKickoff("tomorrow")).toBeNull();
  });
});
