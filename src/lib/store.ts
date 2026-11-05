import { promises as fs } from "node:fs";
import path from "node:path";
import { PRESETS, StrategySchema, type Strategy } from "./strategy";
import type { AiPicksRun, AiReview, Bet, RawEvent } from "./types";

// A host can point this at a persistent disk, so data survives each new deployment.
const DATA_DIR = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");

export interface AppState {
  strategies: Strategy[];
  bets: Bet[];
  reviews: Record<string, AiReview>;
  aiPicks?: Record<string, AiPicksRun>;
  quota: { remaining: number | null; used: number | null };
}

export interface OddsCacheEntry { fetchedAt: string; events: RawEvent[] }
export type OddsCache = Record<string, OddsCacheEntry>;

const fresh = (): AppState => ({
  strategies: PRESETS,
  bets: [],
  reviews: {},
  quota: { remaining: null, used: null },
});

async function readJson<T>(file: string, fallback: () => T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback();
    throw err;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, file);
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 1));
  await fs.rename(temp, target); // a crash mid-write can't corrupt the ledger
}

// Route handlers can load this module more than once in dev, so the queue lives on globalThis.
const g = globalThis as unknown as { __edgebookQueue?: Promise<unknown> };

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = (g.__edgebookQueue ?? Promise.resolve()).then(task, task);
  g.__edgebookQueue = run.catch(() => undefined);
  return run;
}

export async function readState(): Promise<AppState> {
  const state = await readJson<AppState>("state.json", fresh);
  return { ...state, strategies: state.strategies.map((s) => StrategySchema.parse(s)) };
}

/** Serialized read-modify-write, so concurrent requests can't lose each other's changes. */
export function updateState<T>(change: (state: AppState) => T): Promise<T> {
  return enqueue(async () => {
    const state = await readState();
    const result = change(state);
    await writeJson("state.json", state);
    return result;
  });
}

export const readOddsCache = () => readJson<OddsCache>("odds-cache.json", () => ({}));

export function updateOddsCache(entries: OddsCache) {
  return enqueue(async () => {
    const cache = await readOddsCache();
    await writeJson("odds-cache.json", { ...cache, ...entries });
  });
}
