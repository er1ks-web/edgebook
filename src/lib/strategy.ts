import { z } from "zod";

export const StrategySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  description: z.string().max(240),
  /** The questionnaire answers this strategy was last built from. */
  answers: z.record(z.string(), z.array(z.string())).optional(),

  // Where to look
  sports: z.array(z.string()).min(1),
  regions: z.array(z.enum(["eu", "uk", "us", "us2", "au"])).min(1),
  markets: z.array(z.enum(["h2h", "spreads", "totals"])).min(1),
  betBooks: z.array(z.string()), // empty means any book
  minHoursAhead: z.number().min(0),
  maxHoursAhead: z.number().min(1),

  // How fair value is estimated
  fairSource: z.enum(["sharp", "consensus"]),
  devig: z.enum(["power", "multiplicative"]),
  minReferenceBooks: z.number().int().min(1),
  maxStalenessMin: z.number().min(1),
  exchangeCommissionPct: z.number().min(0).max(20).default(5),

  // What qualifies as a pick
  minEvPct: z.number(),
  maxEvPct: z.number(),
  minOdds: z.number().min(1.01),
  maxOdds: z.number().min(1.01),
  maxPicks: z.number().int().min(1).max(100),
  maxPicksPerEvent: z.number().int().min(1).max(5),
  rankBy: z.enum(["ev", "stake", "probability"]),

  // Staking
  bankroll: z.number().min(0),
  kellyFraction: z.number().min(0).max(1),
  maxStakePct: z.number().min(0).max(100),

  parlay: z.object({
    enabled: z.boolean(),
    minLegs: z.number().int().min(2).max(6),
    maxLegs: z.number().int().min(2).max(6),
    minCombinedOdds: z.number().min(1.01),
    maxCombinedOdds: z.number().min(1.01),
    legMinEvPct: z.number(),
    legMinOdds: z.number().min(1.01),
    legMaxOdds: z.number().min(1.01),
    minHitProbPct: z.number().min(0).max(100),
    maxPerSport: z.number().int().min(1).max(6),
    count: z.number().int().min(1).max(30),
    kellyFraction: z.number().min(0).max(1),
    maxStakePct: z.number().min(0).max(100),
  }),

  ai: z.object({
    instructions: z.string().max(4000),
    maxAdjustmentPts: z.number().min(0).max(15),
    reviewCount: z.number().int().min(1).max(30),
    maxSearches: z.number().int().min(1).max(40),
    effort: z.enum(["low", "medium", "high", "xhigh"]),
    gamesToResearch: z.number().int().min(1).max(30).default(5),
    picksCount: z.number().int().min(1).max(20).default(5),
    /** How much of the gap between Claude's estimate and the market to accept. */
    aiWeightPct: z.number().min(0).max(100).default(30),
    minEdgePct: z.number().default(2),
  }),
});

export type Strategy = z.infer<typeof StrategySchema>;

const BASE: Omit<Strategy, "id" | "name" | "description"> = {
  sports: ["soccer_epl", "soccer_uefa_champs_league", "basketball_nba"],
  regions: ["eu"],
  markets: ["h2h", "totals"],
  betBooks: [],
  minHoursAhead: 0,
  maxHoursAhead: 72,
  fairSource: "sharp",
  devig: "power",
  minReferenceBooks: 1,
  maxStalenessMin: 60,
  exchangeCommissionPct: 5,
  minEvPct: 1.5,
  maxEvPct: 15,
  minOdds: 1.4,
  maxOdds: 4,
  maxPicks: 25,
  maxPicksPerEvent: 1,
  rankBy: "ev",
  bankroll: 500,
  kellyFraction: 0.25,
  maxStakePct: 2,
  parlay: {
    enabled: true,
    minLegs: 2,
    maxLegs: 3,
    minCombinedOdds: 2.5,
    maxCombinedOdds: 12,
    legMinEvPct: 0.5,
    legMinOdds: 1.3,
    legMaxOdds: 3,
    minHitProbPct: 8,
    maxPerSport: 3,
    count: 8,
    kellyFraction: 0.1,
    maxStakePct: 0.5,
  },
  ai: {
    instructions: "",
    maxAdjustmentPts: 3,
    reviewCount: 10,
    maxSearches: 12,
    effort: "high",
    gamesToResearch: 5,
    picksCount: 5,
    aiWeightPct: 30,
    minEdgePct: 2,
  },
};

export const PRESETS: Strategy[] = [
  {
    ...BASE,
    id: "sharp-value",
    name: "Sharp value",
    description: "Prices that beat the sharpest books. The default, and the most defensible.",
  },
  {
    ...BASE,
    id: "steady-favorites",
    name: "Steady favorites",
    description: "Short prices with a small edge. Fewer swings, lower return.",
    minEvPct: 0.5,
    minOdds: 1.25,
    maxOdds: 1.9,
    markets: ["h2h"],
    parlay: {
      ...BASE.parlay,
      legMinOdds: 1.2,
      legMaxOdds: 1.7,
      minCombinedOdds: 1.8,
      maxCombinedOdds: 5,
      minHitProbPct: 25,
    },
  },
  {
    ...BASE,
    id: "longshot-parlays",
    name: "Longshot parlays",
    description: "Bigger tickets at very small stakes. Expect long losing runs.",
    minOdds: 2,
    maxOdds: 8,
    kellyFraction: 0.15,
    maxStakePct: 1,
    parlay: {
      ...BASE.parlay,
      minLegs: 3,
      maxLegs: 5,
      minCombinedOdds: 8,
      maxCombinedOdds: 80,
      legMinOdds: 1.6,
      legMaxOdds: 4.5,
      minHitProbPct: 1,
      kellyFraction: 0.05,
      maxStakePct: 0.25,
    },
  },
  {
    ...BASE,
    id: "broad-consensus",
    name: "Broad consensus",
    description: "Fair value from every book. Finds more, but is noisier than Sharp value.",
    fairSource: "consensus",
    minReferenceBooks: 5,
    minEvPct: 2.5,
  },
];
