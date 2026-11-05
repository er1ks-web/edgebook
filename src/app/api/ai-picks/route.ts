import { NextResponse } from "next/server";
import { AiReviewError, predictGames } from "@/lib/ai";
import { createBet } from "@/lib/bets";
import { buildAiBets, selectGames } from "@/lib/engine/aiPicks";
import { evaluate } from "@/lib/engine/picks";
import { hasOddsKey } from "@/lib/oddsApi";
import { loadEvents, runScan } from "@/lib/scan";
import { readState, updateState } from "@/lib/store";
import type { AiPicksRun } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Hides bets and passes for games that have already started. */
function current(run: AiPicksRun | undefined): AiPicksRun | null {
  if (!run) return null;
  const now = Date.now();
  return {
    ...run,
    bets: run.bets.filter((b) => Date.parse(b.commence) > now),
    passes: run.passes.filter((p) => Date.parse(p.commence) > now),
  };
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("strategyId") ?? "";
  const { aiPicks } = await readState();
  return NextResponse.json({ run: current(aiPicks?.[id]) });
}

export async function POST(req: Request) {
  const { strategyId } = (await req.json()) as { strategyId: string };
  if (!hasOddsKey()) {
    return NextResponse.json(
      { error: "AI picks need real fixtures. Add ODDS_API_KEY to .env.local to leave demo mode." },
      { status: 400 },
    );
  }
  // Check this first, so a missing key can't waste odds credits on the refresh below.
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "AI picks need a Claude key. Add ANTHROPIC_API_KEY to .env.local, then try again." },
      { status: 400 },
    );
  }
  const { strategies } = await readState();
  const strategy = strategies.find((s) => s.id === strategyId);
  if (!strategy) return NextResponse.json({ error: "Strategy not found." }, { status: 404 });

  // Predict from current prices. A refresh in the last few minutes is reused, not charged again.
  await runScan(strategy, true);
  const { events } = await loadEvents(strategy, false);
  const games = selectGames(evaluate(events, strategy), strategy);
  if (!games.length) {
    return NextResponse.json(
      { error: "No upcoming games have a usable price. Check your leagues, books and odds limits in Strategy." },
      { status: 400 },
    );
  }

  try {
    const { predictions, notes, costUsd, model } = await predictGames(games, strategy);
    // Prices can move during research, which is why each bet carries a lowest acceptable price.
    const { bets, passes } = buildAiBets(games, predictions, strategy);
    const run: AiPicksRun = { at: new Date().toISOString(), notes, costUsd, model, gamesResearched: games.length, bets, passes };

    await updateState((state) => {
      state.aiPicks = { ...state.aiPicks, [strategy.id]: run };
      // Record every recommendation as a paper bet, so the track record can't be selective.
      for (const bet of bets) {
        const tracked = state.bets.some(
          (b) => b.paper && b.strategyId === strategy.id && b.legs[0].key === bet.key,
        );
        if (tracked || bet.stake <= 0) continue;
        state.bets.push(
          createBet({
            legs: [bet],
            stake: bet.stake,
            odds: bet.price,
            strategyId: strategy.id,
            strategyName: strategy.name,
            demo: false,
            paper: true,
          }),
        );
      }
    });
    return NextResponse.json({ run: current(run) });
  } catch (err) {
    const message = err instanceof AiReviewError ? err.message : "AI picks failed. Try again.";
    if (!(err instanceof AiReviewError)) console.error("AI picks failed", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
