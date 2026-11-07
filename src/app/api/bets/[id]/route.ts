import { NextResponse } from "next/server";
import { z } from "zod";
import { applyLegResults } from "@/lib/engine/settle";
import { TagsSchema } from "@/lib/manualBet";
import { updateState } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  legIndex: z.number().int().min(0),
  result: z.enum(["pending", "won", "lost", "push"]),
});

const Notes = z.object({ note: z.string().trim().max(500), tags: TagsSchema });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const notes = Notes.safeParse(body);
  if (notes.success) {
    const updated = await updateState((state) => {
      const target = state.bets.find((b) => b.id === id);
      if (!target) return null;
      target.note = notes.data.note || undefined;
      target.tags = notes.data.tags.length ? [...new Set(notes.data.tags)] : undefined;
      return target;
    });
    if (!updated) return NextResponse.json({ error: "Bet not found." }, { status: 404 });
    return NextResponse.json({ bet: updated });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid result." }, { status: 400 });
  const { legIndex, result } = parsed.data;

  const bet = await updateState((state) => {
    const i = state.bets.findIndex((b) => b.id === id);
    if (i < 0 || !state.bets[i].legs[legIndex]) return null;
    state.bets[i].legs[legIndex].result = result;
    // Clear the old timestamp so a corrected result counts from now.
    state.bets[i] = applyLegResults({ ...state.bets[i], settledAt: undefined });
    return state.bets[i];
  });
  if (!bet) return NextResponse.json({ error: "Bet not found." }, { status: 404 });
  return NextResponse.json({ bet });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await updateState((state) => {
    state.bets = state.bets.filter((b) => b.id !== id);
  });
  return NextResponse.json({ ok: true });
}
