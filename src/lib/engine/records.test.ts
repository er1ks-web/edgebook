import { describe, expect, it } from "vitest";
import type { Bet, BetLeg } from "../types";
import { bettingRecords, decidedAt, localDay } from "./settle";

const leg = (date: string, result: BetLeg["result"]): BetLeg => ({
  key: `${date}-${result}`, eventId: "e", sportKey: "x", sportTitle: "X", commence: `${date}T12:00:00Z`,
  home: "H", away: "A", market: "h2h", selection: "H", label: "", price: 2, prob: 0.5, result,
});

let id = 0;
const bet = (date: string, status: Bet["status"], stake = 10, returned = status === "won" ? 20 : status === "push" ? 10 : 0): Bet => ({
  id: String(id++), placedAt: `${date}T08:00:00Z`, kind: "single", book: "x", bookTitle: "X", strategyId: "s", strategyName: "S",
  stake, odds: 2, evAtPlacement: 0, legs: [leg(date, status)], status, returned, demo: false,
});

describe("betting records", () => {
  it("handles an empty ledger", () => {
    const r = bettingRecords([]);
    expect(r.currentStreak).toBeNull();
    expect(r.hottestDays).toBeNull();
    expect(r.bestDay).toBeNull();
    expect(r.biggestWin).toBeNull();
    expect(r.biggestLoss).toBeNull();
  });

  it("tracks bet streaks in game order, whatever order they were logged", () => {
    const r = bettingRecords([
      bet("2026-11-04", "won"), bet("2026-11-01", "won"), bet("2026-11-03", "lost"),
      bet("2026-11-02", "won"), bet("2026-11-05", "won"),
    ]);
    expect(r.hottestStreak).toBe(2);
    expect(r.coldestStreak).toBe(1);
    expect(r.currentStreak).toEqual({ kind: "won", length: 2 });
    expect([r.won, r.lost, r.push]).toEqual([4, 1, 0]);
  });

  it("lets a push pass through a streak", () => {
    const r = bettingRecords([bet("2026-11-01", "won"), bet("2026-11-02", "push"), bet("2026-11-03", "won")]);
    expect(r.hottestStreak).toBe(2);
    expect(r.push).toBe(1);
  });

  it("ignores open bets", () => {
    const r = bettingRecords([bet("2026-11-01", "won"), bet("2026-11-02", "pending")]);
    expect(r.currentStreak).toEqual({ kind: "won", length: 1 });
    expect(r.days).toHaveLength(1);
  });

  it("judges a day by its net result, not its bets", () => {
    const r = bettingRecords([bet("2026-11-01", "won"), bet("2026-11-01", "lost", 5), bet("2026-11-02", "won"), bet("2026-11-02", "lost", 20)]);
    expect(r.greenDays).toBe(1);
    expect(r.redDays).toBe(1);
    expect(r.bestDay).toEqual({ day: "2026-11-01", net: 5, bets: 2 });
    expect(r.worstDay).toEqual({ day: "2026-11-02", net: -10, bets: 2 });
  });

  it("counts green days in a row, skipping days off and even days", () => {
    const r = bettingRecords([
      bet("2026-11-01", "won"),
      bet("2026-11-03", "won"),
      bet("2026-11-04", "push"),
      bet("2026-11-05", "won"),
      bet("2026-11-06", "lost"),
      bet("2026-11-07", "lost"),
      bet("2026-11-08", "won"),
    ]);
    expect(r.hottestDays).toEqual({ length: 3, from: "2026-11-01", to: "2026-11-05" });
    expect(r.coldestDays).toBe(2);
    expect(r.currentGreenDays).toBe(1);
    expect(r.currentRedDays).toBe(0);
  });

  it("reports a current run of red days and no current green run", () => {
    const r = bettingRecords([bet("2026-11-01", "won"), bet("2026-11-02", "lost"), bet("2026-11-03", "lost")]);
    expect(r.currentGreenDays).toBe(0);
    expect(r.currentRedDays).toBe(2);
    expect(r.currentStreak).toEqual({ kind: "lost", length: 2 });
  });

  it("dates a lost parlay at its first lost leg and a won one at its last game", () => {
    const lost = { ...bet("2026-11-05", "lost"), kind: "parlay" as const, legs: [leg("2026-11-07", "pending"), leg("2026-11-05", "lost"), leg("2026-11-06", "lost")] };
    const won = { ...bet("2026-11-05", "won"), kind: "parlay" as const, legs: [leg("2026-11-05", "won"), leg("2026-11-08", "won")] };
    expect(localDay(decidedAt(lost))).toBe(localDay(Date.parse("2026-11-05T12:00:00Z")));
    expect(localDay(decidedAt(won))).toBe(localDay(Date.parse("2026-11-08T12:00:00Z")));
  });

  it("finds the biggest results and splits singles from parlays", () => {
    const parlay = { ...bet("2026-11-02", "won", 5, 40), kind: "parlay" as const };
    const r = bettingRecords([bet("2026-11-01", "won"), parlay, bet("2026-11-03", "lost", 25)]);
    expect(r.biggestWin).toBe(35);
    expect(r.biggestLoss).toBe(-25);
    expect(r.singles).toEqual({ won: 1, lost: 1, net: -15 });
    expect(r.parlays).toEqual({ won: 1, lost: 0, net: 35 });
  });
});
