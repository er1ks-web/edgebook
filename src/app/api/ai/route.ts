import { NextResponse } from "next/server";
import { AiReviewError, reviewSelections } from "@/lib/ai";
import { hasOddsKey } from "@/lib/oddsApi";
import { reviewCandidates, runScan } from "@/lib/scan";
import { readState, updateState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { strategyId } = (await req.json()) as { strategyId: string };
  if (!hasOddsKey()) {
    return NextResponse.json(
      { error: "AI research needs real fixtures. Add ODDS_API_KEY to .env.local to leave demo mode." },
      { status: 400 },
    );
  }
  const { strategies } = await readState();
  const strategy = strategies.find((s) => s.id === strategyId);
  if (!strategy) return NextResponse.json({ error: "Strategy not found." }, { status: 404 });

  // Review what the pricing engine finds on its own, not what an earlier review left in.
  await updateState((state) => { delete state.reviews[strategy.id]; });
  const scan = await runScan(strategy, false);
  const candidates = reviewCandidates(scan.picks, scan.parlays, strategy.ai.reviewCount);
  if (!candidates.length) {
    return NextResponse.json({ error: "No selections to review. Refresh the odds or loosen the strategy." }, { status: 400 });
  }

  try {
    const review = await reviewSelections(candidates, strategy);
    await updateState((state) => { state.reviews[strategy.id] = review; });
    return NextResponse.json(await runScan(strategy, false));
  } catch (err) {
    const message = err instanceof AiReviewError ? err.message : "The AI review failed. Try again.";
    if (!(err instanceof AiReviewError)) console.error("AI review failed", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
