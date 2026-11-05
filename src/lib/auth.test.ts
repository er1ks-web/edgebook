import { describe, expect, it } from "vitest";
import { authMode, createLoginLimiter, createSession, credentialsMatch, MIN_PASSWORD_LENGTH, SESSION_DAYS, sessionIsValid } from "./auth";

const PASSWORD = "correct-horse-battery";
const required = { kind: "required" as const, username: "owner", password: PASSWORD };
const NOW = 1_800_000_000_000;

describe("auth mode", () => {
  it("stays open only for local development with no login set", () => {
    expect(authMode({ NODE_ENV: "development" }).kind).toBe("open");
  });

  it("locks a hosted app with no login, rather than exposing it", () => {
    expect(authMode({ NODE_ENV: "production" }).kind).toBe("misconfigured");
  });

  it("locks when only one of the two is set", () => {
    expect(authMode({ NODE_ENV: "development", APP_PASSWORD: PASSWORD }).kind).toBe("misconfigured");
    expect(authMode({ NODE_ENV: "production", APP_USERNAME: "owner" }).kind).toBe("misconfigured");
  });

  it("rejects a short password", () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(authMode({ APP_USERNAME: "owner", APP_PASSWORD: short }).kind).toBe("misconfigured");
    expect(authMode({ APP_USERNAME: "owner", APP_PASSWORD: `${short}x` }).kind).toBe("required");
  });

  it("requires login in development too, once it's set", () => {
    expect(authMode({ NODE_ENV: "development", APP_USERNAME: "owner", APP_PASSWORD: PASSWORD }).kind).toBe("required");
  });
});

describe("credentials", () => {
  it("accepts only the right pair", async () => {
    expect(await credentialsMatch("owner", PASSWORD, required)).toBe(true);
    expect(await credentialsMatch("owner", `${PASSWORD}x`, required)).toBe(false);
    expect(await credentialsMatch("other", PASSWORD, required)).toBe(false);
    expect(await credentialsMatch("", "", required)).toBe(false);
  });

  it("ignores spaces around the username, not the password", async () => {
    expect(await credentialsMatch(" owner ", PASSWORD, required)).toBe(true);
    expect(await credentialsMatch("owner", ` ${PASSWORD}`, required)).toBe(false);
  });
});

describe("sessions", () => {
  it("accepts a fresh session", async () => {
    expect(await sessionIsValid(await createSession(PASSWORD, NOW), PASSWORD, NOW + 1000)).toBe(true);
  });

  it("expires", async () => {
    const token = await createSession(PASSWORD, NOW);
    const day = 86_400_000;
    expect(await sessionIsValid(token, PASSWORD, NOW + (SESSION_DAYS - 1) * day)).toBe(true);
    expect(await sessionIsValid(token, PASSWORD, NOW + (SESSION_DAYS + 1) * day)).toBe(false);
  });

  it("rejects a session after the password changes", async () => {
    expect(await sessionIsValid(await createSession(PASSWORD, NOW), "a-different-password", NOW)).toBe(false);
  });

  it("rejects tampering and junk", async () => {
    const token = await createSession(PASSWORD, NOW);
    const [expires, sig] = token.split(".");
    const later = String(Number(expires) + 86_400_000 * 365);
    for (const bad of [`${later}.${sig}`, `${expires}.${sig}x`, `${expires}.`, `.${sig}`, expires, "", "a.b", undefined]) {
      expect(await sessionIsValid(bad, PASSWORD, NOW)).toBe(false);
    }
  });

  it("doesn't contain the password", async () => {
    expect(await createSession(PASSWORD, NOW)).not.toContain(PASSWORD);
  });
});

describe("login limiter", () => {
  it("blocks an address after repeated failures, then lets it try again", () => {
    const l = createLoginLimiter(3, 50, 1000);
    for (let i = 0; i < 3; i++) {
      expect(l.blockedFor("a", NOW)).toBe(0);
      l.recordFailure("a", NOW);
    }
    expect(l.blockedFor("a", NOW)).toBe(1000);
    expect(l.blockedFor("a", NOW + 400)).toBe(600);
    expect(l.blockedFor("a", NOW + 1000)).toBe(0);
  });

  it("doesn't block other addresses", () => {
    const l = createLoginLimiter(2, 50, 1000);
    l.recordFailure("a", NOW);
    l.recordFailure("a", NOW);
    expect(l.blockedFor("a", NOW)).toBeGreaterThan(0);
    expect(l.blockedFor("b", NOW)).toBe(0);
  });

  it("limits guessing spread across many addresses", () => {
    const l = createLoginLimiter(5, 3, 1000);
    l.recordFailure("a", NOW);
    l.recordFailure("b", NOW);
    l.recordFailure("c", NOW);
    expect(l.blockedFor("d", NOW)).toBeGreaterThan(0);
  });

  it("clears an address after a success", () => {
    const l = createLoginLimiter(2, 50, 1000);
    l.recordFailure("a", NOW);
    l.recordFailure("a", NOW);
    l.recordSuccess("a");
    expect(l.blockedFor("a", NOW)).toBe(0);
  });
});
