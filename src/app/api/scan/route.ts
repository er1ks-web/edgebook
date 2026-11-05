import { NextResponse } from "next/server";
import { runScan, type RefreshMode } from "@/lib/scan";
import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { strategyId, refresh } = (await req.json()) as { strategyId: string; refresh?: RefreshMode };
  const { strategies } = await readState();
  const strategy = strategies.find((s) => s.id === strategyId);
  if (!strategy) return NextResponse.json({ error: "Strategy not found." }, { status: 404 });
  return NextResponse.json(await runScan(strategy, refresh ?? false));
}
