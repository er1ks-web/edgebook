import { describe, expect, it } from "vitest";
import { BackupSchema, createBackup, restoreBackup } from "./backup";
import type { AppState } from "./store";
import { PRESETS } from "./strategy";
import type { Bet } from "./types";

const bet = (id: string, over: Partial<Bet> = {}): Bet => ({
  id,
  placedAt: "2026-11-05T17:00:00.000Z",
  kind: "single",
  book: "x",
  bookTitle: "X",
  strategyId: "s",
  strategyName: "S",
  stake: 5,
  odds: 2,
  evAtPlacement: 0,
  legs: [{
    key: "k", eventId: "e", sportKey: "soccer_epl", sportTitle: "EPL", commence: "2026-11-05T17:45:00.000Z",
    home: "H", away: "A", market: "h2h", selection: "H", label: "H to win", price: 2, prob: 0, result: "pending",
  }],
  status: "pending",
  returned: 0,
  demo: false,
  ...over,
});

const state = (over: Partial<AppState> = {}): AppState => ({
  strategies: PRESETS.map((s) => ({ ...s })),
  bets: [],
  reviews: {},
  quota: { remaining: 400, used: 100 },
  ...over,
});

const roundTrip = (s: AppState) => BackupSchema.parse(JSON.parse(JSON.stringify(createBackup(s))));

describe("backup and restore", () => {
  it("moves bets and strategies to an empty app with every field intact", () => {
    const paper = bet("b", { paper: true, legs: [{ ...bet("x").legs[0], closingProb: 0.5, handSettle: true }] });
    const source = state({ bets: [bet("a", { manual: true }), paper] });
    source.strategies[0] = { ...source.strategies[0], name: "Mine", minEvPct: 3 };

    const target = state();
    const result = restoreBackup(target, roundTrip(source));

    expect(result).toMatchObject({ betsAdded: 2, betsAlreadyThere: 0, strategiesUpdated: 1 });
    expect(target.bets).toEqual(source.bets);
    expect(target.strategies[0]).toMatchObject({ name: "Mine", minEvPct: 3 });
  });

  it("is safe to restore twice", () => {
    const backup = roundTrip(state({ bets: [bet("a")] }));
    const target = state();
    restoreBackup(target, backup);
    expect(restoreBackup(target, backup)).toEqual({ betsAdded: 0, betsAlreadyThere: 1, strategiesAdded: 0, strategiesUpdated: 0 });
    expect(target.bets).toHaveLength(1);
  });

  it("never deletes bets that only exist on the target", () => {
    const target = state({ bets: [bet("phone")] });
    restoreBackup(target, roundTrip(state({ bets: [bet("computer")] })));
    expect(target.bets.map((b) => b.id).sort()).toEqual(["computer", "phone"]);
  });

  it("keeps a result settled after the backup was made", () => {
    const target = state({ bets: [bet("a", { status: "won", returned: 10 })] });
    restoreBackup(target, roundTrip(state({ bets: [bet("a")] })));
    expect(target.bets[0]).toMatchObject({ status: "won", returned: 10 });
  });

  it("adds new strategies and clears a stale AI review", () => {
    const source = state();
    source.strategies.push({ ...PRESETS[0], id: "new-one", name: "New" });
    source.strategies[0] = { ...source.strategies[0], minEvPct: 9 };
    const review = { at: "", notes: "", costUsd: 0, model: "", items: {} };
    const target = state({ reviews: { [PRESETS[0].id]: review } });
    expect(restoreBackup(target, roundTrip(source))).toMatchObject({ strategiesAdded: 1, strategiesUpdated: 1 });
    expect(target.reviews[PRESETS[0].id]).toBeUndefined();
  });

  it("leaves out demo bets and carries no secrets", () => {
    const source = state({ bets: [bet("real"), bet("demo", { demo: true })] });
    const backup = createBackup(source);
    expect(backup.bets.map((b) => b.id)).toEqual(["real"]);
    expect(Object.keys(backup).sort()).toEqual(["app", "bets", "exportedAt", "strategies", "version"]);
  });

  it("rejects files that aren't a valid backup", () => {
    const good = createBackup(state({ bets: [bet("a")] }));
    expect(BackupSchema.safeParse({}).success).toBe(false);
    expect(BackupSchema.safeParse({ ...good, app: "other" }).success).toBe(false);
    expect(BackupSchema.safeParse({ ...good, version: 2 }).success).toBe(false);
    expect(BackupSchema.safeParse({ ...good, bets: [{ id: "a" }] }).success).toBe(false);
    expect(BackupSchema.safeParse({ ...good, strategies: [{ id: "x" }] }).success).toBe(false);
  });
});
