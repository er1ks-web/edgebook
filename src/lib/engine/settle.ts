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

/** When a bet's result was decided: a parlay dies at its first lost leg, otherwise at its last game. */
export function decidedAt(bet: Bet): number {
  const lost = bet.legs.filter((l) => l.result === "lost").map((l) => Date.parse(l.commence));
  return lost.length ? Math.min(...lost) : Math.max(...bet.legs.map((l) => Date.parse(l.commence)));
}

/** Calendar day in the viewer's time zone, as YYYY-MM-DD. */
export function localDay(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DayResult { day: string; net: number; bets: number }
export interface DayRun { length: number; from: string; to: string }

const cents = (n: number) => Math.round(n * 100) / 100;

function kindRecord(bets: Bet[]) {
  return {
    won: bets.filter((b) => b.status === "won").length,
    lost: bets.filter((b) => b.status === "lost").length,
    net: cents(bets.reduce((a, b) => a + profit(b), 0)),
  };
}

/**
 * Streaks and records from settled bets, in the order the games were decided.
 * A push doesn't extend or end a bet streak. A day without bets, or one that
 * breaks exactly even, doesn't extend or end a day streak.
 */
export function bettingRecords(bets: Bet[]) {
  const settled = bets
    .filter((b) => b.status !== "pending")
    .map((bet) => ({ bet, at: decidedAt(bet) }))
    .sort((a, b) => a.at - b.at || a.bet.placedAt.localeCompare(b.bet.placedAt));

  let run = null as { kind: "won" | "lost"; length: number } | null;
  let hottest = 0;
  let coldest = 0;
  const byDay = new Map<string, DayResult>();
  for (const { bet, at } of settled) {
    if (bet.status === "won" || bet.status === "lost") {
      run = run?.kind === bet.status ? { kind: run.kind, length: run.length + 1 } : { kind: bet.status, length: 1 };
      if (run.kind === "won") hottest = Math.max(hottest, run.length);
      else coldest = Math.max(coldest, run.length);
    }
    const key = localDay(at);
    const day = byDay.get(key) ?? { day: key, net: 0, bets: 0 };
    byDay.set(key, { day: key, net: cents(day.net + profit(bet)), bets: day.bets + 1 });
  }

  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const decidedDays = days.filter((d) => d.net !== 0);
  let green = null as DayRun | null;
  let hottestDays = null as DayRun | null;
  let red = 0;
  let coldestDays = 0;
  for (const d of decidedDays) {
    if (d.net > 0) {
      green = green ? { ...green, length: green.length + 1, to: d.day } : { length: 1, from: d.day, to: d.day };
      red = 0;
      if (!hottestDays || green.length >= hottestDays.length) hottestDays = green;
    } else {
      green = null;
      red += 1;
      coldestDays = Math.max(coldestDays, red);
    }
  }

  const byNet = [...decidedDays].sort((a, b) => b.net - a.net);
  const results = settled.map(({ bet }) => cents(profit(bet)));
  const count = (status: Bet["status"]) => settled.filter(({ bet }) => bet.status === status).length;
  const best = byNet[0];
  const worst = byNet[byNet.length - 1];
  const biggestWin = Math.max(0, ...results);
  const biggestLoss = Math.min(0, ...results);
  return {
    won: count("won"),
    lost: count("lost"),
    push: count("push"),
    currentStreak: run,
    hottestStreak: hottest,
    coldestStreak: coldest,
    days,
    greenDays: decidedDays.filter((d) => d.net > 0).length,
    redDays: decidedDays.filter((d) => d.net < 0).length,
    currentGreenDays: green?.length ?? 0,
    currentRedDays: red,
    hottestDays,
    coldestDays,
    bestDay: best && best.net > 0 ? best : null,
    worstDay: worst && worst.net < 0 ? worst : null,
    biggestWin: biggestWin > 0 ? biggestWin : null,
    biggestLoss: biggestLoss < 0 ? biggestLoss : null,
    singles: kindRecord(settled.filter(({ bet }) => bet.kind === "single").map(({ bet }) => bet)),
    parlays: kindRecord(settled.filter(({ bet }) => bet.kind === "parlay").map(({ bet }) => bet)),
  };
}
