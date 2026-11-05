import { NextResponse } from "next/server";
import { createManualBet, ManualBetSchema } from "@/lib/manualBet";
import { hasOddsKey } from "@/lib/oddsApi";
import { updateState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = ManualBetSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the bet details." }, { status: 400 });
  }
  const bet = await updateState((state) => {
    const strategy = state.strategies.find((s) => s.id === parsed.data.strategyId);
    const created = createManualBet(parsed.data, strategy?.name ?? "Added by hand", !hasOddsKey());
    state.bets.push(created);
    return created;
  });
  return NextResponse.json({ bet });
}
