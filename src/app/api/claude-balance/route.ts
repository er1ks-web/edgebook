import { NextResponse } from "next/server";
import { BalanceSchema, claudeLeft, newBudget, type ClaudeBudget } from "@/lib/claudeBudget";
import { readState, updateState } from "@/lib/store";

export const dynamic = "force-dynamic";

const view = (budget: ClaudeBudget | undefined) => ({
  estimate: budget ? { leftUsd: claudeLeft(budget), setAt: budget.setAt } : null,
});

export async function GET() {
  const { claudeBudget } = await readState();
  return NextResponse.json(view(claudeBudget));
}

export async function PUT(req: Request) {
  const parsed = BalanceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your balance in dollars, such as 12.50." }, { status: 400 });
  const budget = await updateState((state) => {
    state.claudeBudget = newBudget(parsed.data.balanceUsd);
    return state.claudeBudget;
  });
  return NextResponse.json(view(budget));
}
