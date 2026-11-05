export type MarketKey = "h2h" | "spreads" | "totals";

export interface RawOutcome { name: string; price: number; point?: number }
export interface RawMarket { key: string; last_update?: string; outcomes: RawOutcome[] }
export interface RawBookmaker { key: string; title: string; last_update?: string; markets: RawMarket[] }
export interface RawEvent {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: RawBookmaker[];
}

export interface AiItem {
  key: string;
  verdict: "back" | "lean" | "pass";
  /** Percentage points applied to the market fair probability, already clamped. */
  adjustmentPts: number;
  confidence: "low" | "medium" | "high";
  summary: string;
  risks: string[];
  sources: { title: string; url: string }[];
}

export interface AiReview {
  at: string;
  notes: string;
  costUsd: number;
  model: string;
  items: Record<string, AiItem>;
}

/** A selection's price at one bookmaker that could take it in a parlay. */
export interface PickOffer {
  book: string;
  bookTitle: string;
  price: number;
  marketProb: number;
  prob: number;
}

export interface Pick {
  key: string;
  eventId: string;
  sportKey: string;
  sportTitle: string;
  commence: string;
  home: string;
  away: string;
  market: MarketKey;
  selection: string;
  point?: number;
  /** "Arsenal -0.5", "Over 2.5", "Draw" */
  label: string;
  book: string;
  bookTitle: string;
  price: number;
  /** Fair probability implied by the market, before any AI adjustment. */
  marketProb: number;
  /** Probability used for EV and stake: marketProb plus any AI adjustment. */
  prob: number;
  ev: number;
  stake: number;
  referenceBooks: number;
  ai?: AiItem;
  /** Every usable non-exchange price, so parlays can be priced at a single book. */
  offers?: PickOffer[];
}

export interface Parlay {
  id: string;
  book: string;
  bookTitle: string;
  legs: Pick[];
  odds: number;
  hitProb: number;
  ev: number;
  stake: number;
  payout: number;
}

/** A bet Claude chose and the price supports. */
export interface AiBet extends Pick {
  /** Claude's own estimate, before blending with the market. */
  aiChance: number;
  /** Lowest odds at which this bet still clears the minimum edge. */
  minPrice: number;
}

/** A game with no recommended bet, and why. */
export interface AiPass {
  eventId: string;
  fixture: string;
  sportTitle: string;
  commence: string;
  reason: string;
  /** Set when Claude likes a side but the price is too low. */
  watch?: { label: string; minPrice: number; bestPrice: number; book: string };
}

export interface AiPicksRun {
  at: string;
  notes: string;
  costUsd: number;
  model: string;
  gamesResearched: number;
  bets: AiBet[];
  passes: AiPass[];
}

export interface LeagueCoverage {
  sportKey: string;
  title: string;
  /** False when no odds have been fetched for this league with these settings. */
  loaded: boolean;
  games: number;
  gamesInWindow: number;
  picks: number;
  /** Best edge available at a usable book and price, even if below the minimum. */
  bestEv: number | null;
}

export interface ScanResult {
  mode: "demo" | "live";
  fetchedAt: string | null;
  quota: { remaining: number | null; used: number | null };
  picks: Pick[];
  parlays: Parlay[];
  /** Priced well enough by the market but marked "pass" by the AI review. */
  rejected: Pick[];
  stats: { events: number; evaluated: number; books: { key: string; title: string }[]; leagues: LeagueCoverage[] };
  ai: Omit<AiReview, "items"> | null;
  warnings: string[];
}

/** An AI rating of a bet, from market prices plus news research. */
export interface BetCheck {
  at: string;
  rating: number;
  label: "Strong" | "Fair" | "Weak" | "Poor";
  summary: string;
  /** Why the rating was limited by the numbers, if it was. */
  note?: string;
  risks: string[];
  sources: { title: string; url: string }[];
  legs: { key: string; label: string; assessment: string; fairProb: number | null; edge: number | null; started: boolean }[];
  hitProb: number | null;
  ev: number | null;
  /** Age of the odds used, in minutes. Null when no saved odds covered this bet. */
  oddsAgeMin: number | null;
  costUsd: number;
}

export type LegResult = "pending" | "won" | "lost" | "push";

export interface BetLeg {
  key: string;
  eventId: string;
  sportKey: string;
  sportTitle: string;
  commence: string;
  home: string;
  away: string;
  market: MarketKey;
  selection: string;
  point?: number;
  label: string;
  price: number;
  /** Fair probability when the bet was logged. */
  prob: number;
  /** Last market fair probability seen before kickoff, for closing line value. */
  closingProb?: number;
  result: LegResult;
  /** Automatic result checks skip this leg, so it's marked by hand. */
  handSettle?: boolean;
}

export interface Bet {
  id: string;
  placedAt: string;
  settledAt?: string;
  kind: "single" | "parlay";
  book: string;
  bookTitle: string;
  strategyId: string;
  strategyName: string;
  stake: number;
  odds: number;
  evAtPlacement: number;
  legs: BetLeg[];
  status: "pending" | "won" | "lost" | "push";
  returned: number;
  demo: boolean;
  /** Recorded automatically to measure AI picks. Never real money. */
  paper?: boolean;
  /** Entered by hand after the fact, so it has no expected edge. */
  manual?: boolean;
  aiCheck?: BetCheck;
}
