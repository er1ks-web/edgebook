import { randomUUID } from "node:crypto";
import { z } from "zod";
import { labelFor, selectionKey } from "./engine/picks";
import type { Bet, BetLeg } from "./types";

const Leg = z.object({
  gameId: z.string().optional(),
  sportKey: z.string().default("manual"),
  sportTitle: z.string().max(80).default("Added by hand"),
  commence: z.string().refine((v) => Number.isFinite(Date.parse(v)), "Enter a valid kickoff time."),
  home: z.string().trim().min(1, "Enter both teams or players.").max(80),
  away: z.string().trim().min(1, "Enter both teams or players.").max(80),
  market: z.enum(["h2h", "totals", "spreads", "other"]),
  selection: z.string().trim().min(1, "Describe the bet.").max(120),
  point: z.number().optional(),
  price: z.number().gt(1, "Odds must be above 1."),
  chance: z.number().gt(0).lt(1).optional(),
  strength: z.number().int().min(1).max(10).optional(),
});

export const TagsSchema = z.array(z.string().trim().min(1).max(30)).max(10);

export const ManualBetSchema = z
  .object({
    strategyId: z.string(),
    book: z.string().trim().min(1, "Enter the bookmaker.").max(60),
    stake: z.number().positive("Enter a stake above 0."),
    odds: z.number().gt(1, "Odds must be above 1."),
    placedAt: z.string().refine((v) => Number.isFinite(Date.parse(v)), "Enter a valid date."),
    legs: z.array(Leg).min(1, "Add at least one bet.").max(10, "A parlay can have up to 10 legs here."),
    note: z.string().trim().max(500).optional(),
    tags: TagsSchema.optional(),
  })
  .superRefine((bet, ctx) => {
    bet.legs.forEach((leg, i) => {
      const fail = (message: string) => ctx.addIssue({ code: "custom", message, path: ["legs", i] });
      if (leg.market === "h2h" && ![leg.home, leg.away, "Draw"].includes(leg.selection)) fail("Choose a side for the match winner bet.");
      if (leg.market === "totals" && !["Over", "Under"].includes(leg.selection)) fail("Choose Over or Under.");
      if (leg.market === "spreads" && ![leg.home, leg.away].includes(leg.selection)) fail("Choose a side for the spread.");
      if ((leg.market === "totals" || leg.market === "spreads") && (leg.point === undefined || !Number.isFinite(leg.point))) fail("Enter the line, such as 2.5.");
    });
  });

export type ManualBetInput = z.input<typeof ManualBetSchema>;

/**
 * Hockey books may have priced regulation time only, while final scores include
 * overtime, and a game typed by hand has no score to look up. Both are marked by hand.
 */
function needsHandSettling(gameId: string | undefined, sportKey: string, market: string) {
  return !gameId || sportKey.startsWith("icehockey_") || market === "other";
}

/**
 * A bet logged after the fact. The fair chance at the time is unknown, so it has no
 * expected edge, and it isn't counted in the expected profit.
 */
export function createManualBet(input: z.output<typeof ManualBetSchema>, strategyName: string, demo: boolean): Bet {
  const legs: BetLeg[] = input.legs.map((l) => {
    const eventId = l.gameId ?? `manual-${randomUUID()}`;
    const point = l.market === "h2h" || l.market === "other" ? undefined : l.point;
    return {
      key: selectionKey(eventId, l.market, l.selection, point),
      eventId,
      sportKey: l.sportKey,
      sportTitle: l.sportTitle,
      commence: new Date(l.commence).toISOString(),
      home: l.home,
      away: l.away,
      market: l.market,
      selection: l.selection,
      point,
      label: labelFor(l.market, l.selection, point),
      price: input.legs.length === 1 ? input.odds : l.price,
      prob: 0,
      result: "pending",
      handSettle: needsHandSettling(l.gameId, l.sportKey, l.market),
      ...(l.chance !== undefined ? { chance: l.chance } : {}),
      ...(l.strength !== undefined ? { strength: l.strength } : {}),
    };
  });
  return {
    id: randomUUID(),
    placedAt: new Date(input.placedAt).toISOString(),
    kind: legs.length > 1 ? "parlay" : "single",
    book: input.book.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    bookTitle: input.book,
    strategyId: input.strategyId,
    strategyName,
    stake: input.stake,
    odds: input.odds,
    evAtPlacement: 0,
    legs,
    status: "pending",
    returned: 0,
    demo,
    manual: true,
    ...(input.note ? { note: input.note } : {}),
    ...(input.tags?.length ? { tags: [...new Set(input.tags)] } : {}),
  };
}
