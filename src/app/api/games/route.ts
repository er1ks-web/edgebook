import { NextResponse } from "next/server";
import { readOddsCache } from "@/lib/store";

export const dynamic = "force-dynamic";

const DAYS_BACK = 3 * 86_400_000; // Final scores are only available this far back.
const DAYS_AHEAD = 7 * 86_400_000;

/** Games in the saved odds, including started ones. Costs no credits. */
export async function GET() {
  const cache = await readOddsCache();
  const now = Date.now();
  const games = new Map<string, { id: string; sportKey: string; sportTitle: string; commence: string; home: string; away: string }>();
  for (const { events } of Object.values(cache)) {
    for (const e of events) {
      const start = Date.parse(e.commence_time);
      if (start < now - DAYS_BACK || start > now + DAYS_AHEAD) continue;
      games.set(e.id, {
        id: e.id,
        sportKey: e.sport_key,
        sportTitle: e.sport_title ?? e.sport_key,
        commence: e.commence_time,
        home: e.home_team,
        away: e.away_team,
      });
    }
  }
  // Started games come first, since those are the ones usually being added.
  const list = [...games.values()].sort((a, b) => {
    const aStarted = Date.parse(a.commence) <= now;
    const bStarted = Date.parse(b.commence) <= now;
    if (aStarted !== bStarted) return aStarted ? -1 : 1;
    return aStarted ? b.commence.localeCompare(a.commence) : a.commence.localeCompare(b.commence);
  });
  return NextResponse.json({ games: list });
}
