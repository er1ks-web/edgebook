import { z } from "zod";
import type { AppState } from "./store";
import { StrategySchema, type Strategy } from "./strategy";
import type { Bet, Money } from "./types";

const LegSchema = z.looseObject({
  key: z.string(),
  eventId: z.string(),
  home: z.string(),
  away: z.string(),
  market: z.enum(["h2h", "spreads", "totals", "other"]),
  selection: z.string(),
  label: z.string(),
  price: z.number(),
  result: z.enum(["pending", "won", "lost", "push"]),
});

const BetSchema = z.looseObject({
  id: z.string().min(1),
  placedAt: z.string(),
  kind: z.enum(["single", "parlay"]),
  stake: z.number(),
  odds: z.number(),
  status: z.enum(["pending", "won", "lost", "push"]),
  returned: z.number(),
  demo: z.boolean(),
  legs: z.array(LegSchema).min(1),
});

export const BackupSchema = z.object({
  app: z.literal("edgebook"),
  version: z.literal(1),
  exportedAt: z.string(),
  strategies: z.array(StrategySchema),
  bets: z.array(BetSchema),
  /** Added later, so older backups don't have it. */
  money: z
    .object({
      entries: z.array(z.object({ id: z.string().min(1), at: z.string(), kind: z.enum(["deposit", "withdrawal", "cost"]), amount: z.number(), note: z.string() })),
      limits: z.object({ dailyStake: z.number().nullable(), weeklyStake: z.number().nullable() }),
    })
    .optional(),
});

export type Backup = z.infer<typeof BackupSchema>;

/** Your strategies and real or paper bets. Holds no keys or passwords, and skips demo bets. */
export function createBackup(state: AppState, now = new Date()): Backup {
  return {
    app: "edgebook",
    version: 1,
    exportedAt: now.toISOString(),
    strategies: state.strategies,
    bets: state.bets.filter((b) => !b.demo) as unknown as Backup["bets"],
    ...(state.money ? { money: state.money } : {}),
  };
}

/** Parsing puts settings in one fixed order, so only real differences count as changes. */
const fingerprint = (s: Strategy) => JSON.stringify(StrategySchema.parse(s));

export interface RestoreResult {
  betsAdded: number;
  betsAlreadyThere: number;
  strategiesAdded: number;
  strategiesUpdated: number;
}

/**
 * Adds a backup to the current data. It never deletes anything, and restoring the
 * same file twice changes nothing. A bet already present keeps its current result, in
 * case it was settled after the backup. A strategy with the same id takes the backup's settings.
 */
export function restoreBackup(state: AppState, backup: Backup): RestoreResult {
  const result: RestoreResult = { betsAdded: 0, betsAlreadyThere: 0, strategiesAdded: 0, strategiesUpdated: 0 };

  const existing = new Set(state.bets.map((b) => b.id));
  for (const bet of backup.bets) {
    if (existing.has(bet.id)) {
      result.betsAlreadyThere++;
      continue;
    }
    state.bets.push(bet as unknown as Bet);
    existing.add(bet.id);
    result.betsAdded++;
  }

  if (backup.money) {
    const money: Money = state.money ?? { entries: [], limits: { dailyStake: null, weeklyStake: null } };
    const known = new Set(money.entries.map((e) => e.id));
    for (const entry of backup.money.entries) if (!known.has(entry.id)) money.entries.push(entry);
    // Limits already set here are newer than the backup's, so they stay.
    const unset = money.limits.dailyStake === null && money.limits.weeklyStake === null;
    state.money = { entries: money.entries, limits: unset ? backup.money.limits : money.limits };
  }

  for (const strategy of backup.strategies as Strategy[]) {
    const i = state.strategies.findIndex((s) => s.id === strategy.id);
    if (i < 0) {
      state.strategies.push(strategy);
      result.strategiesAdded++;
    } else if (fingerprint(state.strategies[i]) !== fingerprint(strategy)) {
      state.strategies[i] = strategy;
      // Its settings changed, so an AI review made under the old ones no longer applies.
      delete state.reviews[strategy.id];
      result.strategiesUpdated++;
    }
  }
  return result;
}
