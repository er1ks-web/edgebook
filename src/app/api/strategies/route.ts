import { NextResponse } from "next/server";
import { readState, updateState } from "@/lib/store";
import { StrategySchema } from "@/lib/strategy";

export const dynamic = "force-dynamic";

export async function GET() {
  const { strategies } = await readState();
  return NextResponse.json({ strategies });
}

export async function PUT(req: Request) {
  const parsed = StrategySchema.safeParse(await req.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `${issue.path.join(".")}: ${issue.message}` }, { status: 400 });
  }
  const strategy = parsed.data;
  await updateState((state) => {
    const i = state.strategies.findIndex((s) => s.id === strategy.id);
    if (i >= 0) state.strategies[i] = strategy;
    else state.strategies.push(strategy);
    // Instructions and limits may have changed, so an older review no longer applies.
    delete state.reviews[strategy.id];
  });
  return NextResponse.json({ strategy });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const removed = await updateState((state) => {
    if (state.strategies.length <= 1) return false;
    const before = state.strategies.length;
    state.strategies = state.strategies.filter((s) => s.id !== id);
    if (id) delete state.reviews[id];
    return state.strategies.length < before;
  });
  if (!removed) return NextResponse.json({ error: "Keep at least one strategy." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
