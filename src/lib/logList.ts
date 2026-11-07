import type { MarketKey } from "./types";

export interface LogLeg {
  home: string;
  away: string;
  /** Local time as YYYY-MM-DDTHH:mm, or null when the line had none. */
  commence: string | null;
  market: MarketKey;
  selection: string;
  point?: number;
  label: string;
  price: number;
  chance?: number;
  strength?: number;
}

export interface LogBet {
  legs: LogLeg[];
  odds: number;
  stake: number;
}

/** Drops a list bullet or number at the start of a line, such as "- " or "2. ". */
const unbullet = (line: string) => line.replace(/^(?:[-*•]|\d+[.)])\s+/, "");
const number = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[€$£%x@\s]/gi, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function splitTeams(text: string): [string, string] | null {
  const parts = text.split(/\s+(?:vs\.?|v\.?|-|–)\s+/i);
  return parts.length === 2 && parts[0].trim() && parts[1].trim() ? [parts[0].trim(), parts[1].trim()] : null;
}

/** Reads "2026-11-08 17:30" or "08.11.2026 17:30" into local YYYY-MM-DDTHH:mm. */
export function parseKickoff(text: string): string | null {
  const t = text.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}`;
  m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})[ ,]+(\d{1,2}):(\d{2})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}`;
  return null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Works out the market from the bet's wording, so standard bets can still be settled from scores. */
export function classifyBet(text: string, home: string, away: string): Pick<LogLeg, "market" | "selection" | "point" | "label"> {
  const t = text.trim();
  if (/^draw$/i.test(t)) return { market: "h2h", selection: "Draw", label: "Draw" };
  const win = t.match(/^(.+?)\s+to win$/i);
  if (win) {
    const team = [home, away].find((x) => same(x, win[1]));
    if (team) return { market: "h2h", selection: team, label: `${team} to win` };
  }
  const total = t.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
  if (total) {
    const side = total[1].toLowerCase() === "over" ? "Over" : "Under";
    return { market: "totals", selection: side, point: Number(total[2]), label: `${side} ${total[2]}` };
  }
  const spread = t.match(/^(.+?)\s+([+-]\d+(?:\.\d+)?)$/);
  if (spread) {
    const team = [home, away].find((x) => same(x, spread[1]));
    const point = Number(spread[2]);
    if (team && Math.abs(point * 2 - Math.round(point * 2)) < 1e-9) {
      return { market: "spreads", selection: team, point, label: `${team} ${point > 0 ? "+" : ""}${point}` };
    }
  }
  return { market: "other", selection: t.slice(0, 120), label: t.slice(0, 120) };
}

/** Parses "Home vs Away | kickoff | bet | odds" plus the extra fields that follow. */
function parseLeg(fields: string[], withStake: boolean, line: string): { leg: LogLeg; stake: number | null } | string {
  const teams = splitTeams(fields[0] ?? "");
  if (!teams) return `Couldn't find two teams in: ${line}`;
  const bet = (fields[2] ?? "").trim();
  if (!bet) return `No bet given in: ${line}`;
  const price = number(fields[3]);
  if (price === null || price <= 1) return `No usable odds in: ${line}`;
  const extra = fields.slice(withStake ? 5 : 4);
  const stake = withStake ? number(fields[4]) : null;
  const chance = number(extra[0]);
  const strength = number(extra[1]?.split("/")[0]);
  return {
    leg: {
      home: teams[0],
      away: teams[1],
      commence: parseKickoff(fields[1] ?? ""),
      ...classifyBet(bet, teams[0], teams[1]),
      price,
      ...(chance !== null && chance > 0 && chance < 100 ? { chance: chance / 100 } : {}),
      ...(strength !== null && strength >= 1 && strength <= 10 ? { strength: Math.round(strength) } : {}),
    },
    stake,
  };
}

/**
 * Reads the chat's log list. A single is one line. A parlay is a "PARLAY | total odds | stake"
 * line followed by its legs, each starting with "+". Anything else is skipped and reported.
 */
export function parseLogList(text: string): { bets: LogBet[]; problems: string[] } {
  const bets: LogBet[] = [];
  const problems: string[] = [];
  let parlay: LogBet | null = null;

  const closeParlay = () => {
    if (!parlay) return;
    if (parlay.legs.length >= 2) bets.push(parlay);
    else problems.push("A parlay had fewer than 2 legs, so it was skipped.");
    parlay = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = unbullet(raw.trim());
    if (!line.includes("|")) continue; // Headings and notes around the list.
    const isLeg = /^\+/.test(line);
    const fields = (isLeg ? line.slice(1) : line).split("|").map((f) => f.trim());

    if (/^parlay$/i.test(fields[0] ?? "")) {
      closeParlay();
      const odds = number(fields[1]);
      const stake = number(fields[2]);
      if (odds === null || odds <= 1 || stake === null || stake <= 0) {
        problems.push(`Couldn't read the odds and stake in: ${line}`);
        continue;
      }
      parlay = { legs: [], odds, stake };
      continue;
    }

    if (isLeg) {
      if (!parlay) {
        problems.push(`A parlay leg had no PARLAY line above it: ${line}`);
        continue;
      }
      const parsed = parseLeg(fields, false, line);
      if (typeof parsed === "string") problems.push(parsed);
      else (parlay as LogBet).legs.push(parsed.leg);
      continue;
    }

    closeParlay();
    if (/^home\b/i.test(fields[0] ?? "")) continue; // The format line itself.
    const parsed = parseLeg(fields, true, line);
    if (typeof parsed === "string") {
      problems.push(parsed);
      continue;
    }
    if (parsed.stake === null || parsed.stake <= 0) {
      problems.push(`No stake given in: ${line}`);
      continue;
    }
    bets.push({ legs: [parsed.leg], odds: parsed.leg.price, stake: parsed.stake });
  }
  closeParlay();
  return { bets, problems };
}
