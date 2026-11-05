import { NextResponse } from "next/server";
import { applyLegResults, gradeLeg } from "@/lib/engine/settle";
import { fetchScores, hasOddsKey, OddsApiError, type ApiScore } from "@/lib/oddsApi";
import { readState, updateState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Grades open legs from final scores. Costs 2 odds credits per sport with a finished game. */
export async function POST() {
  if (!hasOddsKey()) {
    return NextResponse.json({ error: "Demo games have no results. Mark demo bets by hand." }, { status: 400 });
  }
  const { bets } = await readState();
  const now = Date.now();
  const sports = new Set(
    bets
      .filter((b) => b.status === "pending" && !b.demo)
      .flatMap((b) => b.legs)
      .filter((l) => l.result === "pending" && !l.handSettle && Date.parse(l.commence) < now)
      .map((l) => l.sportKey),
  );
  if (!sports.size) return NextResponse.json({ graded: 0, message: "No started games to check." });

  const scores = new Map<string, ApiScore>();
  const errors: string[] = [];
  await Promise.all(
    [...sports].map(async (sport) => {
      try {
        const { data } = await fetchScores(sport);
        for (const s of data) scores.set(s.id, s);
      } catch (err) {
        errors.push(err instanceof OddsApiError ? err.message : "network error");
      }
    }),
  );

  const graded = await updateState((state) => {
    let count = 0;
    state.bets = state.bets.map((bet) => {
      if (bet.status !== "pending" || bet.demo) return bet;
      let changed = false;
      for (const leg of bet.legs) {
        if (leg.result !== "pending" || leg.handSettle) continue;
        const game = scores.get(leg.eventId);
        if (!game?.completed || !game.scores) continue;
        const home = Number(game.scores.find((x) => x.name === game.home_team)?.score);
        const away = Number(game.scores.find((x) => x.name === game.away_team)?.score);
        if (!Number.isFinite(home) || !Number.isFinite(away)) continue;
        const result = gradeLeg(leg, { home, away });
        if (result !== "pending") {
          leg.result = result;
          changed = true;
          count++;
        }
      }
      return changed ? applyLegResults(bet) : bet;
    });
    return count;
  });

  return NextResponse.json({
    graded,
    message: errors.length
      ? `Graded ${graded} leg(s). Some scores failed: ${errors[0]}`
      : graded
        ? `Graded ${graded} leg(s).`
        : "No newly finished games. Scores are only available for 3 days, so older bets need marking by hand.",
  });
}
