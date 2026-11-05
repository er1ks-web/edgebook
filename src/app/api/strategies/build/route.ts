import { NextResponse } from "next/server";
import { z } from "zod";
import { AiReviewError, tuneStrategy } from "@/lib/ai";
import { DEMO_SPORTS } from "@/lib/demo";
import { fetchSports, hasOddsKey } from "@/lib/oddsApi";
import { applyTweaks, isComplete, QUESTIONS, strategyFromAnswers } from "@/lib/questionnaire";
import { StrategySchema } from "@/lib/strategy";

export const dynamic = "force-dynamic";

const Body = z.object({
  base: StrategySchema,
  answers: z.record(z.string(), z.array(z.string())),
  notes: z.string().max(2000).default(""),
});

async function availableSports() {
  if (!hasOddsKey()) return DEMO_SPORTS.map((d) => d.key);
  try {
    return (await fetchSports()).map((s) => s.key);
  } catch {
    return []; // Without the list, keep every league chosen rather than drop them.
  }
}

/** Builds a draft strategy from questionnaire answers. Nothing is saved here. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "These answers couldn't be read." }, { status: 400 });
  const { base, answers, notes } = parsed.data;
  if (!isComplete(answers)) return NextResponse.json({ error: "Answer every question first." }, { status: 400 });

  const { strategy: ruled, warnings } = strategyFromAnswers(answers, base, await availableSports());

  const summary = QUESTIONS.map((q) => {
    const picked = q.options.filter((o) => answers[q.id].includes(o.value)).map((o) => o.label);
    return `${q.title} ${picked.join(", ")}`;
  }).join("\n");

  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return NextResponse.json({
      strategy: { ...ruled, ai: { ...ruled.ai, instructions: notes.trim() || ruled.ai.instructions } },
      explanation: [],
      warnings,
      aiUsed: false,
      note: "Built from your answers by fixed rules, because no Claude key is set.",
      costUsd: 0,
    });
  }

  try {
    const { tweaks, explanation, costUsd } = await tuneStrategy(summary, notes, ruled);
    return NextResponse.json({ strategy: applyTweaks(ruled, tweaks), explanation, warnings, aiUsed: true, costUsd });
  } catch (err) {
    if (!(err instanceof AiReviewError)) console.error("Strategy build failed", err);
    const reason = err instanceof AiReviewError ? err.message : "Claude couldn't be reached.";
    return NextResponse.json({
      strategy: { ...ruled, ai: { ...ruled.ai, instructions: notes.trim() || ruled.ai.instructions } },
      explanation: [],
      warnings,
      aiUsed: false,
      note: `Built from your answers by fixed rules. ${reason}`,
      costUsd: 0,
    });
  }
}
