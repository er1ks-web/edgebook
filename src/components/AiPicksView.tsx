"use client";

import type { Strategy } from "@/lib/strategy";
import type { AiBet, AiPass, AiPicksRun } from "@/lib/types";
import { AddToSlip, ago, kickoff, LogBet, money, pct, signedPct, type SlipControls } from "./common";

const CONFIDENCE = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };

function BetCard({ bet, strategy, slip, onLogged, onError }: { bet: AiBet; strategy: Strategy; slip: SlipControls; onLogged: () => void; onError: (m: string) => void }) {
  const ai = bet.ai!;
  return (
    <article className="ai-bet">
      <header className="ai-bet-head">
        <div>
          <h3>{bet.label}</h3>
          <div className="small muted">{bet.home} vs {bet.away}</div>
          <div className="small muted">{bet.sportTitle} · {kickoff(bet.commence)}</div>
        </div>
        <span className="chip">{CONFIDENCE[ai.confidence]}</span>
      </header>

      <dl className="ai-bet-numbers">
        <div><dt>Odds</dt><dd className="num strong">{bet.price.toFixed(2)}</dd><dd className="small muted">{bet.bookTitle}</dd></div>
        <div><dt>Claude&apos;s chance</dt><dd className="num">{pct(bet.aiChance)}</dd></div>
        <div><dt>Market&apos;s chance</dt><dd className="num">{pct(bet.marketProb)}</dd></div>
        <div><dt>Edge used</dt><dd className="num up">{signedPct(bet.ev)}</dd><dd className="small muted">at {pct(bet.prob)} blended</dd></div>
        <div><dt>Stake</dt><dd className="num strong">{money(bet.stake)}</dd></div>
        <div><dt>Bet only at</dt><dd className="num strong">{bet.minPrice.toFixed(2)} or higher</dd></div>
      </dl>

      <p>{ai.summary}</p>
      {ai.risks.length > 0 && (
        <div className="small">
          <div className="strong">What could go wrong</div>
          <ul className="risk-list muted">
            {ai.risks.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      {ai.sources.length > 0 && (
        <div className="sources small">
          {ai.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>
          ))}
        </div>
      )}
      <div className="ai-bet-actions">
        <LogBet legs={[bet]} strategyId={strategy.id} stake={bet.stake} odds={bet.price} onLogged={onLogged} onError={onError} />
        <AddToSlip pick={bet} slip={slip} />
      </div>
    </article>
  );
}

function PassRow({ pass }: { pass: AiPass }) {
  return (
    <li>
      <div className="pass-top">
        <span className="strong">{pass.fixture}</span>
        <span className="small muted">{pass.sportTitle} · {kickoff(pass.commence)}</span>
      </div>
      <div className="small muted">{pass.reason}</div>
      {pass.watch && (
        <div className="small watch">
          <span className="strong">Watch: </span>
          {pass.watch.label} needs <span className="num">{pass.watch.minPrice.toFixed(2)}</span> or higher. Best now is{" "}
          <span className="num">{pass.watch.bestPrice.toFixed(2)}</span> at {pass.watch.book}.
        </div>
      )}
    </li>
  );
}

export function AiPicksView({
  strategy, run, busy, mode, aiKey, credits, slip, onRun, onLogged, onError,
}: {
  strategy: Strategy;
  run: AiPicksRun | null;
  busy: boolean;
  mode: "demo" | "live";
  aiKey: boolean;
  credits: number;
  slip: SlipControls;
  onRun: () => void;
  onLogged: () => void;
  onError: (message: string) => void;
}) {
  const watching = run?.passes.filter((p) => p.watch) ?? [];
  const others = run?.passes.filter((p) => !p.watch) ?? [];

  return (
    <div className="ai-picks">
      <section className="panel ai-run">
        <div>
          <h2>Bets Claude would place</h2>
          <p className="small muted">
            Claude reads the news on your next {strategy.ai.gamesToResearch} games, makes its own prediction, and chooses a bet or says no bet.
            A bet appears here only if the odds also support it. Each run uses up to {credits} odds credits plus Claude usage, and takes a few minutes.
          </p>
          {mode === "demo" && <p className="small warn-text">AI picks need real odds, so they don&apos;t run on demo data.</p>}
          {mode === "live" && !aiKey && <p className="small warn-text">Add ANTHROPIC_API_KEY to .env.local to use this.</p>}
        </div>
        <button className="btn primary" disabled={busy} onClick={onRun}>
          {busy ? "Researching…" : run ? "Run again" : "Get AI picks"}
        </button>
      </section>

      {busy && <div className="banner">Claude is searching for news on each game. You can use the other tabs while it works.</div>}

      {run && (
        <>
          <p className="small muted run-meta">
            Researched {run.gamesResearched} games {ago(run.at)} · about ${run.costUsd.toFixed(2)} of Claude usage. Odds may have moved, so check the price before betting.
          </p>

          {run.bets.length === 0 ? (
            <p className="empty">No bets from this run. Claude and the odds didn&apos;t agree on anything worth backing, and skipping is a valid result.</p>
          ) : (
            <div className="ai-bets">
              {run.bets.map((b) => <BetCard key={b.key} bet={b} strategy={strategy} slip={slip} onLogged={onLogged} onError={onError} />)}
            </div>
          )}

          {run.notes && (
            <section className="panel ai-note">
              <h2>Claude&apos;s overall notes</h2>
              <p>{run.notes}</p>
            </section>
          )}

          {watching.length > 0 && (
            <section className="panel">
              <h2>Watchlist: right side, price too low</h2>
              <ul className="pass-list">{watching.map((p) => <PassRow key={p.eventId} pass={p} />)}</ul>
            </section>
          )}

          {others.length > 0 && (
            <section className="panel">
              <h2>No bet</h2>
              <ul className="pass-list">{others.map((p) => <PassRow key={p.eventId} pass={p} />)}</ul>
            </section>
          )}
        </>
      )}

      <p className="small muted">
        These are predictions, not certainties, and Edgebook never places bets. Every recommendation is paper-tracked in the Ledger, so you can see if Claude&apos;s picks really make money before trusting them with bigger stakes.
      </p>
    </div>
  );
}
