"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_SLIP_LEGS } from "@/lib/engine/slip";
import type { Strategy } from "@/lib/strategy";
import type { AiPicksRun, Pick, ScanResult } from "@/lib/types";
import { AiPicksView } from "./AiPicksView";
import { ClaudeBalance } from "./ClaudeBalance";
import { PromptView } from "./PromptView";
import { LEDGER_ONLY } from "@/lib/features";
import { ago, api, type SlipControls } from "./common";
import { ParlayBuilderView, type OfferedPick } from "./ParlayBuilderView";
import { LedgerView } from "./LedgerView";
import { Logo } from "./Logo";
import { ParlaysView, PicksView } from "./PicksView";
import { PlaybookView } from "./PlaybookView";
import { StrategyView, type SportInfo } from "./StrategyView";

type Tab = "ai" | "picks" | "parlays" | "builder" | "strategy" | "ledger" | "playbook" | "prompt";
const TABS: { id: Tab; label: string }[] = [
  { id: "ai", label: "Best Picks" },
  { id: "picks", label: "Value" },
  { id: "parlays", label: "Parlays" },
  { id: "builder", label: "Build Parlay" },
  { id: "strategy", label: "Strategy" },
  { id: "ledger", label: "Ledger" },
  { id: "prompt", label: "Prompt" },
  { id: "playbook", label: "Playbook" },
];
const STRATEGY_KEY = "edgebook.strategy";
// As a ledger, strategies only shape the research prompt for a chat.
const LEDGER_TABS: Tab[] = ["ledger", "prompt", "strategy"];
const SHOWN_TABS = LEDGER_ONLY
  ? LEDGER_TABS.map((id) => TABS.find((t) => t.id === id)!)
  : TABS.filter((t) => t.id !== "prompt");

interface Status {
  mode: "demo" | "live";
  aiKey: boolean;
  loginRequired: boolean;
  storageAtRisk?: boolean;
  sports: SportInfo[];
  error?: string;
}

const USD_PER_GAME = 0.4;

export function App() {
  const [tab, setTab] = useState<Tab>(LEDGER_ONLY ? "ledger" : "ai");
  const [aiRun, setAiRun] = useState<AiPicksRun | null>(null);
  const [aiRunBusy, setAiRunBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState<"scan" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const [slipLegs, setSlipLegs] = useState<Pick[]>([]);

  // Everything on offer, from each section, merged so a selection appears once.
  const offered = useMemo<OfferedPick[]>(() => {
    const merged = new Map<string, OfferedPick>();
    const add = (pick: Pick, source: string) => {
      const entry = merged.get(pick.key);
      if (!entry) merged.set(pick.key, { pick, sources: [source] });
      else if (!entry.sources.includes(source)) entry.sources.push(source);
    };
    for (const b of aiRun?.bets ?? []) add(b, "AI Picks");
    for (const p of scan?.picks ?? []) add(p, "Value");
    for (const parlay of scan?.parlays ?? []) for (const leg of parlay.legs) add(leg, "Parlays");
    return [...merged.values()].sort((a, b) => b.pick.ev - a.pick.ev);
  }, [aiRun, scan]);

  // Prefer the latest prices for a leg, keeping its saved copy if it has left the lists.
  const currentLegs = useMemo(() => {
    const byKey = new Map(offered.map((o) => [o.pick.key, o.pick]));
    return slipLegs.map((leg) => byKey.get(leg.key) ?? leg);
  }, [slipLegs, offered]);

  const slip: SlipControls = useMemo(() => ({
    has: (key) => slipLegs.some((l) => l.key === key),
    toggle: (pick) => setSlipLegs((legs) => {
      if (legs.some((l) => l.key === pick.key)) return legs.filter((l) => l.key !== pick.key);
      return legs.length >= MAX_SLIP_LEGS ? legs : [...legs, pick];
    }),
    openWith: (legs) => {
      setSlipLegs(legs.slice(0, MAX_SLIP_LEGS));
      setTab("builder");
    },
    clear: () => setSlipLegs([]),
    full: slipLegs.length >= MAX_SLIP_LEGS,
  }), [slipLegs]);

  const active = strategies.find((s) => s.id === activeId) ?? null;
  const skipNextScan = useRef(false);

  const runScan = useCallback(async (strategyId: string, refresh: boolean | "missing") => {
    setBusy("scan");
    setError(null);
    try {
      setScan(await api<ScanResult>("/api/scan", { method: "POST", body: { strategyId, refresh } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const loadStrategies = useCallback(async () => {
    const { strategies: list } = await api<{ strategies: Strategy[] }>("/api/strategies");
    setStrategies(list);
    return list;
  }, []);

  useEffect(() => {
    api<Status>("/api/status").then(setStatus).catch((err) => setError(err.message));
    loadStrategies()
      .then((list) => {
        let saved: string | null = null;
        try { saved = localStorage.getItem(STRATEGY_KEY); } catch { /* storage may be blocked */ }
        setActiveId(list.find((s) => s.id === saved)?.id ?? list[0]?.id ?? null);
      })
      .catch((err) => setError(err.message));
  }, [loadStrategies]);

  useEffect(() => {
    if (!activeId) return;
    try { localStorage.setItem(STRATEGY_KEY, activeId); } catch { /* storage may be blocked */ }
    // Saving a copy already scans. Switching strategies never spends credits.
    if (LEDGER_ONLY) return;
    if (skipNextScan.current) {
      skipNextScan.current = false;
      return;
    }
    runScan(activeId, false);
  }, [activeId, runScan]);

  useEffect(() => {
    if (!activeId || LEDGER_ONLY) return;
    setAiRun(null);
    api<{ run: AiPicksRun | null }>(`/api/ai-picks?strategyId=${encodeURIComponent(activeId)}`)
      .then((r) => setAiRun(r.run))
      .catch((err) => setError(err.message));
  }, [activeId]);

  async function getAiPicks() {
    if (!activeId) return;
    setAiRunBusy(true);
    setError(null);
    try {
      const { researchAll, available, researching } = await api<{ researchAll: boolean; available: number; researching: number }>("/api/ai-picks", { method: "POST", body: { strategyId: activeId, preview: true } });
      if (researchAll) {
        const skipped = available > researching ? ` ${available} have a usable price, so only the soonest ${researching} will be researched.` : "";
        if (!window.confirm(`Research ${researching} games for about $${Math.max(1, Math.round(researching * USD_PER_GAME))} of Claude usage?${skipped} It can take 10 minutes or more.`)) return;
      }
      const { run } = await api<{ run: AiPicksRun }>("/api/ai-picks", { method: "POST", body: { strategyId: activeId, confirmed: researchAll } });
      setAiRun(run);
      setLedgerVersion((v) => v + 1);
      await runScan(activeId, false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAiRunBusy(false);
    }
  }

  async function runAi() {
    if (!activeId) return;
    setBusy("ai");
    setError(null);
    try {
      setScan(await api<ScanResult>("/api/ai", { method: "POST", body: { strategyId: activeId } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const credits = active ? active.sports.length * active.markets.length * active.regions.length : 0;
  // As a ledger, bets are always real, whether or not an odds key is set.
  const isDemo = !LEDGER_ONLY && (scan?.mode ?? status?.mode) === "demo";

  return (
    <div className="shell">
      <header className="topbar">
        <Logo />

        {(!LEDGER_ONLY || tab !== "ledger") && (
        <label className="strategy-select">
          <span className="sr-only">Active strategy</span>
          <select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)}>
            {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        )}
        {!LEDGER_ONLY && (
        <div className="top-actions">
          <button className="btn" disabled={!activeId || busy !== null || aiRunBusy} onClick={() => activeId && runScan(activeId, true)}>
            {busy === "scan" ? "Scanning…" : "Refresh odds"}
            {!isDemo && <span className="btn-note">{credits} credits</span>}
          </button>
          {tab === "picks" && (
            <button className="btn" disabled={!activeId || busy !== null || aiRunBusy} onClick={runAi}>
              {busy === "ai" ? "Researching…" : "Check these with AI"}
            </button>
          )}
        </div>
        )}
      </header>

      {SHOWN_TABS.length > 1 && (
      <nav className="tabs" aria-label="Sections">
        {SHOWN_TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "tab active" : "tab"} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "picks" && scan ? <span className="count num">{scan.picks.length}</span> : null}
            {t.id === "parlays" && scan ? <span className="count num">{scan.parlays.length}</span> : null}
            {t.id === "builder" && slipLegs.length > 0 ? <span className="count num">{slipLegs.length}</span> : null}
          </button>
        ))}
      </nav>
      )}

      {isDemo && (
        <div className="banner demo">
          <strong>Demo data.</strong> These teams and prices are made up. Add <code>ODDS_API_KEY</code> to <code>.env.local</code> for real odds.
        </div>
      )}
      {status?.storageAtRisk && (
        <div className="banner danger" role="alert">
          <strong>Your data isn&apos;t safe yet.</strong> Saved bets can be erased on the next deployment. Attach a volume on your host and set <code>DATA_DIR</code> to its path.
        </div>
      )}
      {busy === "ai" && (
        <div className="banner">Claude is searching for injuries, lineups and news on your top selections. This can take a few minutes.</div>
      )}
      {error && <div className="banner danger" role="alert">{error}</div>}
      {!LEDGER_ONLY && status?.error && <div className="banner danger" role="alert">Odds service: {status.error}</div>}
      {!LEDGER_ONLY && scan?.warnings.map((w) => <div className="banner warn" key={w}>{w}</div>)}

      <main>
        {tab === "ai" && active && (
          <AiPicksView
            strategy={active}
            run={aiRun}
            busy={aiRunBusy}
            mode={isDemo ? "demo" : "live"}
            aiKey={status?.aiKey ?? false}
            credits={credits}
            slip={slip}
            onRun={getAiPicks}
            onLogged={() => setLedgerVersion((v) => v + 1)}
            onError={setError}
          />
        )}
        {tab === "picks" && active && <PicksView scan={scan} strategy={active} busy={busy === "scan"} slip={slip} onLogged={() => setLedgerVersion((v) => v + 1)} onError={setError} />}
        {tab === "parlays" && active && <ParlaysView scan={scan} strategy={active} busy={busy === "scan"} slip={slip} onLogged={() => setLedgerVersion((v) => v + 1)} onError={setError} />}
        {tab === "builder" && active && (
          <ParlayBuilderView
            offered={offered}
            legs={currentLegs}
            strategy={active}
            slip={slip}
            onLogged={() => setLedgerVersion((v) => v + 1)}
            onError={setError}
          />
        )}
        {tab === "strategy" && active && (
          <StrategyView
            key={active.id}
            strategy={active}
            sports={status?.sports ?? []}
            books={scan?.stats.books ?? []}
            canDelete={strategies.length > 1}
            onSaved={async (saved) => {
              await loadStrategies();
              if (saved.id !== activeId) {
                skipNextScan.current = true;
                setActiveId(saved.id);
              }
              // Saving never fetches odds as a ledger, so it spends no credits.
              if (!LEDGER_ONLY) await runScan(saved.id, "missing");
            }}
            onDeleted={async () => {
              const list = await loadStrategies();
              setActiveId(list[0]?.id ?? null);
            }}
            onError={setError}
          />
        )}
        {tab === "playbook" && active && <PlaybookView strategy={active} />}
        {tab === "prompt" && active && <PromptView strategy={active} sports={status?.sports ?? []} onEditStrategy={() => setTab("strategy")} />}
        {tab === "ledger" && <LedgerView key={ledgerVersion} mode={isDemo ? "demo" : "live"} strategyId={activeId} onError={setError} />}
      </main>

      <footer className="footer small muted">
        {!LEDGER_ONLY && scan?.fetchedAt && !isDemo && <span>Odds from {ago(scan.fetchedAt)}</span>}
        {!LEDGER_ONLY && scan?.quota.remaining != null && <span>{scan.quota.remaining} odds credits left</span>}
        {status?.aiKey && <ClaudeBalance onError={setError} />}
        <span>{LEDGER_ONLY ? "Your betting record. Edgebook never places bets." : "Estimates, not guarantees. Edgebook never places bets."}</span>
        {status?.loginRequired && (
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              window.location.href = "/login";
            }}
          >
            Log out
          </button>
        )}
      </footer>
    </div>
  );
}
