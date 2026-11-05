"use client";

import { useState } from "react";
import type { Strategy } from "@/lib/strategy";
import type { LeagueCoverage, Parlay, Pick, ScanResult } from "@/lib/types";
import { AddToSlip, AiDetails, ago, kickoff, LogBet, money, pct, signedPct, Stat, Verdict, type SlipControls } from "./common";

interface ViewProps {
  scan: ScanResult | null;
  strategy: Strategy;
  busy: boolean;
  slip: SlipControls;
  onLogged: () => void;
  onError: (message: string) => void;
}

function AiNote({ scan }: { scan: ScanResult }) {
  if (!scan.ai) return null;
  return (
    <section className="panel ai-note">
      <h2>AI research notes</h2>
      <p>{scan.ai.notes}</p>
      <p className="muted small">Researched {ago(scan.ai.at)} · about ${scan.ai.costUsd.toFixed(2)} of Claude usage</p>
    </section>
  );
}

function coverageStatus(l: LeagueCoverage, s: Strategy) {
  if (!l.loaded) return "Odds not loaded. Press Refresh odds.";
  if (l.games === 0) return "No games listed right now.";
  if (l.gamesInWindow === 0) return `${l.games} games listed, none in the next ${s.maxHoursAhead} hours.`;
  const games = `${l.gamesInWindow} ${l.gamesInWindow === 1 ? "game" : "games"} checked`;
  if (l.picks > 0) return `${games}, ${l.picks} ${l.picks === 1 ? "pick" : "picks"}.`;
  if (l.bestEv === null) return `${games}. No usable price with your book and odds limits.`;
  return `${games}. Best edge ${signedPct(l.bestEv)}, below your ${s.minEvPct}% minimum.`;
}

function Coverage({ scan, strategy }: { scan: ScanResult; strategy: Strategy }) {
  return (
    <section className="panel coverage">
      <h2>Leagues in this scan</h2>
      <ul>
        {scan.stats.leagues.map((l) => (
          <li key={l.sportKey}>
            <span className="strong">{l.title}</span>
            <span className={`small ${l.loaded ? "muted" : "warn-text"}`}>{coverageStatus(l, strategy)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PickRow({ pick, strategy, slip, onLogged, onError }: { pick: Pick; strategy: Strategy; slip: SlipControls; onLogged: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="pick">
      <div className="pick-main">
        <div className="pick-what">
          <div className="pick-label">{pick.label}</div>
          <div className="small muted">{pick.home} vs {pick.away}</div>
          <div className="small muted">{pick.sportTitle} · {kickoff(pick.commence)}</div>
        </div>
        <dl className="pick-numbers">
          <div><dt>Odds</dt><dd className="num strong">{pick.price.toFixed(2)}</dd><dd className="small muted">{pick.bookTitle}</dd></div>
          <div><dt>Fair chance</dt><dd className="num">{pct(pick.prob)}</dd><dd className="small muted">{pick.referenceBooks} ref. {pick.referenceBooks === 1 ? "book" : "books"}</dd></div>
          <div><dt>Edge (EV)</dt><dd className="num up">{signedPct(pick.ev)}</dd></div>
          <div><dt>Stake</dt><dd className="num">{money(pick.stake)}</dd></div>
        </dl>
        <div className="pick-actions">
          {pick.ai && <Verdict ai={pick.ai} />}
          <AddToSlip pick={pick} slip={slip} />
          <button className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close" : pick.ai ? "Details" : "Log"}</button>
        </div>
      </div>
      {open && (
        <div className="pick-extra">
          <AiDetails pick={pick} />
          <LogBet legs={[pick]} strategyId={strategy.id} stake={pick.stake} odds={pick.price} onLogged={onLogged} onError={onError} />
        </div>
      )}
    </li>
  );
}

export function PicksView({ scan, strategy, busy, slip, onLogged, onError }: ViewProps) {
  if (!scan) return <p className="empty">{busy ? "Scanning prices…" : "No scan yet."}</p>;
  const total = scan.picks.reduce((a, p) => a + p.stake, 0);
  const best = scan.picks.reduce((a, p) => Math.max(a, p.ev), 0);

  return (
    <>
      <div className="stats">
        <Stat label="Picks" value={String(scan.picks.length)} note={`from ${scan.stats.evaluated} prices checked`} />
        <Stat label="Best edge" value={scan.picks.length ? signedPct(best) : "None"} />
        <Stat label="Suggested total" value={money(total)} note={`${pct(strategy.bankroll ? total / strategy.bankroll : 0)} of ${money(strategy.bankroll)} bankroll`} />
        <Stat label="Strategy" value={strategy.name} note={strategy.fairSource === "sharp" ? "Priced against sharp books" : "Priced against all books"} />
      </div>
      <AiNote scan={scan} />
      {scan.stats.events === 0 ? (
        <p className="empty">No odds are loaded for this strategy yet. Press Refresh odds to fetch them.</p>
      ) : scan.picks.length === 0 ? (
        <p className="empty">Nothing meets this strategy right now. That is a normal result: most prices have no edge. Refresh later, or loosen the filters in Strategy.</p>
      ) : (
        <ul className="pick-list">
          {scan.picks.map((p) => <PickRow key={p.key} pick={p} strategy={strategy} slip={slip} onLogged={onLogged} onError={onError} />)}
        </ul>
      )}
      <Coverage scan={scan} strategy={strategy} />
      {scan.rejected.length > 0 && (
        <section className="rejected">
          <h2>Passed by AI research</h2>
          <p className="small muted">The price looked good, but research found a reason to stay away.</p>
          <ul className="pick-list">
            {scan.rejected.map((p) => (
              <li className="pick" key={p.key}>
                <div className="pick-what">
                  <div className="pick-label">{p.label} <span className="muted num">@ {p.price.toFixed(2)}</span></div>
                  <div className="small muted">{p.home} vs {p.away}</div>
                </div>
                <AiDetails pick={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ParlayCard({ parlay, strategy, slip, onLogged, onError }: { parlay: Parlay; strategy: Strategy; slip: SlipControls; onLogged: () => void; onError: (m: string) => void }) {
  return (
    <article className="ticket">
      <header className="ticket-head">
        <span className="strong">{parlay.legs.length} legs</span>
        <span className="small muted">at {parlay.bookTitle}</span>
      </header>
      <ol className="ticket-legs">
        {parlay.legs.map((l) => (
          <li key={l.key}>
            <div className="leg-top">
              <span>{l.label}</span>
              <span className="num">{l.price.toFixed(2)}</span>
            </div>
            <div className="small muted">
              {l.home} vs {l.away} · {kickoff(l.commence)}
            </div>
            {l.ai && <div className="small"><Verdict ai={l.ai} /> {l.ai.summary}</div>}
          </li>
        ))}
      </ol>
      <dl className="ticket-numbers">
        <div><dt>Odds</dt><dd className="num strong">{parlay.odds.toFixed(2)}</dd></div>
        <div><dt>Hits about</dt><dd className="num">{pct(parlay.hitProb)}</dd></div>
        <div><dt>Edge (EV)</dt><dd className="num up">{signedPct(parlay.ev)}</dd></div>
        <div><dt>Stake → pays</dt><dd className="num">{money(parlay.stake)} → {money(parlay.payout)}</dd></div>
      </dl>
      <LogBet legs={parlay.legs} strategyId={strategy.id} stake={parlay.stake} odds={parlay.odds} onLogged={onLogged} onError={onError} />
      <button type="button" className="btn ghost" onClick={() => slip.openWith(parlay.legs)}>Edit in Build Parlay</button>
    </article>
  );
}

export function ParlaysView({ scan, strategy, busy, slip, onLogged, onError }: ViewProps) {
  if (!scan) return <p className="empty">{busy ? "Scanning prices…" : "No scan yet."}</p>;
  if (!strategy.parlay.enabled) return <p className="empty">Parlays are off for this strategy. Turn them on in Strategy.</p>;
  return (
    <>
      <p className="lede">
        Each ticket uses one book&apos;s prices and never two legs from the same game, because those outcomes move together.
        Check that your book offers every leg at these prices before betting.
      </p>
      {scan.parlays.length === 0 ? (
        <p className="empty">No parlay fits these limits right now. Try a wider leg odds range or a lower minimum in Strategy.</p>
      ) : (
        <div className="tickets">
          {scan.parlays.map((p) => <ParlayCard key={p.id} parlay={p} strategy={strategy} slip={slip} onLogged={onLogged} onError={onError} />)}
        </div>
      )}
    </>
  );
}
