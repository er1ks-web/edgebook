import { randomUUID } from "node:crypto";
import { selectionKey } from "./engine/picks";
import type { Bet, BetLeg, Pick } from "./types";

export interface NewBet {
  legs: Pick[];
  stake: number;
  odds: number;
  strategyId: string;
  strategyName: string;
  demo: boolean;
  paper?: boolean;
}

export function createBet({ legs, stake, odds, strategyId, strategyName, demo, paper }: NewBet): Bet {
  const prob = legs.reduce((a, l) => a * l.prob, 1);
  const betLegs: BetLeg[] = legs.map((l) => ({
    key: l.key ?? selectionKey(l.eventId, l.market, l.selection, l.point),
    eventId: l.eventId,
    sportKey: l.sportKey,
    sportTitle: l.sportTitle,
    commence: l.commence,
    home: l.home,
    away: l.away,
    market: l.market,
    selection: l.selection,
    point: l.point,
    label: l.label,
    // A single can be logged at a different price than the feed showed.
    price: legs.length === 1 ? odds : l.price,
    prob: l.prob,
    result: "pending",
  }));
  return {
    id: randomUUID(),
    placedAt: new Date().toISOString(),
    kind: legs.length > 1 ? "parlay" : "single",
    book: legs[0].book,
    bookTitle: legs[0].bookTitle,
    strategyId,
    strategyName,
    stake,
    odds,
    evAtPlacement: prob * odds - 1,
    legs: betLegs,
    status: "pending",
    returned: 0,
    demo,
    ...(paper ? { paper: true } : {}),
  };
}
