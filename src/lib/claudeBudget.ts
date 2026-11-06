import { z } from "zod";

/** The balance you last typed in, and what Edgebook estimates it has spent since. */
export interface ClaudeBudget {
  balanceUsd: number;
  setAt: string;
  spentUsd: number;
}

export const BalanceSchema = z.object({ balanceUsd: z.number().min(0).max(100_000) });

export const newBudget = (balanceUsd: number, now = new Date().toISOString()): ClaudeBudget => ({ balanceUsd, setAt: now, spentUsd: 0 });

/** Spending only counts once a balance has been entered, and bad numbers never change it. */
export function addSpend(budget: ClaudeBudget | undefined, costUsd: number): ClaudeBudget | undefined {
  if (!budget || !Number.isFinite(costUsd) || costUsd <= 0) return budget;
  return { ...budget, spentUsd: budget.spentUsd + costUsd };
}

export const claudeLeft = (budget: ClaudeBudget) => Math.max(0, budget.balanceUsd - budget.spentUsd);
