import { describe, expect, it } from "vitest";
import { LOW_TIER_ID, LOW_TIER_LEAGUES, PRESETS, type Strategy, StrategySchema, withLowTierStrategy } from "../strategy";
import { inBatches, MAX_RESEARCH_ALL, researchLimit } from "./aiPicks";

const preset = PRESETS.find((s) => s.id === LOW_TIER_ID)!;
const other = { ...PRESETS[0], id: "mine", bankroll: 120 };

describe("low-tier football strategy", () => {
  it("only covers football, and is a valid strategy", () => {
    expect(LOW_TIER_LEAGUES.every((k) => k.startsWith("soccer_"))).toBe(true);
    expect(new Set(LOW_TIER_LEAGUES).size).toBe(LOW_TIER_LEAGUES.length);
    expect(LOW_TIER_LEAGUES).not.toContain("soccer_epl");
    expect(preset.sports).toEqual(LOW_TIER_LEAGUES);
    expect(() => StrategySchema.parse(preset)).not.toThrow();
  });

  it("is added to an existing app using its bankroll", () => {
    const next = withLowTierStrategy<{ strategies: Strategy[]; lowTierAdded?: boolean }>({ strategies: [other] });
    expect(next.strategies.map((s) => s.id)).toEqual(["mine", LOW_TIER_ID]);
    expect(next.strategies[1].bankroll).toBe(120);
    expect(next.lowTierAdded).toBe(true);
  });

  it("isn't added twice, or brought back after being deleted", () => {
    const once = withLowTierStrategy({ strategies: [other] });
    expect(withLowTierStrategy(once).strategies).toHaveLength(2);
    const deleted = { ...once, strategies: [other] };
    expect(withLowTierStrategy(deleted).strategies).toHaveLength(1);
    expect(withLowTierStrategy({ strategies: PRESETS }).strategies).toHaveLength(PRESETS.length);
  });

  it("defaults older saved strategies to the next few games", () => {
    const { researchAll: _gone, ...ai } = PRESETS[0].ai;
    expect(StrategySchema.parse({ ...PRESETS[0], ai }).ai.researchAll).toBe(false);
  });

  it("limits a run by the strategy's choice", () => {
    expect(researchLimit(preset)).toBe(MAX_RESEARCH_ALL);
    expect(researchLimit({ ...preset, ai: { ...preset.ai, researchAll: false, gamesToResearch: 7 } })).toBe(7);
  });
});

describe("researching in batches", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("splits the work and keeps the order", async () => {
    const results = await inBatches(items, 4, 3, async (b) => b);
    expect(results.map((r) => (r as PromiseFulfilledResult<number[]>).value)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await inBatches(items, 1, 3, async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(3);
  });

  it("keeps going when one group fails", async () => {
    const results = await inBatches(items, 4, 2, async (b) => {
      if (b.includes(5)) throw new Error("boom");
      return b.length;
    });
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("handles nothing to do", async () => {
    expect(await inBatches([], 4, 3, async () => 1)).toEqual([]);
  });
});
