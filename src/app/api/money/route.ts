import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readState, updateState } from "@/lib/store";
import type { Money } from "@/lib/types";

export const dynamic = "force-dynamic";

const empty = (): Money => ({ entries: [], limits: { dailyStake: null, weeklyStake: null } });

const Entry = z.object({
  kind: z.enum(["deposit", "withdrawal", "cost"]),
  amount: z.number().positive("Enter an amount above 0.").max(1_000_000),
  note: z.string().trim().max(120).default(""),
  at: z.string().refine((v) => Number.isFinite(Date.parse(v)), "Enter a valid date."),
});
const Limit = z.number().positive().max(1_000_000).nullable();
const Limits = z.object({ dailyStake: Limit, weeklyStake: Limit });

export async function GET() {
  return NextResponse.json({ money: (await readState()).money ?? empty() });
}

export async function POST(req: Request) {
  const parsed = Entry.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the amount." }, { status: 400 });
  const money = await updateState((state) => {
    const m = state.money ?? empty();
    m.entries.push({ id: randomUUID(), ...parsed.data, at: new Date(parsed.data.at).toISOString() });
    state.money = m;
    return m;
  });
  return NextResponse.json({ money });
}

export async function PUT(req: Request) {
  const parsed = Limits.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter limits above 0, or leave them empty." }, { status: 400 });
  const money = await updateState((state) => {
    const m = state.money ?? empty();
    m.limits = parsed.data;
    state.money = m;
    return m;
  });
  return NextResponse.json({ money });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const money = await updateState((state) => {
    const m = state.money ?? empty();
    m.entries = m.entries.filter((e) => e.id !== id);
    state.money = m;
    return m;
  });
  return NextResponse.json({ money });
}
