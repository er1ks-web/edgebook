import { NextResponse } from "next/server";
import { z } from "zod";
import { createBet } from "@/lib/bets";
import { hasOddsKey } from "@/lib/oddsApi";
import { readState, updateState } from "@/lib/store";
import type { Pick } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const { bets } = await readState();
  return NextResponse.json({ bets: [...bets].sort((a, b) => b.placedAt.localeCompare(a.placedAt)) });
}

const Body = z.object({
  strategyId: z.string(),
  legs: z.array(z.custom<Pick>((v) => typeof v === "object" && v !== null)).min(1).max(6),
  stake: z.number().positive(),
  odds: z.number().gt(1),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a stake above 0 and odds above 1." }, { status: 400 });
  const { strategyId, legs, stake, odds } = parsed.data;

  const bet = await updateState((state) => {
    const strategy = state.strategies.find((s) => s.id === strategyId);
    const created = createBet({
      legs,
      stake,
      odds,
      strategyId,
      strategyName: strategy?.name ?? "Deleted strategy",
      demo: !hasOddsKey(),
    });
    state.bets.push(created);
    return created;
  });
  return NextResponse.json({ bet });
}
