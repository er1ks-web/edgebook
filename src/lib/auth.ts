/** Single-account login. Uses Web Crypto, so it also works in the request proxy. */

export const SESSION_COOKIE = "edgebook_session";
export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 10;

export interface AuthEnv {
  APP_USERNAME?: string;
  APP_PASSWORD?: string;
  NODE_ENV?: string;
}

export type AuthMode =
  | { kind: "open" }
  | { kind: "required"; username: string; password: string }
  | { kind: "misconfigured"; reason: string };

/**
 * Local development stays open when no login is set, because it only listens on this
 * computer. Anywhere else, a missing or weak login locks the app rather than exposing it.
 */
export function authMode(env: AuthEnv): AuthMode {
  const username = env.APP_USERNAME?.trim() ?? "";
  const password = env.APP_PASSWORD ?? "";
  if (!username && !password) {
    if (env.NODE_ENV === "production") return { kind: "misconfigured", reason: "Set APP_USERNAME and APP_PASSWORD to use Edgebook." };
    return { kind: "open" };
  }
  if (!username || !password) return { kind: "misconfigured", reason: "Set both APP_USERNAME and APP_PASSWORD." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { kind: "misconfigured", reason: `APP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { kind: "required", username, password };
}

const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer) {
  let text = "";
  for (const b of new Uint8Array(bytes)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sha256 = (value: string) => crypto.subtle.digest("SHA-256", encoder.encode(value));

/** Compares in constant time, so response timing reveals nothing about the value. */
async function sameValue(a: string, b: string) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  const left = new Uint8Array(x);
  const right = new Uint8Array(y);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export async function credentialsMatch(username: string, password: string, mode: Extract<AuthMode, { kind: "required" }>) {
  // Check both every time, so a right username and a wrong one take the same time.
  const [user, pass] = await Promise.all([sameValue(username.trim(), mode.username), sameValue(password, mode.password)]);
  return user && pass;
}

async function signature(payload: string, password: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`edgebook-session:${password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** A signed expiry. Signing with the password means changing it logs out every device. */
export async function createSession(password: string, now = Date.now()) {
  const expires = String(now + SESSION_DAYS * 86_400_000);
  return `${expires}.${await signature(expires, password)}`;
}

export async function sessionIsValid(token: string | undefined, password: string, now = Date.now()) {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expires = token.slice(0, dot);
  if (!/^\d+$/.test(expires) || Number(expires) <= now) return false;
  return sameValue(token.slice(dot + 1), await signature(expires, password));
}

export interface LoginLimiter {
  /** Milliseconds to wait before trying again, or 0 if a try is allowed. */
  blockedFor: (key: string, now?: number) => number;
  recordFailure: (key: string, now?: number) => void;
  recordSuccess: (key: string) => void;
}

/**
 * Slows password guessing. Each address gets a few tries, and a higher overall limit
 * covers guessing spread across many addresses.
 */
export function createLoginLimiter(perAddress = 5, overall = 50, windowMs = 15 * 60_000): LoginLimiter {
  const failures = new Map<string, number[]>();
  const OVERALL = "*";
  const recent = (key: string, now: number) => {
    const kept = (failures.get(key) ?? []).filter((t) => now - t < windowMs);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };
  const wait = (times: number[], limit: number, now: number) =>
    times.length >= limit ? windowMs - (now - times[times.length - limit]) : 0;

  return {
    blockedFor(key, now = Date.now()) {
      return Math.max(wait(recent(key, now), perAddress, now), wait(recent(OVERALL, now), overall, now));
    },
    recordFailure(key, now = Date.now()) {
      failures.set(key, [...recent(key, now), now]);
      failures.set(OVERALL, [...recent(OVERALL, now), now]);
    },
    recordSuccess(key) {
      failures.delete(key);
    },
  };
}
