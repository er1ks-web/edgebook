"use client";

import { useEffect, useRef, useState } from "react";
import { bettingRecords, closingValue, type DayResult, ledgerStats, localDay, profit } from "@/lib/engine/settle";
import type { Bet, BetCheck, LegResult } from "@/lib/types";
import { LEDGER_ONLY } from "@/lib/features";
import { AddPastBet } from "./AddPastBet";
import { BackupPanel } from "./BackupPanel";
import { BetNotes, LogListImport, MoneyPanel, StatsPanel } from "./LedgerExtras";
import { chasingWarning, needsResult, realBets, stakeTotals, toCsv } from "@/lib/ledgerStats";
import type { Money } from "@/lib/types";
import { ago, api, kickoff, money, pct, signedMoney, signedPct, Stat } from "./common";

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

function CheckResult({ check, open, onToggle }: { check: BetCheck; open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <details className="bet-check" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary className="check-head">
        <span className={`check-score check-${check.label.toLowerCase()}`}>
          <span className="num">{check.rating}/10</span> {check.label}
        </span>
        <span className="small strong">AI check</span>
        <span className="small muted">{open ? "Hide" : "Show"}</span>
        <span className="check-caret" aria-hidden="true">▾</span>
      </summary>
      <p className="small muted">Rates the price and news, not the chance of winning.</p>
      <p>{check.summary}</p>
      {check.note && <p className="small warn-text">{check.note}</p>}
      {(check.hitProb !== null || check.ev !== null) && (
        <p className="small muted">
          Market says it hits about <span className="num">{pct(check.hitProb ?? 0)}</span> of the time, an edge of{" "}
          <span className={`num ${(check.ev ?? 0) >= 0 ? "up" : "down"}`}>{signedPct(check.ev ?? 0)}</span> at your odds.
        </p>
      )}
      <ul className="check-legs">
        {check.legs.map((l) => (
          <li key={l.key}>
            <div className="small">
              <span className="strong">{l.label}</span>
              {l.edge !== null && <span className={`num ${l.edge >= 0 ? "up" : "down"}`}> {signedPct(l.edge)}</span>}
            </div>
            <div className="small muted">{l.assessment}</div>
          </li>
        ))}
      </ul>
      {check.risks.length > 0 && (
        <div className="small">
          <div className="strong">What could go wrong</div>
          <ul className="risk-list muted">{check.risks.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {check.sources.length > 0 && (
        <div className="sources small">
          {check.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>)}
        </div>
      )}
      <p className="small muted">
        Checked {ago(check.at)}
        {check.oddsAgeMin !== null ? `, using odds about ${check.oddsAgeMin} min old` : ", with no saved odds for this bet"}
        {` · about $${check.costUsd.toFixed(2)} of Claude usage`}
      </p>
    </details>
  );
}

function BetCard({ bet, onChange, onError }: { bet: Bet; onChange: (b: Bet | null) => void; onError: (m: string) => void }) {
  const clv = closingValue(bet);
  const [checking, setChecking] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const canCheck = !LEDGER_ONLY && bet.status === "pending" && !bet.demo && bet.legs.some((l) => l.result === "pending" && Date.parse(l.commence) > Date.now());

  async function runCheck() {
    setChecking(true);
    try {
      const { bet: next } = await api<{ bet: Bet }>(`/api/bets/${bet.id}/check`, { method: "POST" });
      onChange(next);
      setCheckOpen(true); // Show a result the moment it arrives.
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

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
          <span className="small muted"> {bet.kind === "parlay" ? `${bet.legs.length}-leg parlay` : "Single"} · {bet.bookTitle}{!LEDGER_ONLY && <> · {bet.strategyName}</>}</span>
        </div>
        <div className="bet-actions">
          {canCheck && (
            <button className="btn ghost tiny" disabled={checking} onClick={runCheck}>
              {checking ? "Checking…" : bet.aiCheck ? "Check again" : "AI check"}
            </button>
          )}
          <button className="btn ghost tiny" onClick={remove}>Remove</button>
        </div>
      </div>
      {checking && <p className="small muted" role="status">Claude is checking the odds and news. This can take a minute or two.</p>}
      {bet.legs.map((leg, i) => (
        <div className="bet-leg" key={leg.key}>
          <div>
            <div>{leg.label} <span className="num muted">@ {leg.price.toFixed(2)}</span></div>
            <div className="small muted">
              {leg.home} vs {leg.away} · {kickoff(leg.commence)}
              {leg.chance !== undefined && ` · chat ${Math.round(leg.chance * 100)}%`}
              {leg.strength !== undefined && ` · ${leg.strength}/10`}
            </div>
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
        {!bet.manual && !LEDGER_ONLY && <span>Expected edge <span className="num">{signedPct(bet.evAtPlacement)}</span></span>}
        {clv !== null && <span>Beat close by <span className="num">{signedPct(clv)}</span></span>}
        {bet.status !== "pending" && <span className="strong">Result <span className={`num ${profit(bet) >= 0 ? "up" : "down"}`}>{signedMoney(profit(bet))}</span></span>}
      </div>
      {!bet.demo && <BetNotes bet={bet} onChange={onChange} onError={onError} />}
      {bet.aiCheck && <CheckResult check={bet.aiCheck} open={checkOpen} onToggle={setCheckOpen} />}
    </li>
  );
}

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STRIP_DAYS = 28;

/** The last four weeks, one cell per day. A sign in each cell keeps it readable without colour. */
function DayStrip({ results }: { results: DayResult[] }) {
  const [active, setActive] = useState<string | null>(null);
  const byDay = new Map(results.map((d) => [d.day, d]));
  const today = new Date();
  const days = Array.from({ length: STRIP_DAYS }, (_, i) =>
    localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (STRIP_DAYS - 1 - i), 12).getTime()),
  );
  const describe = (day: string) => {
    const d = byDay.get(day);
    return d ? `${dayLabel(day)}: ${signedMoney(d.net)} from ${plural(d.bets, "bet")}` : `${dayLabel(day)}: no settled bets`;
  };

  return (
    <div className="record-days">
      <div className="stat-label">Last 4 weeks</div>
      <div className="day-strip" onMouseLeave={() => setActive(null)}>
        {days.map((day) => {
          const net = byDay.get(day)?.net;
          const tone = net === undefined ? "" : net > 0 ? "day-green" : net < 0 ? "day-red" : "day-even";
          return (
            <button
              key={day}
              type="button"
              className={`day-cell ${tone}`}
              aria-label={describe(day)}
              onMouseEnter={() => setActive(day)}
              onFocus={() => setActive(day)}
              onClick={() => setActive(day)}
            >
              {net === undefined ? "" : net > 0 ? "+" : net < 0 ? "−" : "="}
            </button>
          );
        })}
      </div>
      <p className="small muted day-readout" aria-live="polite">
        {active ? describe(active) : "Green made a profit, red made a loss. Hover or tap a day for its total."}
      </p>
    </div>
  );
}

function Records({ bets }: { bets: Bet[] }) {
  const r = bettingRecords(bets);
  const streak = r.currentStreak;
  const dayRun = r.hottestDays;
  return (
    <section className="panel">
      <h2>Streaks and records</h2>
      <p className="small muted records-note">
        Bets count on the day they were decided. Days off and even days don&apos;t break a day streak. Streaks are mostly luck, so don&apos;t raise your stakes because of one.
      </p>
      <div className="stats paper-stats record-stats">
        <Stat
          label="Current bet streak"
          value={streak ? plural(streak.length, streak.kind === "won" ? "win" : "loss", streak.kind === "won" ? "wins" : "losses") : "None yet"}
          tone={streak ? (streak.kind === "won" ? "up" : "down") : undefined}
          note={`${r.won} won, ${r.lost} lost${r.push ? `, ${r.push} push` : ""}`}
        />
        <Stat label="Hottest bet streak" value={plural(r.hottestStreak, "win")} tone={r.hottestStreak ? "up" : undefined} />
        <Stat label="Coldest bet streak" value={plural(r.coldestStreak, "loss", "losses")} tone={r.coldestStreak ? "down" : undefined} />
        <Stat
          label="Current day streak"
          value={r.currentRedDays ? `${plural(r.currentRedDays, "red day")}` : plural(r.currentGreenDays, "green day")}
          tone={r.currentRedDays ? "down" : r.currentGreenDays ? "up" : undefined}
        />
        <Stat
          label="Hottest day streak"
          value={plural(dayRun?.length ?? 0, "green day")}
          tone={dayRun ? "up" : undefined}
          note={dayRun ? (dayRun.from === dayRun.to ? dayLabel(dayRun.from) : `${dayLabel(dayRun.from)} to ${dayLabel(dayRun.to)}`) : undefined}
        />
        <Stat label="Coldest day streak" value={plural(r.coldestDays, "red day")} tone={r.coldestDays ? "down" : undefined} />
        <Stat label="Green and red days" value={`${r.greenDays} and ${r.redDays}`} note={`${plural(r.days.length, "day")} with results`} />
        <Stat label="Best day" value={r.bestDay ? signedMoney(r.bestDay.net) : "None yet"} tone={r.bestDay ? "up" : undefined} note={r.bestDay ? dayLabel(r.bestDay.day) : undefined} />
        <Stat label="Worst day" value={r.worstDay ? signedMoney(r.worstDay.net) : "None yet"} tone={r.worstDay ? "down" : undefined} note={r.worstDay ? dayLabel(r.worstDay.day) : undefined} />
        <Stat label="Biggest win" value={r.biggestWin === null ? "None yet" : signedMoney(r.biggestWin)} tone={r.biggestWin === null ? undefined : "up"} />
        <Stat label="Biggest loss" value={r.biggestLoss === null ? "None yet" : signedMoney(r.biggestLoss)} tone={r.biggestLoss === null ? undefined : "down"} />
        <Stat label="Singles" value={signedMoney(r.singles.net)} tone={r.singles.net > 0 ? "up" : r.singles.net < 0 ? "down" : undefined} note={`${r.singles.won} won, ${r.singles.lost} lost`} />
        <Stat label="Parlays" value={signedMoney(r.parlays.net)} tone={r.parlays.net > 0 ? "up" : r.parlays.net < 0 ? "down" : undefined} note={`${r.parlays.won} won, ${r.parlays.lost} lost`} />
      </div>
      <DayStrip results={r.days} />
    </section>
  );
}

type BetFilter = "all" | "needs" | Bet["status"];
const FILTERS: { value: BetFilter; label: string; empty: string }[] = [
  { value: "all", label: "All", empty: "" },
  { value: "needs", label: "Needs result", empty: "Nothing is waiting for a result." },
  { value: "pending", label: "Open", empty: "No open bets." },
  { value: "won", label: "Won", empty: "No won bets yet." },
  { value: "lost", label: "Lost", empty: "No lost bets." },
  { value: "push", label: "Push", empty: "No pushed bets." },
];

export function LedgerView({ mode, strategyId, onError }: { mode: "demo" | "live"; strategyId: string | null; onError: (m: string) => void }) {
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [filter, setFilter] = useState<BetFilter>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = () => api<{ bets: Bet[] }>("/api/bets").then((r) => setBets(r.bets)).catch((e) => onError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const [moneyData, setMoneyData] = useState<Money | null>(null);
  useEffect(() => {
    if (LEDGER_ONLY) api<{ money: Money }>("/api/money").then((r) => setMoneyData(r.money)).catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const waiting = needsResult(visible);
  const real = realBets(visible);
  const totals = stakeTotals(real);
  const chasing = chasingWarning(real);
  const limits = moneyData?.limits;
  const overDay = limits?.dailyStake != null && totals.today > limits.dailyStake;
  const overWeek = limits?.weeklyStake != null && totals.week > limits.weeklyStake;
  const stats = ledgerStats(visible);
  const paper = bets.filter((b) => b.paper && !b.demo);
  const paperStats = ledgerStats(paper);
  const settled = visible.filter((b) => b.status !== "pending");
  const listFor = (f: BetFilter) => (f === "all" ? visible : f === "needs" ? waiting : visible.filter((b) => b.status === f));
  const countOf = (f: BetFilter) => listFor(f).length;
  // Push and Needs result only appear when they have bets, and the view falls back if they empty.
  const filters = FILTERS.filter((f) => (f.value !== "push" && f.value !== "needs") || countOf(f.value) > 0);
  const active = filters.find((f) => f.value === filter) ?? filters[0];
  const shown = listFor(active.value);

  function exportCsv() {
    const blob = new Blob([toCsv(real)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `edgebook-bets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="stats">
        <Stat label="Profit" value={signedMoney(stats.net)} tone={stats.net > 0 ? "up" : stats.net < 0 ? "down" : undefined} note={LEDGER_ONLY ? `${money(stats.staked)} staked` : `expected ${signedMoney(stats.expected)}`} />
        <Stat label="Return on stakes" value={stats.roi === null ? "No bets yet" : signedPct(stats.roi)} note={`${stats.settled} settled`} />
        <Stat label="Hit rate" value={stats.hitRate === null ? "No bets yet" : pct(stats.hitRate)} />
        {!LEDGER_ONLY && <Stat label="Beat the close" value={stats.avgClv === null ? "No data yet" : signedPct(stats.avgClv)} note={stats.clvCount ? `over ${stats.clvCount} bets` : "Refresh odds before kickoff to track"} />}
        <Stat label="Open bets" value={String(stats.open)} note={`${money(stats.exposure)} at risk`} />
      </div>

      {(overDay || overWeek) && (
        <div className="banner warn" role="alert">
          You&apos;re over your stake limit: {overDay && `${money(totals.today)} today against ${money(limits!.dailyStake!)}`}
          {overDay && overWeek && ", and "}
          {overWeek && `${money(totals.week)} this week against ${money(limits!.weeklyStake!)}`}. Consider stopping here.
        </div>
      )}
      {chasing && (
        <div className="banner warn" role="alert">
          Your stakes have gone up after losses: {money(chasing.stake)} after {chasing.losses} losses in a row, against your usual {money(chasing.usual)}. Raising stakes to win losses back is how most bankrolls go to zero.
        </div>
      )}
      {waiting.length > 0 && (
        <div className="banner">
          {waiting.length === 1 ? "1 bet is" : `${waiting.length} bets are`} waiting for a result.{" "}
          <button type="button" className="link-btn" onClick={() => setFilter("needs")}>Show {waiting.length === 1 ? "it" : "them"}</button>
        </div>
      )}

      <p className="lede">
        {LEDGER_ONLY
          ? "Results are mostly luck for the first few hundred bets, so judge your approach over many bets, not a hot or cold week."
          : "Results are mostly luck for the first few hundred bets. Beating the closing price is the earlier sign that a strategy has a real edge."}
      </p>

      {settled.length >= 2 && (
        <section className="panel">
          <h2>Cumulative profit</h2>
          <EquityChart bets={settled} />
        </section>
      )}

      {settled.length > 0 && <Records bets={visible} />}

      {LEDGER_ONLY && <StatsPanel bets={real} />}
      {LEDGER_ONLY && moneyData && <MoneyPanel bets={real} money={moneyData} onChange={setMoneyData} onError={onError} />}

      {!LEDGER_ONLY && paper.length > 0 && (
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
        <summary>{LEDGER_ONLY ? "Add a bet, by hand or from a screenshot" : "Add a bet you already placed, by hand or from a screenshot"}</summary>
        <AddPastBet strategyId={strategyId} onAdded={load} onError={onError} />
      </details>

      {LEDGER_ONLY && (
        <details className="panel add-past">
          <summary>Paste the chat&apos;s log list</summary>
          <LogListImport strategyId={strategyId} onAdded={load} onError={onError} />
        </details>
      )}

      <BackupPanel onRestored={load} />

      <div className="ledger-actions">
        <h2>Bets</h2>
        {mode === "live" && !LEDGER_ONLY && <button className="btn" disabled={checking} onClick={check}>{checking ? "Checking…" : "Check results"}</button>}
        {message && <span className="small muted" role="status">{message}</span>}
        {real.length > 0 && <button type="button" className="btn ghost tiny export-btn" onClick={exportCsv}>Export spreadsheet</button>}
      </div>

      {visible.length === 0 ? (
        <p className="empty">{LEDGER_ONLY ? "No bets logged yet. Add one above, by hand or from a bet slip screenshot." : "No bets logged yet. Open a pick and choose Log bet after you place it, or add one you've already placed above."}</p>
      ) : (
        <>
          <div className="segmented bet-filter" role="group" aria-label="Show bets">
            {filters.map((f) => (
              <button key={f.value} className={active.value === f.value ? "on" : ""} aria-pressed={active.value === f.value} onClick={() => setFilter(f.value)}>
                {f.label} <span className="num">{countOf(f.value)}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="empty">{active.empty}</p>
          ) : (
            <ul className="bet-list">
              {shown.map((b) => (
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
      )}
    </>
  );
}
