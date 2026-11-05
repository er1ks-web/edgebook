import { NextResponse, type NextRequest } from "next/server";
import { authMode, SESSION_COOKIE, sessionIsValid } from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/login"]);

/** Every page and API route passes through here, so nothing is reachable without a login. */
export async function proxy(req: NextRequest) {
  const mode = authMode(process.env);
  const path = req.nextUrl.pathname;

  if (mode.kind === "misconfigured") {
    return new NextResponse(`Edgebook is locked. ${mode.reason}`, { status: 503, headers: { "Content-Type": "text/plain" } });
  }

  const toHome = () => NextResponse.redirect(new URL("/", req.url));
  if (mode.kind === "open") return path === "/login" ? toHome() : NextResponse.next();

  const signedIn = await sessionIsValid(req.cookies.get(SESSION_COOKIE)?.value, mode.password);
  if (signedIn) return path === "/login" ? toHome() : NextResponse.next();
  if (PUBLIC_PATHS.has(path)) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // Static files and icons only. Browsers and phones fetch icons before anyone logs in.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
