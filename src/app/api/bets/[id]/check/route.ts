import { NextResponse } from "next/server";
import { AiReviewError, checkBet } from "@/lib/ai";
import { betMath, finalRating, ratingLabel, upcomingLegs } from "@/lib/engine/betCheck";
import { evaluate } from "@/lib/engine/picks";
import { readOddsCache, readState, updateState } from "@/lib/store";
import type { Strategy } from "@/lib/strategy";
import type { Bet, BetCheck } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_ODDS_AGE_MS = 24 * 3_600_000;

/** The market's fair chances from saved odds, newest last. This spends no odds credits. */
async function marketPrices(s: Strategy) {
  const cache = await readOddsCache();
  const now = Date.now();
  // Value every market with every book, whatever the strategy filters, so any bet can be priced.
  const wide: Strategy = {
    ...s,
    markets: ["h2h", "spreads", "totals"],
    fairSource: "consensus",
    minReferenceBooks: 1,
    maxStalenessMin: MAX_ODDS_AGE_MS / 60_000,
  };
  const fair = new Map<string, number>();
  const fetchedAt = new Map<string, number>();
  const entries = Object.values(cache)
    .filter((e) => now - Date.parse(e.fetchedAt) < MAX_ODDS_AGE_MS)
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
  for (const entry of entries) {
    const at = Date.parse(entry.fetchedAt);
    for (const sel of evaluate(entry.events, wide, now)) {
      if (sel.fairProb === null) continue;
      fair.set(sel.key, sel.fairProb);
      fetchedAt.set(sel.key, at);
    }
  }
  return { fair, fetchedAt };
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return NextResponse.json({ error: "AI check needs a Claude key. Add ANTHROPIC_API_KEY first." }, { status: 400 });
  }

  const { bets, strategies } = await readState();
  const bet = bets.find((b) => b.id === id);
  if (!bet) return NextResponse.json({ error: "Bet not found." }, { status: 404 });
  if (bet.demo) return NextResponse.json({ error: "Demo games are made up, so there's no news to check." }, { status: 400 });
  if (bet.status !== "pending") return NextResponse.json({ error: "This bet is already settled." }, { status: 400 });

  const legs = upcomingLegs(bet);
  if (!legs.length) {
    // Searching now would reveal the score, so any rating would be hindsight.
    return NextResponse.json({ error: "These games have already started, so AI can't rate this bet fairly." }, { status: 400 });
  }

  const strategy = strategies.find((s) => s.id === bet.strategyId) ?? strategies[0];
  const { fair, fetchedAt } = await marketPrices(strategy);
  const math = betMath(bet, fair);

  try {
    const result = await checkBet(bet, legs, math, strategy);
    const { rating, note } = finalRating(result.rating, math);
    const now = Date.now();
    const times = bet.legs.map((l) => fetchedAt.get(l.key)).filter((t): t is number => t !== undefined);

    const check: BetCheck = {
      at: new Date(now).toISOString(),
      rating,
      label: ratingLabel(rating),
      summary: result.summary,
      note,
      risks: result.risks,
      sources: result.sources,
      legs: bet.legs.map((l) => {
        const fairProb = math.fair[l.key];
        const started = !legs.includes(l);
        return {
          key: l.key,
          label: l.label,
          assessment: started ? "Already started, so it wasn't researched." : (result.assessments[l.key] ?? "Not covered by the research."),
          fairProb,
          edge: fairProb === null ? null : fairProb * l.price - 1,
          started,
        };
      }),
      hitProb: math.hitProb,
      ev: math.ev,
      oddsAgeMin: times.length ? Math.round((now - Math.min(...times)) / 60_000) : null,
      costUsd: result.costUsd,
    };

    const updated = await updateState((state): Bet | null => {
      const target = state.bets.find((b) => b.id === id);
      if (!target) return null;
      target.aiCheck = check;
      return target;
    });
    if (!updated) return NextResponse.json({ error: "This bet was removed during the check." }, { status: 404 });
    return NextResponse.json({ bet: updated });
  } catch (err) {
    const message = err instanceof AiReviewError ? err.message : "The AI check failed. Try again.";
    if (!(err instanceof AiReviewError)) console.error("AI check failed", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
