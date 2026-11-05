export type DevigMethod = "power" | "multiplicative";

/** Removes the bookmaker margin from a complete set of decimal prices. */
export function devig(prices: number[], method: DevigMethod): number[] {
  const implied = prices.map((p) => 1 / p);
  const total = implied.reduce((a, b) => a + b, 0);
  if (method === "multiplicative" || total <= 1) return implied.map((p) => p / total);

  // Power method: find k so the implied probabilities raised to k sum to 1.
  // It moves more margin onto longshots, matching the favourite-longshot bias.
  let lo = 1;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const sum = implied.reduce((a, p) => a + Math.pow(p, k), 0);
    if (sum > 1) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  const fair = implied.map((p) => Math.pow(p, k));
  const norm = fair.reduce((a, b) => a + b, 0);
  return fair.map((p) => p / norm);
}

export const expectedValue = (prob: number, price: number) => prob * price - 1;

/** Full Kelly fraction of bankroll. Zero when the bet has no edge. */
export function kelly(prob: number, price: number): number {
  if (price <= 1) return 0;
  return Math.max(0, (prob * price - 1) / (price - 1));
}

export function stakeFor(
  prob: number,
  price: number,
  bankroll: number,
  fraction: number,
  maxStakePct: number,
): number {
  const pct = Math.min(kelly(prob, price) * fraction, maxStakePct / 100);
  return Math.floor(bankroll * pct * 100) / 100;
}
