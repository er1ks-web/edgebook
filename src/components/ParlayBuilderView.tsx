"use client";

import { useMemo, useState } from "react";
import { assessSlip, legsAtBook, MAX_SLIP_LEGS } from "@/lib/engine/slip";
import type { Strategy } from "@/lib/strategy";
import type { Pick } from "@/lib/types";
import { kickoff, LogBet, money, pct, signedPct, type SlipControls } from "./common";

export interface OfferedPick {
  pick: Pick;
  sources: string[];
}

const VERDICT_CLASS: Record<string, string> = {
  good: "verdict-card good",
  thin: "verdict-card thin",
  poor: "verdict-card poor",
  started: "verdict-card poor",
  "same-game": "verdict-card poor",
  "no-book": "verdict-card poor",
  incomplete: "verdict-card",
};

const legTitle = (p: Pick) => `${p.home} vs ${p.away}`;

function Slip({
  legs, offeredKeys, strategy, slip, onLogged, onError,
}: {
  legs: Pick[];
  offeredKeys: Set<string>;
  strategy: Strategy;
  slip: SlipControls;
  onLogged: () => void;
  onError: (message: string) => void;
}) {
  const [book, setBook] = useState<string | undefined>();
  const result = useMemo(() => assessSlip(legs, strategy, book), [legs, strategy, book]);
  const { chosen } = result;
  const logKey = `${legs.map((l) => l.key).join("+")}@${chosen?.book}`;

  return (
    <section className="panel slip" aria-label="Your parlay">
      <div className="slip-head">
        <h2>Your parlay</h2>
        {legs.length > 0 && <button type="button" className="btn ghost tiny" onClick={slip.clear}>Clear</button>}
      </div>

      {legs.length === 0 ? (
        <p className="small muted">Add picks from the list, or use + Parlay on the Value and AI Picks tabs.</p>
      ) : (
        <ol className="slip-legs">
          {legs.map((leg) => {
            const priced = chosen?.legs.find((l) => l.pick.key === leg.key);
            return (
              <li key={leg.key}>
                <div className="leg-top">
                  <span>{leg.label}</span>
                  <span className="num">{(priced?.price ?? leg.price).toFixed(2)}</span>
                </div>
                <div className="small muted">{legTitle(leg)} · {kickoff(leg.commence)}</div>
                <div className="slip-leg-foot small">
                  <span className="muted">
                    Chance <span className="num">{pct(priced?.prob ?? leg.prob)}</span>
                    {priced && <> · Edge <span className={`num ${priced.ev >= 0 ? "up" : "down"}`}>{signedPct(priced.ev)}</span></>}
                  </span>
                  <button type="button" className="link-btn" onClick={() => slip.toggle(leg)}>Remove</button>
                </div>
                {!offeredKeys.has(leg.key) && <div className="small warn-text">No longer on your lists. This price may be out of date.</div>}
              </li>
            );
          })}
        </ol>
      )}

      <div className={VERDICT_CLASS[result.verdict]} role="status">
        <div className="verdict-head">{result.headline}</div>
        {result.reasons.map((r) => <p className="small" key={r}>{r}</p>)}
      </div>

      {chosen && (
        <>
          <label className="field">
            <span className="field-label">Bookmaker</span>
            <select value={chosen.book} onChange={(e) => setBook(e.target.value)}>
              {result.books.map((b) => (
                <option key={b.book} value={b.book}>{b.bookTitle}: {b.odds.toFixed(2)} ({signedPct(b.ev)})</option>
              ))}
            </select>
          </label>
          <dl className="ticket-numbers">
            <div><dt>Total odds</dt><dd className="num strong">{chosen.odds.toFixed(2)}</dd></div>
            <div><dt>Chance it hits</dt><dd className="num strong">{pct(chosen.hitProb)}</dd></div>
            <div><dt>Edge (EV)</dt><dd className={`num ${chosen.ev >= 0 ? "up" : "down"}`}>{signedPct(chosen.ev)}</dd></div>
            <div>
              <dt>Suggested stake</dt>
              {result.stake > 0
                ? <dd className="num">{money(result.stake)} → {money(result.payout)}</dd>
                : <dd className="small">None, there&apos;s no edge</dd>}
            </div>
          </dl>
          <p className="small muted">Check the price at your book first. Log it once you&apos;ve placed the bet, and enter the odds you really got.</p>
          {result.verdict !== "started" && result.verdict !== "same-game" && (
            <LogBet
              key={logKey}
              legs={legsAtBook(chosen)}
              strategyId={strategy.id}
              stake={result.stake}
              odds={chosen.odds}
              onLogged={onLogged}
              onError={onError}
            />
          )}
        </>
      )}
    </section>
  );
}

export function ParlayBuilderView({
  offered, legs, strategy, slip, onLogged, onError,
}: {
  offered: OfferedPick[];
  legs: Pick[];
  strategy: Strategy;
  slip: SlipControls;
  onLogged: () => void;
  onError: (message: string) => void;
}) {
  const offeredKeys = useMemo(() => new Set(offered.map((o) => o.pick.key)), [offered]);

  return (
    <div className="builder">
      <div className="builder-slip">
        <Slip legs={legs} offeredKeys={offeredKeys} strategy={strategy} slip={slip} onLogged={onLogged} onError={onError} />
      </div>
      <section className="builder-list">
        <h2>Picks you can add</h2>
        <p className="small muted">From your current strategy. Up to {MAX_SLIP_LEGS} legs per parlay.</p>
        {offered.length === 0 ? (
          <p className="empty">No picks right now. Refresh the odds, run AI Picks, or loosen the strategy.</p>
        ) : (
          <ul className="offer-list">
            {offered.map(({ pick, sources }) => {
              const added = slip.has(pick.key);
              return (
                <li key={pick.key} className={added ? "offer added" : "offer"}>
                  <div className="offer-main">
                    <div className="strong">{pick.label}</div>
                    <div className="small muted">{legTitle(pick)}</div>
                    <div className="small muted">{pick.sportTitle} · {kickoff(pick.commence)}</div>
                    <div className="offer-tags">
                      {sources.map((s) => <span className="chip" key={s}>{s}</span>)}
                    </div>
                  </div>
                  <div className="offer-side">
                    <div className="num strong">{pick.price.toFixed(2)}</div>
                    <div className="num small muted">{pct(pick.prob)}</div>
                    <div className={`num small ${pick.ev >= 0 ? "up" : "down"}`}>{signedPct(pick.ev)}</div>
                  </div>
                  <button
                    type="button"
                    className={added ? "btn" : "btn ghost"}
                    aria-pressed={added}
                    disabled={!added && slip.full}
                    onClick={() => slip.toggle(pick)}
                  >
                    {added ? "Remove" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
