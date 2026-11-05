import type { Bet, BetLeg, LegResult } from "../types";

export interface FinalScore { home: number; away: number }

/** Grades a leg from the final score. Returns "pending" if it can't tell. */
export function gradeLeg(leg: BetLeg, score: FinalScore): LegResult {
  const { home, away } = score;
  if (leg.market === "h2h") {
    if (leg.selection === "Draw") return home === away ? "won" : "lost";
    if (home === away) return "lost";
    const winner = home > away ? leg.home : leg.away;
    return leg.selection === winner ? "won" : "lost";
  }
  if (leg.point === undefined) return "pending";
  if (leg.market === "totals") {
    const total = home + away;
    if (total === leg.point) return "push";
    if (leg.selection === "Over") return total > leg.point ? "won" : "lost";
    if (leg.selection === "Under") return total < leg.point ? "won" : "lost";
    return "pending";
  }
  const own = leg.selection === leg.home ? home : leg.selection === leg.away ? away : null;
  if (own === null) return "pending";
  const other = leg.selection === leg.home ? away : home;
  const margin = own + leg.point - other;
  return margin === 0 ? "push" : margin > 0 ? "won" : "lost";
}

/** Recomputes a bet's status from its legs. A pushed leg drops out of a parlay. */
export function applyLegResults(bet: Bet, now = new Date().toISOString()): Bet {
  const results = bet.legs.map((l) => l.result);
  let status: Bet["status"];
  let returned = 0;
  if (results.includes("lost")) {
    status = "lost";
  } else if (results.includes("pending")) {
    status = "pending";
  } else if (results.every((r) => r === "push")) {
    status = "push";
    returned = bet.stake;
  } else {
    status = "won";
    const pushedPrice = bet.legs
      .filter((l) => l.result === "push")
      .reduce((a, l) => a * l.price, 1);
    returned = Math.round((bet.stake * bet.odds * 100) / pushedPrice) / 100;
  }
  return { ...bet, status, returned, settledAt: status === "pending" ? undefined : (bet.settledAt ?? now) };
}

export const profit = (b: Bet) => (b.status === "pending" ? 0 : b.returned - b.stake);

/** Value against the closing line: above 0 means the bet beat the final fair price. */
export function closingValue(bet: Bet): number | null {
  if (bet.legs.some((l) => l.closingProb === undefined)) return null;
  return bet.legs.reduce((a, l) => a * l.closingProb!, 1) * bet.odds - 1;
}

export function ledgerStats(bets: Bet[]) {
  const settled = bets.filter((b) => b.status !== "pending");
  const open = bets.filter((b) => b.status === "pending");
  const staked = settled.reduce((a, b) => a + b.stake, 0);
  const net = settled.reduce((a, b) => a + profit(b), 0);
  const decided = settled.filter((b) => b.status !== "push");
  const clvs = settled.map(closingValue).filter((x): x is number => x !== null);
  return {
    settled: settled.length,
    open: open.length,
    exposure: open.reduce((a, b) => a + b.stake, 0),
    staked,
    net,
    expected: settled.reduce((a, b) => a + b.stake * b.evAtPlacement, 0),
    roi: staked ? net / staked : null,
    hitRate: decided.length ? decided.filter((b) => b.status === "won").length / decided.length : null,
    avgClv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
    clvCount: clvs.length,
  };
}
