import type { Strategy } from "./strategy";

export type Answers = Record<string, string[]>;

export interface Question {
  id: string;
  title: string;
  hint?: string;
  multiple?: boolean;
  options: { value: string; label: string; detail?: string }[];
}

export const QUESTIONS: Question[] = [
  {
    id: "leagues",
    title: "What do you want to bet on?",
    hint: "Choose as many as you like. Each one adds to the cost of every odds refresh.",
    multiple: true,
    options: [
      { value: "soccer_top", label: "Top soccer leagues", detail: "England, Spain, Italy, Germany, France" },
      { value: "soccer_europe", label: "European soccer cups", detail: "Champions, Europa, Conference" },
      { value: "nba", label: "NBA" },
      { value: "euroleague", label: "EuroLeague basketball" },
      { value: "tennis", label: "Tennis", detail: "Whichever tournaments are on" },
      { value: "nhl", label: "NHL" },
      { value: "nfl", label: "NFL" },
    ],
  },
  {
    id: "goal",
    title: "What are you after?",
    options: [
      { value: "steady", label: "Win often", detail: "Shorter odds and smaller wins" },
      { value: "balanced", label: "A balance" },
      { value: "payouts", label: "Bigger payouts", detail: "Longer odds and more losing bets" },
    ],
  },
  {
    id: "risk",
    title: "You lose 10 bets in a row. How do you feel?",
    hint: "It will happen eventually, so this sets your stake sizes.",
    options: [
      { value: "low", label: "I'd want to stop", detail: "Very small stakes" },
      { value: "medium", label: "Annoyed, but it's expected", detail: "Small stakes" },
      { value: "high", label: "It doesn't bother me", detail: "Larger stakes, still capped" },
    ],
  },
  {
    id: "bankroll",
    title: "How much money is set aside for betting?",
    hint: "Only count money you could lose completely. You can enter an exact amount later.",
    options: [
      { value: "50", label: "Under €100" },
      { value: "250", label: "€100 to €500" },
      { value: "1000", label: "€500 to €2,000" },
      { value: "3000", label: "Over €2,000" },
    ],
  },
  {
    id: "style",
    title: "Singles or parlays?",
    options: [
      { value: "singles", label: "Singles only" },
      { value: "mix", label: "Mostly singles, some parlays" },
      { value: "parlays", label: "I like parlays", detail: "They cost more in margin" },
    ],
  },
  {
    id: "markets",
    title: "Which bet types do you want?",
    hint: "Each one adds to the cost of every odds refresh.",
    multiple: true,
    options: [
      { value: "h2h", label: "Match winner" },
      { value: "totals", label: "Over/under totals" },
      { value: "spreads", label: "Spreads and handicaps" },
    ],
  },
  {
    id: "volume",
    title: "How many bets do you want to see at a time?",
    options: [
      { value: "few", label: "Just the best few" },
      { value: "some", label: "A moderate list" },
      { value: "many", label: "As many as qualify" },
    ],
  },
  {
    id: "timing",
    title: "How far ahead do you usually bet?",
    options: [
      { value: "24", label: "Same day", detail: "Within 24 hours" },
      { value: "72", label: "A few days ahead" },
      { value: "168", label: "Up to a week ahead" },
    ],
  },
  {
    id: "trust",
    title: "When Claude disagrees with the market, who do you trust?",
    hint: "The market is hard to beat, and Claude's record here is still unproven.",
    options: [
      { value: "market", label: "Mostly the market" },
      { value: "balanced", label: "Give Claude some say" },
      { value: "claude", label: "Give Claude more say", detail: "Still capped" },
    ],
  },
  {
    id: "research",
    title: "How much AI research should each run do?",
    options: [
      { value: "3", label: "A little", detail: "3 games, about $0.75" },
      { value: "5", label: "Normal", detail: "5 games, about $1.25" },
      { value: "10", label: "A lot", detail: "10 games, about $2.50" },
    ],
  },
  {
    id: "region",
    title: "Where do you bet?",
    hint: "This sets which bookmakers are checked. You can select your exact books later.",
    options: [
      { value: "eu", label: "Europe" },
      { value: "uk", label: "UK" },
      { value: "us", label: "USA" },
      { value: "au", label: "Australia" },
    ],
  },
];

export const isComplete = (answers: Answers) => QUESTIONS.every((q) => (answers[q.id]?.length ?? 0) > 0);

const LEAGUES: Record<string, string[]> = {
  soccer_top: ["soccer_epl", "soccer_spain_la_liga", "soccer_italy_serie_a", "soccer_germany_bundesliga", "soccer_france_ligue_one"],
  soccer_europe: ["soccer_uefa_champs_league", "soccer_uefa_europa_league", "soccer_uefa_europa_conference_league"],
  nba: ["basketball_nba"],
  euroleague: ["basketball_euroleague"],
  nhl: ["icehockey_nhl"],
  nfl: ["americanfootball_nfl"],
};

export function sportsFor(picked: string[], available: string[]) {
  const wanted = picked.flatMap((p) => (p === "tennis" ? available.filter((k) => k.startsWith("tennis_")) : (LEAGUES[p] ?? [])));
  return [...new Set(wanted)].filter((k) => available.length === 0 || available.includes(k));
}

const first = (answers: Answers, id: string) => answers[id]?.[0];

/** Turns answers into settings by fixed rules. Claude can then refine, within limits. */
export function strategyFromAnswers(
  answers: Answers,
  base: Strategy,
  availableSports: string[],
): { strategy: Strategy; warnings: string[] } {
  const warnings: string[] = [];
  const goal = first(answers, "goal");
  const risk = first(answers, "risk");
  const style = first(answers, "style");
  const volume = first(answers, "volume");
  const trust = first(answers, "trust");
  const region = (first(answers, "region") ?? "eu") as Strategy["regions"][number];
  const games = Number(first(answers, "research") ?? 5);

  let sports = sportsFor(answers.leagues ?? [], availableSports);
  if (!sports.length) {
    sports = base.sports;
    warnings.push("None of the leagues you chose have games right now, so your current leagues were kept.");
  }

  const odds = goal === "steady"
    ? { minOdds: 1.25, maxOdds: 2.2, minEvPct: 1, rankBy: "probability" as const }
    : goal === "payouts"
      ? { minOdds: 1.8, maxOdds: 8, minEvPct: 2, rankBy: "ev" as const }
      : { minOdds: 1.4, maxOdds: 4, minEvPct: 1.5, rankBy: "ev" as const };

  const stakes = risk === "low"
    ? { kellyFraction: 0.1, maxStakePct: 1, parlayKelly: 0.05, parlayMax: 0.25 }
    : risk === "high"
      ? { kellyFraction: 0.35, maxStakePct: 3, parlayKelly: 0.15, parlayMax: 1 }
      : { kellyFraction: 0.25, maxStakePct: 2, parlayKelly: 0.1, parlayMax: 0.5 };

  const parlayOdds = goal === "steady"
    ? { legMinOdds: 1.2, legMaxOdds: 1.7, minCombinedOdds: 1.8, maxCombinedOdds: 6, minHitProbPct: 20 }
    : goal === "payouts"
      ? { legMinOdds: 1.6, legMaxOdds: 4, minCombinedOdds: 8, maxCombinedOdds: 60, minHitProbPct: 2 }
      : { legMinOdds: 1.3, legMaxOdds: 3, minCombinedOdds: 2.5, maxCombinedOdds: 12, minHitProbPct: 8 };

  const counts = volume === "few"
    ? { maxPicks: 5, picksCount: 2 }
    : volume === "many"
      ? { maxPicks: 40, picksCount: 8 }
      : { maxPicks: 15, picksCount: 5 };

  const influence = trust === "market"
    ? { aiWeightPct: 15, maxAdjustmentPts: 2 }
    : trust === "claude"
      ? { aiWeightPct: 50, maxAdjustmentPts: 5 }
      : { aiWeightPct: 30, maxAdjustmentPts: 3 };

  // The sharpest reference books are listed in the European and UK regions.
  const sharpRegion = region === "eu" || region === "uk";
  const markets = (answers.markets?.length ? answers.markets : ["h2h"]) as Strategy["markets"];

  const strategy: Strategy = {
    ...base,
    sports,
    regions: [region],
    markets,
    fairSource: sharpRegion ? "sharp" : "consensus",
    minReferenceBooks: sharpRegion ? 1 : 4,
    minHoursAhead: 0,
    maxHoursAhead: Number(first(answers, "timing") ?? 72),
    minOdds: odds.minOdds,
    maxOdds: odds.maxOdds,
    minEvPct: odds.minEvPct,
    rankBy: odds.rankBy,
    maxPicks: counts.maxPicks,
    bankroll: Number(first(answers, "bankroll") ?? base.bankroll),
    kellyFraction: stakes.kellyFraction,
    maxStakePct: stakes.maxStakePct,
    parlay: {
      ...base.parlay,
      ...parlayOdds,
      enabled: style !== "singles",
      minLegs: goal === "payouts" ? 3 : 2,
      maxLegs: style === "parlays" ? 4 : 3,
      count: style === "parlays" ? 10 : 5,
      kellyFraction: stakes.parlayKelly,
      maxStakePct: stakes.parlayMax,
    },
    ai: {
      ...base.ai,
      ...influence,
      picksCount: counts.picksCount,
      gamesToResearch: games,
      maxSearches: games * 3,
    },
    answers,
  };

  const credits = sports.length * markets.length;
  if (credits > 24) {
    warnings.push(`Each odds refresh will cost up to ${credits} credits. Fewer leagues or bet types would make your monthly credits last longer.`);
  }
  if (risk === "high" && style === "parlays") {
    warnings.push("Larger stakes plus parlays means bigger swings. Expect long losing runs.");
  }
  return { strategy, warnings };
}

export interface StrategyTweaks {
  name: string;
  description: string;
  instructions: string;
  minEvPct: number;
  minOdds: number;
  maxOdds: number;
  maxPicks: number;
  kellyFraction: number;
  maxStakePct: number;
}

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** Shortens text at a sentence or word, so it never stops mid-word. */
export function shorten(text: string, limit: number) {
  const t = text.trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit - 1);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > limit / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(" ");
  return `${word > 0 ? cut.slice(0, word) : cut}…`;
}

/**
 * Applies Claude's refinements inside fixed limits. Stakes can only go down from what
 * the answers set, so nothing written in the notes can raise the risk.
 */
export function applyTweaks(base: Strategy, t: StrategyTweaks): Strategy {
  const minOdds = clamp(t.minOdds, Math.max(1.2, base.minOdds - 0.3), base.minOdds + 0.7);
  const maxOdds = clamp(t.maxOdds, Math.max(1.5, base.maxOdds * 0.6), base.maxOdds * 1.5);
  const oddsValid = Number.isFinite(minOdds) && Number.isFinite(maxOdds) && minOdds + 0.15 < maxOdds;
  return {
    ...base,
    name: shorten(t.name, 60) || base.name,
    description: shorten(t.description, 240),
    minEvPct: clamp(t.minEvPct, Math.max(0.5, base.minEvPct - 0.5), base.minEvPct + 2),
    minOdds: oddsValid ? minOdds : base.minOdds,
    maxOdds: oddsValid ? maxOdds : base.maxOdds,
    maxPicks: Math.round(clamp(t.maxPicks, 1, base.maxPicks)),
    kellyFraction: clamp(t.kellyFraction, 0.01, base.kellyFraction),
    maxStakePct: clamp(t.maxStakePct, 0.1, base.maxStakePct),
    ai: { ...base.ai, instructions: t.instructions.trim().slice(0, 4000) },
  };
}
