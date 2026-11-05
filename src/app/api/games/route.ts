import { NextResponse } from "next/server";
import { knownGames } from "@/lib/games";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ games: await knownGames() });
}
