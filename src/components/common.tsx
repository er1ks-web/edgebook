"use client";

import { useState } from "react";
import type { AiItem, Pick } from "@/lib/types";

export const money = (n: number) =>
  `${n < 0 ? "-" : ""}€${Math.abs(n).toFixed(2)}`;
export const signedMoney = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
export const signedPct = (n: number, digits = 1) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;

export function kickoff(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ago(iso: string | null) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** Fired after any change on the server, since a change may have spent Claude credit. */
export const SPEND_EVENT = "edgebook:spend";

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (init?.method && init.method !== "GET") window.dispatchEvent(new Event(SPEND_EVENT));
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) window.location.href = "/login"; // The session expired.
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface SlipControls {
  has: (key: string) => boolean;
  toggle: (pick: Pick) => void;
  openWith: (legs: Pick[]) => void;
  clear: () => void;
  full: boolean;
}

export function AddToSlip({ pick, slip }: { pick: Pick; slip: SlipControls }) {
  const added = slip.has(pick.key);
  return (
    <button
      type="button"
      className={added ? "btn" : "btn ghost"}
      aria-pressed={added}
      disabled={!added && slip.full}
      onClick={() => slip.toggle(pick)}
    >
      {added ? "In parlay" : "+ Parlay"}
    </button>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "up" | "down" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${tone ?? ""}`}>{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

const VERDICT = { back: "AI: back", lean: "AI: lean", pass: "AI: pass" };

export function Verdict({ ai }: { ai: AiItem }) {
  return <span className={`chip verdict-${ai.verdict}`}>{VERDICT[ai.verdict]}</span>;
}

export function AiDetails({ pick }: { pick: Pick }) {
  const ai = pick.ai;
  if (!ai) return null;
  return (
    <div className="ai-details">
      <p>{ai.summary}</p>
      <p className="muted small">
        Market {pct(pick.marketProb)} → used {pct(pick.prob)} ({ai.adjustmentPts > 0 ? "+" : ""}
        {ai.adjustmentPts} pts), {ai.confidence} confidence
      </p>
      {ai.risks.length > 0 && (
        <ul className="small">
          {ai.risks.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      {ai.sources.length > 0 && (
        <div className="sources small">
          {ai.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Records a bet in the ledger. The app never places anything at a bookmaker. */
export function LogBet({
  legs,
  strategyId,
  stake,
  odds,
  onLogged,
  onError,
}: {
  legs: Pick[];
  strategyId: string;
  stake: number;
  odds: number;
  onLogged: () => void;
  onError: (message: string) => void;
}) {
  const [stakeText, setStake] = useState(stake.toFixed(2));
  const [oddsText, setOdds] = useState(odds.toFixed(2));
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    try {
      await api("/api/bets", {
        method: "POST",
        body: { strategyId, legs, stake: Number(stakeText), odds: Number(oddsText) },
      });
      setState("done");
      onLogged();
    } catch (err) {
      setState("idle");
      onError((err as Error).message);
    }
  }

  if (state === "done") return <span className="logged small">Logged to ledger</span>;
  const oddsLookWrong = Number(oddsText) > odds * 1.1;
  return (
    <form className="log-bet" onSubmit={submit}>
      {oddsLookWrong && (
        <p className="small warn-text log-warning" role="alert">
          That&apos;s much higher than the {odds.toFixed(2)} shown. Check that it&apos;s the same bet, because a different bet here will show a false edge.
        </p>
      )}
      <label>
        <span>Stake €</span>
        <input className="num" type="number" min="0.01" step="0.01" value={stakeText} onChange={(e) => setStake(e.target.value)} />
      </label>
      <label>
        <span>Odds taken</span>
        <input className="num" type="number" min="1.01" step="0.01" value={oddsText} onChange={(e) => setOdds(e.target.value)} />
      </label>
      <button className="btn" disabled={state === "saving"}>Log bet</button>
    </form>
  );
}
