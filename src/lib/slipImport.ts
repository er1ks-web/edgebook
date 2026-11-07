import { z } from "zod";
import type { MarketKey } from "./types";

export const SlipSchema = z.object({
  is_bet_slip: z.boolean(),
  bookmaker: z.string().nullable(),
  stake: z.number().nullable(),
  total_odds: z.number().nullable(),
  placed_at: z.string().nullable(),
  legs: z.array(
    z.object({
      game_id: z.string(),
      home: z.string(),
      away: z.string(),
      kickoff: z.string().nullable(),
      market: z.enum(["h2h", "totals", "spreads", "other"]),
      side: z.enum(["home", "away", "draw", "over", "under", "other"]),
      line: z.number().nullable(),
      /** The bet as the slip words it. Used for market "other". */
      description: z.string().nullable(),
      odds: z.number().nullable(),
    }),
  ),
  left_out: z.array(z.string()),
  notes: z.array(z.string()),
});

export type SlipExtraction = z.infer<typeof SlipSchema>;

export interface KnownGame {
  id: string;
  sportKey: string;
  sportTitle: string;
  commence: string;
  home: string;
  away: string;
}

export interface SlipLeg {
  gameId?: string;
  sportKey: string;
  sportTitle: string;
  /** An ISO time, or the viewer's local time with no offset. The browser reads both correctly. */
  commence: string;
  home: string;
  away: string;
  market: MarketKey;
  selection: string;
  point?: number;
  price: number;
}

export interface SlipDraft {
  legs: SlipLeg[];
  book: string | null;
  stake: number | null;
  totalOdds: number | null;
  placedAt: string | null;
  warnings: string[];
}

const isDate = (v: string | null): v is string => v !== null && Number.isFinite(Date.parse(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const MISMATCH = 0.03;

function selectionFor(market: MarketKey, side: SlipExtraction["legs"][number]["side"], home: string, away: string, description: string | null): string | null {
  if (market === "other") return description?.trim().slice(0, 120) || null;
  if (market === "totals") return side === "over" ? "Over" : side === "under" ? "Under" : null;
  if (side === "home") return home;
  if (side === "away") return away;
  return market === "h2h" && side === "draw" ? "Draw" : null;
}

/**
 * Turns what Claude read into legs the manual form can save. Claude's reading is only trusted
 * this far: games come from the saved list when matched, and each problem becomes a warning.
 */
export function buildSlipDraft(slip: SlipExtraction, games: KnownGame[], now: string): SlipDraft {
  const warnings = [...slip.left_out.map((l) => `Left out because this app can't track it: ${l}`), ...slip.notes];
  const byId = new Map(games.map((g) => [g.id, g]));
  const placedAt = isDate(slip.placed_at) ? slip.placed_at : null;
  const total = slip.total_odds !== null && slip.total_odds > 1 ? slip.total_odds : null;

  const usable = slip.legs.flatMap((leg) => {
    const game = byId.get(leg.game_id);
    const home = (game?.home ?? leg.home).trim();
    const away = (game?.away ?? leg.away).trim();
    const name = `${home} vs ${away}`;
    if (!home || !away) {
      warnings.push("Skipped a leg because its teams couldn't be read.");
      return [];
    }
    const selection = selectionFor(leg.market, leg.side, home, away, leg.description);
    if (!selection || ((leg.market === "totals" || leg.market === "spreads") && leg.line === null)) {
      warnings.push(`Skipped ${name} because its bet couldn't be read. Add it by hand.`);
      return [];
    }
    let commence = game?.commence ?? leg.kickoff;
    if (!isDate(commence)) {
      commence = placedAt ?? now;
      warnings.push(`The slip shows no kickoff for ${name}, so it uses ${placedAt ? "the time placed" : "the current time"}. Remove it and add it by hand if that matters.`);
    }
    return [{ game, home, away, commence, selection, leg }];
  });

  // A slip may show only the total. The leg prices then have to share it.
  const known = usable.reduce((a, u) => (u.leg.odds !== null && u.leg.odds > 1 ? a * u.leg.odds : a), 1);
  const missing = usable.filter((u) => !(u.leg.odds !== null && u.leg.odds > 1)).length;
  const share = missing && total ? round2(Math.pow(total / known, 1 / missing)) : null;
  if (missing && share !== null && share > 1 && usable.length > 1) {
    warnings.push("The slip doesn't show every leg's odds, so the total was split evenly across those legs. The total is still right, but a pushed leg would pay the wrong amount.");
  }

  const legs: SlipLeg[] = usable.flatMap(({ game, home, away, commence, selection, leg }) => {
    const price = leg.odds !== null && leg.odds > 1 ? leg.odds : share;
    if (price === null || price <= 1) {
      warnings.push(`Skipped ${home} vs ${away} because its odds couldn't be read. Add it by hand.`);
      return [];
    }
    return [{
      gameId: game?.id,
      sportKey: game?.sportKey ?? "manual",
      sportTitle: game?.sportTitle ?? "Added by hand",
      commence,
      home,
      away,
      market: leg.market,
      selection,
      point: leg.market === "totals" || leg.market === "spreads" ? leg.line! : undefined,
      price,
    }];
  });

  if (total && legs.length) {
    const product = legs.reduce((a, l) => a * l.price, 1);
    if (Math.abs(product / total - 1) > MISMATCH) {
      warnings.push(`The slip's total of ${total.toFixed(2)} doesn't match its legs, which multiply to ${product.toFixed(2)}. It could be a bonus or a misread, so check it.`);
    }
  }

  return {
    legs,
    book: slip.bookmaker?.trim() || null,
    stake: slip.stake !== null && slip.stake > 0 ? slip.stake : null,
    totalOdds: total,
    placedAt,
    warnings,
  };
}
