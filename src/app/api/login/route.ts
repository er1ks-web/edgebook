import { NextResponse, type NextRequest } from "next/server";
import { authMode, createLoginLimiter, createSession, credentialsMatch, SESSION_COOKIE, SESSION_DAYS, type LoginLimiter } from "@/lib/auth";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __edgebookLimiter?: LoginLimiter };
const limiter = (g.__edgebookLimiter ??= createLoginLimiter());

/** The last forwarded address is the one added by the host, which a caller can't fake. */
function addressOf(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.[forwarded.length - 1] ?? "direct";
}

export async function POST(req: NextRequest) {
  const mode = authMode(process.env);
  if (mode.kind !== "required") return NextResponse.json({ error: "Login isn't set up." }, { status: 400 });

  const address = addressOf(req);
  const wait = limiter.blockedFor(address);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60_000);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } },
    );
  }

  const body = (await req.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!(await credentialsMatch(username, password, mode))) {
    limiter.recordFailure(address);
    return NextResponse.json({ error: "That username or password isn't right." }, { status: 401 });
  }

  limiter.recordSuccess(address);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(mode.password), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}
