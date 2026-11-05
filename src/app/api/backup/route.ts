import { NextResponse } from "next/server";
import { BackupSchema, createBackup, restoreBackup } from "@/lib/backup";
import { readState, updateState } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

export async function GET() {
  const backup = createBackup(await readState());
  const date = backup.exportedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 1), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="edgebook-backup-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "That file is too large to be an Edgebook backup." }, { status: 400 });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "That isn't an Edgebook backup file." }, { status: 400 });
  }
  const parsed = BackupSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "That isn't a valid Edgebook backup file. Nothing was changed." }, { status: 400 });

  const result = await updateState((state) => restoreBackup(state, parsed.data));
  return NextResponse.json(result);
}
