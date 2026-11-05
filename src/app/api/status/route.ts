import { NextResponse } from "next/server";
import { authMode } from "@/lib/auth";
import { DEMO_SPORTS } from "@/lib/demo";
import { fetchSports, hasOddsKey, OddsApiError } from "@/lib/oddsApi";
import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const { quota } = await readState();
  const mode = hasOddsKey() ? "live" : "demo";
  const base = {
    mode,
    quota,
    aiKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    loginRequired: authMode(process.env).kind === "required",
  };
  if (mode === "demo") {
    return NextResponse.json({ ...base, sports: DEMO_SPORTS.map(({ key, title, group }) => ({ key, title, group })) });
  }
  try {
    return NextResponse.json({ ...base, sports: await fetchSports() });
  } catch (err) {
    const message = err instanceof OddsApiError ? err.message : "Couldn't reach the odds service.";
    return NextResponse.json({ ...base, sports: [], error: message });
  }
}
