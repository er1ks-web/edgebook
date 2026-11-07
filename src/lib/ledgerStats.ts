import { decidedAt, localDay, profit } from "./engine/settle";
import type { Bet, BetLeg, MoneyEntry } from "./types";

/** Real bets only: demo and paper bets never count toward your results. */
export const realBets = (bets: Bet[]) => bets.filter((b) => !b.demo && !b.paper);

const settledOnly = (bets: Bet[]) => bets.filter((b) => b.status !== "pending");

/** A readable bet type, worked out from the market or the bet's own wording. */
export function legCategory(leg: Pick<BetLeg, "market" | "label" | "selection">): string {
  if (leg.market === "h2h") return "Match result";
  if (leg.market === "totals") return "Over/under";
  if (leg.market === "spreads") return "Handicap";
  const text = `${leg.label} ${leg.selection}`.toLowerCase();
  if (/both teams|btts/.test(text)) return "Both teams to score";
  if (/draw no bet|\bdnb\b/.test(text)) return "Draw no bet";
  if (/double chance| or draw|\bor\b.+\bor\b/.test(text) || / or /.test(text)) return "Double chance";
  if (/corner/.test(text)) return "Corners";
  if (/card|booking/.test(text)) return "Cards";
  if (/to score|scorer|goalscorer/.test(text)) return "Player to score";
  if (/over|under/.test(text)) return "Other over/under";
  return "Other";
}

export const betCategory = (bet: Bet) => (bet.kind === "parlay" ? "Parlay" : legCategory(bet.legs[0]));

const ODDS_BANDS: [number, string][] = [[1.5, "Under 1.50"], [2, "1.50 to 1.99"], [3, "2.00 to 2.99"], [5, "3.00 to 4.99"]];
export const oddsBand = (odds: number) => ODDS_BANDS.find(([limit]) => odds < limit)?.[1] ?? "5.00 and up";

export type Dimension = "type" | "league" | "book" | "odds" | "strategy" | "tag";

const league = (leg: BetLeg) => (leg.sportKey === "manual" || !leg.sportTitle || leg.sportTitle === "Added by hand" ? "League not set" : leg.sportTitle);

export const DIMENSIONS: Record<Dimension, { label: string; keys: (b: Bet) => string[] }> = {
  type: { label: "Bet type", keys: (b) => [betCategory(b)] },
  league: { label: "League", keys: (b) => (b.kind === "parlay" ? ["Parlay"] : [league(b.legs[0])]) },
  book: { label: "Bookmaker", keys: (b) => [b.bookTitle || "Not set"] },
  odds: { label: "Odds", keys: (b) => [oddsBand(b.odds)] },
  strategy: { label: "Strategy", keys: (b) => [b.strategyName || "Not set"] },
  tag: { label: "Tag", keys: (b) => (b.tags?.length ? b.tags : ["No tag"]) },
};

export interface BreakdownRow {
  key: string;
  settled: number;
  won: number;
  lost: number;
  staked: number;
  profit: number;
  roi: number | null;
  hitRate: number | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;

function summarize(key: string, bets: Bet[]): BreakdownRow {
  const won = bets.filter((b) => b.status === "won").length;
  const lost = bets.filter((b) => b.status === "lost").length;
  const staked = bets.reduce((a, b) => a + b.stake, 0);
  const net = bets.reduce((a, b) => a + profit(b), 0);
  return {
    key,
    settled: bets.length,
    won,
    lost,
    staked: cents(staked),
    profit: cents(net),
    roi: staked ? net / staked : null,
    hitRate: won + lost ? won / (won + lost) : null,
  };
}

/** Results split one way, most bets first. A bet with several tags counts under each. */
export function breakdown(bets: Bet[], dimension: Dimension): BreakdownRow[] {
  const groups = new Map<string, Bet[]>();
  for (const bet of settledOnly(bets)) {
    for (const key of DIMENSIONS[dimension].keys(bet)) groups.set(key, [...(groups.get(key) ?? []), bet]);
  }
  return [...groups].map(([key, list]) => summarize(key, list)).sort((a, b) => b.settled - a.settled || b.profit - a.profit);
}

/** The chat's chance that the whole bet wins, when every leg has one. */
export function betChance(bet: Bet): number | null {
  if (bet.legs.some((l) => l.chance === undefined)) return null;
  return bet.legs.reduce((a, l) => a * l.chance!, 1);
}

/** A parlay is only as strong as its weakest leg. */
export function betStrength(bet: Bet): number | null {
  if (bet.legs.some((l) => l.strength === undefined)) return null;
  return Math.min(...bet.legs.map((l) => l.strength!));
}

export interface CalibrationRow {
  band: string;
  bets: number;
  /** Wins the chat's chances added up to. */
  expected: number;
  won: number;
  predicted: number;
  actual: number;
}

const CHANCE_BANDS: [number, string][] = [[0.4, "Under 40%"], [0.5, "40 to 49%"], [0.6, "50 to 59%"], [0.7, "60 to 69%"], [0.8, "70 to 79%"]];

/** Compares the chat's stated chances with how often those bets really won. Pushes are left out. */
export function calibration(bets: Bet[]): CalibrationRow[] {
  const rows = new Map<string, { chances: number[]; won: number }>();
  for (const bet of bets) {
    const chance = betChance(bet);
    if (chance === null || (bet.status !== "won" && bet.status !== "lost")) continue;
    const band = CHANCE_BANDS.find(([limit]) => chance < limit)?.[1] ?? "80% and up";
    const row = rows.get(band) ?? { chances: [], won: 0 };
    row.chances.push(chance);
    if (bet.status === "won") row.won++;
    rows.set(band, row);
  }
  const order = [...CHANCE_BANDS.map(([, b]) => b), "80% and up"];
  return order.flatMap((band) => {
    const row = rows.get(band);
    if (!row) return [];
    const expected = row.chances.reduce((a, c) => a + c, 0);
    return [{ band, bets: row.chances.length, expected, won: row.won, predicted: expected / row.chances.length, actual: row.won / row.chances.length }];
  });
}

const STRENGTH_BANDS: [number, string][] = [[5, "1 to 4"], [7, "5 to 6"], [8, "7"]];

/** Whether stronger-rated picks actually did better. */
export function byStrength(bets: Bet[]): BreakdownRow[] {
  const groups = new Map<string, Bet[]>();
  for (const bet of settledOnly(bets)) {
    const strength = betStrength(bet);
    if (strength === null) continue;
    const band = STRENGTH_BANDS.find(([limit]) => strength < limit)?.[1] ?? "8 to 10";
    groups.set(band, [...(groups.get(band) ?? []), bet]);
  }
  const order = [...STRENGTH_BANDS.map(([, b]) => b), "8 to 10"];
  return order.flatMap((band) => (groups.has(band) ? [summarize(band, groups.get(band)!)] : []));
}

/** Most games are over within this long of kickoff. */
const GAME_LENGTH_MS = 3 * 3_600_000;

/** Open bets with a leg whose game should be finished, so it's waiting for you to mark it. */
export const needsResult = (bets: Bet[], now = Date.now()) =>
  bets.filter((b) => b.status === "pending" && b.legs.some((l) => l.result === "pending" && Date.parse(l.commence) + GAME_LENGTH_MS < now));

/** Start of the week, Monday, in the viewer's time zone. */
function weekStart(now: number) {
  const d = new Date(now);
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

/** Money staked today and this week, by when each bet was placed. */
export function stakeTotals(bets: Bet[], now = Date.now()) {
  const today = localDay(now);
  const week = weekStart(now);
  let day = 0;
  let weekTotal = 0;
  for (const b of bets) {
    const at = Date.parse(b.placedAt);
    if (localDay(at) === today) day += b.stake;
    if (at >= week && at <= now) weekTotal += b.stake;
  }
  return { today: cents(day), week: cents(weekTotal) };
}

const CHASE_RATIO = 1.5;
const CHASE_WINDOW_MS = 48 * 3_600_000;
const CHASE_LOSSES = 2;
const CHASE_HISTORY = 5;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Spots stakes that rose after a losing run: a recent bet staked well above your usual,
 * placed right after two or more losses in a row. That's the usual sign of chasing losses.
 */
export function chasingWarning(bets: Bet[], now = Date.now()): { stake: number; usual: number; losses: number } | null {
  const ordered = [...bets].sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const recent = ordered.filter((b) => now - Date.parse(b.placedAt) <= CHASE_WINDOW_MS);
  const earlier = ordered.filter((b) => now - Date.parse(b.placedAt) > CHASE_WINDOW_MS);
  if (earlier.length < CHASE_HISTORY || !recent.length) return null;
  const usual = median(earlier.map((b) => b.stake));

  for (const bet of recent) {
    if (bet.stake <= usual * CHASE_RATIO) continue;
    const placed = Date.parse(bet.placedAt);
    const before = ordered
      .filter((b) => b !== bet && (b.status === "won" || b.status === "lost") && decidedAt(b) < placed)
      .sort((a, b) => decidedAt(b) - decidedAt(a));
    let losses = 0;
    for (const b of before) {
      if (b.status !== "lost") break;
      losses++;
    }
    if (losses >= CHASE_LOSSES) return { stake: bet.stake, usual: cents(usual), losses };
  }
  return null;
}

/** What you put in and took out, your betting result, and what's left after costs. */
export function bankrollSummary(bets: Bet[], entries: MoneyEntry[]) {
  const sum = (kind: MoneyEntry["kind"]) => cents(entries.filter((e) => e.kind === kind).reduce((a, e) => a + e.amount, 0));
  const deposits = sum("deposit");
  const withdrawals = sum("withdrawal");
  const costs = sum("cost");
  const betting = cents(settledOnly(bets).reduce((a, b) => a + profit(b), 0));
  const open = cents(bets.filter((b) => b.status === "pending").reduce((a, b) => a + b.stake, 0));
  const balance = cents(deposits - withdrawals + betting - open);
  return { deposits, withdrawals, costs, betting, open, balance, afterCosts: cents(betting - costs) };
}

export interface MonthRow { month: string; bets: number; profit: number; costs: number; net: number }

/** Betting profit and costs by calendar month, newest first. */
export function monthly(bets: Bet[], entries: MoneyEntry[]): MonthRow[] {
  const months = new Map<string, MonthRow>();
  const row = (month: string) => months.get(month) ?? { month, bets: 0, profit: 0, costs: 0, net: 0 };
  for (const bet of settledOnly(bets)) {
    const month = localDay(decidedAt(bet)).slice(0, 7);
    const r = row(month);
    months.set(month, { ...r, bets: r.bets + 1, profit: cents(r.profit + profit(bet)) });
  }
  for (const e of entries.filter((x) => x.kind === "cost")) {
    const month = localDay(Date.parse(e.at)).slice(0, 7);
    const r = row(month);
    months.set(month, { ...r, costs: cents(r.costs + e.amount) });
  }
  return [...months.values()].map((r) => ({ ...r, net: cents(r.profit - r.costs) })).sort((a, b) => b.month.localeCompare(a.month));
}

const pctText = (n: number | null) => (n === null ? "n/a" : `${n > 0 ? "+" : ""}${Math.round(n * 100)}%`);
const MIN_FOR_RECORD = 5;

/** A short summary of your results for the research prompt, or null with too few bets. */
export function recordSummary(bets: Bet[]): string | null {
  const settled = settledOnly(bets);
  if (settled.length < MIN_FOR_RECORD) return null;
  const all = summarize("All", settled);
  const lines = [
    `Overall: ${all.settled} settled bets, ${all.won} won and ${all.lost} lost, return on stakes ${pctText(all.roi)}.`,
    ...breakdown(bets, "type")
      .filter((r) => r.settled >= MIN_FOR_RECORD)
      .map((r) => `${r.key}: ${r.settled} bets, won ${r.won}, return ${pctText(r.roi)}.`),
  ];
  return lines.join("\n");
}

const csvCell = (v: string | number | null | undefined) => {
  const text = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Every bet as a spreadsheet file, one row per bet. */
export function toCsv(bets: Bet[]): string {
  const header = ["Placed", "Type", "Bookmaker", "Bets", "Games", "Kickoff", "Bet type", "Odds", "Stake", "Result", "Returned", "Profit", "Chat chance", "Strength", "Tags", "Note"];
  const rows = [...bets]
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt))
    .map((b) => {
      const chance = betChance(b);
      return [
        b.placedAt,
        b.kind,
        b.bookTitle,
        b.legs.map((l) => l.label).join(" + "),
        b.legs.map((l) => `${l.home} vs ${l.away}`).join(" + "),
        b.legs.map((l) => l.commence).join(" + "),
        betCategory(b),
        b.odds,
        b.stake,
        b.status,
        b.status === "pending" ? null : b.returned,
        b.status === "pending" ? null : cents(profit(b)),
        chance === null ? null : Math.round(chance * 1000) / 10,
        betStrength(b),
        (b.tags ?? []).join("; "),
        b.note ?? "",
      ].map(csvCell).join(",");
    });
  return [header.join(","), ...rows].join("\n");
}
