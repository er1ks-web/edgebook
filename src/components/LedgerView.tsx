"use client";

import { useEffect, useRef, useState } from "react";
import { closingValue, ledgerStats, profit } from "@/lib/engine/settle";
import type { Bet, LegResult } from "@/lib/types";
import { AddPastBet } from "./AddPastBet";
import { api, kickoff, money, pct, signedMoney, signedPct, Stat } from "./common";

const RESULTS: { value: LegResult; label: string }[] = [
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "push", label: "Push" },
  { value: "pending", label: "Open" },
];

/** Cumulative profit by settled bet, one series with a zero baseline. */
function EquityChart({ bets }: { bets: Bet[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const ordered = [...bets].sort((a, b) => (a.settledAt ?? "").localeCompare(b.settledAt ?? ""));
  let running = 0;
  const points = [0, ...ordered.map((b) => (running += profit(b)))];

  const height = 200;
  const pad = { top: 12, right: 12, bottom: 24, left: 56 };
  const low = Math.min(0, ...points);
  const high = Math.max(0, ...points);
  const span = high - low || 1;
  const x = (i: number) => pad.left + (i / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - low) / span) * (height - pad.top - pad.bottom);
  const path = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - box.left - pad.left) / (width - pad.left - pad.right);
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  }

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={`Cumulative profit over ${ordered.length} settled bets, now ${signedMoney(points[points.length - 1])}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <line className="axis" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
        <text className="tick" x={pad.left - 8} y={y(high) + 4} textAnchor="end">{money(high)}</text>
        {low < 0 && <text className="tick" x={pad.left - 8} y={y(low) + 4} textAnchor="end">{money(low)}</text>}
        {high > 0 && low < 0 && <text className="tick" x={pad.left - 8} y={y(0) + 4} textAnchor="end">€0</text>}
        <text className="tick" x={pad.left} y={height - 6}>Start</text>
        <text className="tick" x={width - pad.right} y={height - 6} textAnchor="end">{ordered.length} bets</text>
        <path className="line" d={path} />
        {hover !== null && (
          <>
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} />
            <circle className="dot" cx={x(hover)} cy={y(points[hover])} r={4} />
          </>
        )}
      </svg>
      {hover !== null && (
        <div className="tooltip small" style={{ left: Math.min(x(hover) + 10, width - 130), top: 8 }}>
          <div className="muted">{hover === 0 ? "Start" : `After bet ${hover}`}</div>
          <div className="num">{signedMoney(points[hover])}</div>
        </div>
      )}
    </div>
  );
}

function BetCard({ bet, onChange, onError }: { bet: Bet; onChange: (b: Bet | null) => void; onError: (m: string) => void }) {
  const clv = closingValue(bet);

  async function setResult(legIndex: number, result: LegResult) {
    try {
      const { bet: next } = await api<{ bet: Bet }>(`/api/bets/${bet.id}`, { method: "PATCH", body: { legIndex, result } });
      onChange(next);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this bet from the ledger?")) return;
    try {
      await api(`/api/bets/${bet.id}`, { method: "DELETE" });
      onChange(null);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <li className="bet">
      <div className="bet-head">
        <div>
          <span className={`chip status-${bet.status}`}>{bet.status === "pending" ? "Open" : bet.status[0].toUpperCase() + bet.status.slice(1)}</span>
          {bet.demo && <span className="chip">Demo</span>}
          {bet.manual && <span className="chip">Added by hand</span>}
          <span className="small muted"> {bet.kind === "parlay" ? `${bet.legs.length}-leg parlay` : "Single"} · {bet.bookTitle} · {bet.strategyName}</span>
        </div>
        <button className="btn ghost tiny" onClick={remove}>Remove</button>
      </div>
      {bet.legs.map((leg, i) => (
        <div className="bet-leg" key={leg.key}>
          <div>
            <div>{leg.label} <span className="num muted">@ {leg.price.toFixed(2)}</span></div>
            <div className="small muted">{leg.home} vs {leg.away} · {kickoff(leg.commence)}</div>
          </div>
          <div className="segmented" role="group" aria-label={`Result for ${leg.label}`}>
            {RESULTS.map((r) => (
              <button key={r.value} className={leg.result === r.value ? "on" : ""} aria-pressed={leg.result === r.value} onClick={() => setResult(i, r.value)}>{r.label}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="bet-foot small">
        <span>Stake <span className="num">{money(bet.stake)}</span></span>
        <span>Odds <span className="num">{bet.odds.toFixed(2)}</span></span>
        {!bet.manual && <span>Expected edge <span className="num">{signedPct(bet.evAtPlacement)}</span></span>}
        {clv !== null && <span>Beat close by <span className="num">{signedPct(clv)}</span></span>}
        {bet.status !== "pending" && <span className="strong">Result <span className={`num ${profit(bet) >= 0 ? "up" : "down"}`}>{signedMoney(profit(bet))}</span></span>}
      </div>
    </li>
  );
}

export function LedgerView({ mode, strategyId, onError }: { mode: "demo" | "live"; strategyId: string | null; onError: (m: string) => void }) {
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = () => api<{ bets: Bet[] }>("/api/bets").then((r) => setBets(r.bets)).catch((e) => onError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function check() {
    setChecking(true);
    setMessage(null);
    try {
      const r = await api<{ message: string }>("/api/bets/settle", { method: "POST" });
      setMessage(r.message);
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  if (!bets) return <p className="empty">Loading ledger…</p>;
  // Demo and paper bets never mix into real results.
  const visible = bets.filter((b) => b.demo === (mode === "demo") && !b.paper);
  const stats = ledgerStats(visible);
  const paper = bets.filter((b) => b.paper && !b.demo);
  const paperStats = ledgerStats(paper);
  const settled = visible.filter((b) => b.status !== "pending");

  return (
    <>
      <div className="stats">
        <Stat label="Profit" value={signedMoney(stats.net)} tone={stats.net > 0 ? "up" : stats.net < 0 ? "down" : undefined} note={`expected ${signedMoney(stats.expected)}`} />
        <Stat label="Return on stakes" value={stats.roi === null ? "No bets yet" : signedPct(stats.roi)} note={`${stats.settled} settled`} />
        <Stat label="Hit rate" value={stats.hitRate === null ? "No bets yet" : pct(stats.hitRate)} />
        <Stat label="Beat the close" value={stats.avgClv === null ? "No data yet" : signedPct(stats.avgClv)} note={stats.clvCount ? `over ${stats.clvCount} bets` : "Refresh odds before kickoff to track"} />
        <Stat label="Open bets" value={String(stats.open)} note={`${money(stats.exposure)} at risk`} />
      </div>

      <p className="lede">
        Results are mostly luck for the first few hundred bets. Beating the closing price is the earlier sign that a strategy has a real edge.
      </p>

      {settled.length >= 2 && (
        <section className="panel">
          <h2>Cumulative profit</h2>
          <EquityChart bets={settled} />
        </section>
      )}

      {paper.length > 0 && (
        <section className="panel">
          <h2>AI picks track record</h2>
          <p className="small muted">Every AI pick is recorded here automatically at its suggested stake and odds. No real money, and it stays out of your results above.</p>
          <div className="stats paper-stats">
            <Stat label="Paper profit" value={signedMoney(paperStats.net)} tone={paperStats.net > 0 ? "up" : paperStats.net < 0 ? "down" : undefined} note={`${paperStats.settled} settled, ${paperStats.open} open`} />
            <Stat label="Return on stakes" value={paperStats.roi === null ? "No results yet" : signedPct(paperStats.roi)} />
            <Stat label="Hit rate" value={paperStats.hitRate === null ? "No results yet" : pct(paperStats.hitRate)} />
            <Stat label="Beat the close" value={paperStats.avgClv === null ? "No data yet" : signedPct(paperStats.avgClv)} note={paperStats.clvCount ? `over ${paperStats.clvCount} bets` : "Refresh odds before kickoff to track"} />
          </div>
        </section>
      )}

      <details className="panel add-past">
        <summary>Add a bet you already placed</summary>
        <AddPastBet strategyId={strategyId} onAdded={load} onError={onError} />
      </details>

      <div className="ledger-actions">
        <h2>Bets</h2>
        {mode === "live" && <button className="btn" disabled={checking} onClick={check}>{checking ? "Checking…" : "Check results"}</button>}
        {message && <span className="small muted" role="status">{message}</span>}
      </div>

      {visible.length === 0 ? (
        <p className="empty">No bets logged yet. Open a pick and choose Log bet after you place it, or add one you&apos;ve already placed above.</p>
      ) : (
        <ul className="bet-list">
          {visible.map((b) => (
            <BetCard
              key={b.id}
              bet={b}
              onError={onError}
              onChange={(next) => setBets((list) => (list ?? []).flatMap((x) => (x.id !== b.id ? [x] : next ? [next] : [])))}
            />
          ))}
        </ul>
      )}
    </>
  );
}
