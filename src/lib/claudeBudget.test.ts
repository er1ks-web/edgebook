import { describe, expect, it } from "vitest";
import { addSpend, BalanceSchema, claudeLeft, newBudget } from "./claudeBudget";

describe("Claude balance estimate", () => {
  it("subtracts what has been spent since the balance was entered", () => {
    const budget = addSpend(addSpend(newBudget(20), 2.5), 0.5)!;
    expect(budget.spentUsd).toBe(3);
    expect(claudeLeft(budget)).toBe(17);
  });

  it("ignores spending until a balance is entered", () => {
    expect(addSpend(undefined, 5)).toBeUndefined();
  });

  it("ignores amounts that aren't real costs", () => {
    const budget = newBudget(20);
    for (const bad of [0, -1, NaN, Infinity]) expect(addSpend(budget, bad)).toEqual(budget);
  });

  it("never shows less than zero", () => {
    expect(claudeLeft(addSpend(newBudget(1), 3)!)).toBe(0);
  });

  it("starts counting again from a new balance", () => {
    expect(newBudget(8, "2026-11-06T10:00:00.000Z")).toEqual({ balanceUsd: 8, setAt: "2026-11-06T10:00:00.000Z", spentUsd: 0 });
  });

  it("only accepts a sensible balance", () => {
    expect(BalanceSchema.safeParse({ balanceUsd: 0 }).success).toBe(true);
    expect(BalanceSchema.safeParse({ balanceUsd: 25.5 }).success).toBe(true);
    expect(BalanceSchema.safeParse({ balanceUsd: -1 }).success).toBe(false);
    expect(BalanceSchema.safeParse({ balanceUsd: "5" }).success).toBe(false);
  });
});
