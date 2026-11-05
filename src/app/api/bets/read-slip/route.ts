import { NextResponse } from "next/server";
import { z } from "zod";
import { AiReviewError, readBetSlip } from "@/lib/ai";
import { knownGames } from "@/lib/games";
import { buildSlipDraft } from "@/lib/slipImport";

export const dynamic = "force-dynamic";

// The API takes images up to 5 MB, which is about 6.7 million characters of base64.
const MAX_BASE64 = 6_700_000;

const Body = z.object({
  image: z.string().min(1).max(MAX_BASE64),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().regex(/^[\w+\-/]{1,64}$/).catch("unknown"),
});

/** Reads a screenshot into a draft for review. Nothing is saved, and the image isn't kept. */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return NextResponse.json({ error: "Reading a screenshot needs a Claude key. Add ANTHROPIC_API_KEY first." }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That image couldn't be used. Try a smaller screenshot." }, { status: 400 });

  try {
    const games = await knownGames();
    const { image, mediaType, today, timeZone } = parsed.data;
    const { slip, costUsd } = await readBetSlip(image, mediaType, today, timeZone, games);
    if (!slip.is_bet_slip) return NextResponse.json({ error: "That doesn't look like a bet slip." }, { status: 422 });
    const draft = buildSlipDraft(slip, games, new Date().toISOString());
    if (!draft.legs.length) {
      const why = draft.warnings[0] ? ` ${draft.warnings[0]}` : "";
      return NextResponse.json({ error: `No bets could be read from that screenshot.${why}` }, { status: 422 });
    }
    return NextResponse.json({ draft, costUsd });
  } catch (err) {
    const message = err instanceof AiReviewError ? err.message : "Reading the screenshot failed. Try again.";
    if (!(err instanceof AiReviewError)) console.error("Slip read failed", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
