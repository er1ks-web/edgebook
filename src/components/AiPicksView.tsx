"use client";

import type { Strategy } from "@/lib/strategy";
import { priceTag } from "@/lib/engine/aiPicks";
import type { AiBet, AiPass, AiPicksRun, Parlay } from "@/lib/types";
import { AddToSlip, ago, kickoff, LogBet, money, pct, signedPct, type SlipControls } from "./common";

const CONFIDENCE = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };

const PRICE = {
  good: { label: "Good", tone: "strong up" },
  fair: { label: "Fair", tone: "strong" },
  short: { label: "Short", tone: "strong warn-text" },
};

const otherPrices = (bet: AiBet) =>
  (bet.offers ?? [])
    .filter((o) => o.book !== bet.book)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map((o) => `${o.bookTitle} ${o.price.toFixed(2)}`)
    .join(", ");

function ParlayCard({ parlay, strategy, onLogged, onError }: { parlay: Parlay; strategy: Strategy; onLogged: () => void; onError: (m: string) => void }) {
  return (
    <article className="ai-bet">
      <header className="ai-bet-head">
        <div>
          <h3>{parlay.legs.length}-leg parlay</h3>
          <div className="small muted">All at {parlay.bookTitle}</div>
        </div>
      </header>
      <ul className="best-parlay-legs">
        {parlay.legs.map((l) => (
          <li key={l.key}>
            <div>{l.label} <span className="num muted">@ {l.price.toFixed(2)}</span></div>
            <div className="small muted">{l.home} vs {l.away} · {kickoff(l.commence)}</div>
          </li>
        ))}
      </ul>
      <dl className="ai-bet-numbers">
        <div><dt>Total odds</dt><dd className="num strong">{parlay.odds.toFixed(2)}</dd></div>
        <div><dt>Chance all hit</dt><dd className="num">{pct(parlay.hitProb)}</dd></div>
        <div><dt>Stake</dt><dd className="num strong">{money(parlay.stake)}</dd></div>
        <div><dt>Pays</dt><dd className="num">{money(parlay.payout)}</dd></div>
      </dl>
      <div className="ai-bet-actions">
        <LogBet legs={parlay.legs} strategyId={strategy.id} stake={parlay.stake} odds={parlay.odds} onLogged={onLogged} onError={onError} />
      </div>
    </article>
  );
}

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

      {bet.conviction !== undefined ? (
        <>
          <dl className="ai-bet-numbers">
            <div><dt>Strength</dt><dd className="num strong">{bet.conviction}/10</dd></div>
            <div><dt>Claude&apos;s chance</dt><dd className="num">{pct(bet.aiChance)}</dd></div>
            <div><dt>Market&apos;s chance</dt><dd className="num">{pct(bet.marketProb)}</dd></div>
            <div><dt>Best odds</dt><dd className="num strong">{bet.price.toFixed(2)}</dd><dd className="small muted">{bet.bookTitle}</dd></div>
            <div><dt>Price vs market</dt><dd className={PRICE[priceTag(bet.marketProb, bet.price)].tone}>{PRICE[priceTag(bet.marketProb, bet.price)].label}</dd></div>
            <div><dt>Stake</dt><dd className="num strong">{money(bet.stake)}</dd></div>
          </dl>
          <p className="small muted">
            At your bookmaker, compare your odds with <span className="num">{bet.minPrice.toFixed(2)}</span>, which is what this bet is worth on Claude&apos;s estimate. It can still win at lower odds, but it pays you less than that.
            {otherPrices(bet) && <> Also at: {otherPrices(bet)}.</>}
          </p>
        </>
      ) : (
        <dl className="ai-bet-numbers">
          <div><dt>Odds</dt><dd className="num strong">{bet.price.toFixed(2)}</dd><dd className="small muted">{bet.bookTitle}</dd></div>
          <div><dt>Claude&apos;s chance</dt><dd className="num">{pct(bet.aiChance)}</dd></div>
          <div><dt>Market&apos;s chance</dt><dd className="num">{pct(bet.marketProb)}</dd></div>
          <div><dt>Edge used</dt><dd className="num up">{signedPct(bet.ev)}</dd><dd className="small muted">at {pct(bet.prob)} blended</dd></div>
          <div><dt>Stake</dt><dd className="num strong">{money(bet.stake)}</dd></div>
          <div><dt>Bet only at</dt><dd className="num strong">{bet.minPrice.toFixed(2)} or higher</dd></div>
        </dl>
      )}

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
  const best = strategy.ai.pickStyle === "best";

  return (
    <div className="ai-picks">
      <section className="panel ai-run">
        <div>
          <h2>{best ? "Best singles and parlays" : "Bets Claude would place"}</h2>
          <p className="small muted">
            Claude checks form, streaks, injuries and news on {strategy.ai.researchAll ? "every game with a usable price" : `your next ${strategy.ai.gamesToResearch} games`}, makes its own prediction, and chooses a bet or says no bet.
            {best ? " Bets are ranked by how strong the case is, and a price doesn't block them, so underdogs can make the list." : " A bet appears here only if the odds also support it."} Each run uses up to {credits} odds credits plus Claude usage, and takes a few minutes.
            {strategy.ai.researchAll && " You'll see the number of games and the cost before it starts."}
          </p>
          {best && strategy.betBooks.length === 0 && (
            <p className="small warn-text">No bookmakers chosen, so odds may come from books you can&apos;t use. Choose yours under Strategy, in Books you can bet at.</p>
          )}
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
            <p className="empty">{run.style === "best" ? "No picks from this run. Claude didn't find a strong enough case in these games, or your odds limits ruled them out." : "No bets from this run. Claude and the odds didn't agree on anything worth backing, and skipping is a valid result."}</p>
          ) : (
            <div className="ai-bets">
              {run.bets.map((b) => <BetCard key={b.key} bet={b} strategy={strategy} slip={slip} onLogged={onLogged} onError={onError} />)}
            </div>
          )}

          {run.style === "best" && strategy.parlay.enabled && run.bets.length > 0 && !run.parlays?.length && (
            <p className="small muted">No parlay this run. It needs at least {strategy.parlay.minLegs} picks rated 5/10 or higher, at one of your books, within your parlay limits. Researching more games gives it more to choose from.</p>
          )}

          {(run.parlays?.length ?? 0) > 0 && (
            <section className="best-parlays">
              <h2>Parlays from these picks</h2>
              <p className="small muted">Built from the most likely strong picks. Each one is priced at a single bookmaker, and every leg has to win.</p>
              <div className="ai-bets">
                {run.parlays!.map((p) => <ParlayCard key={p.id} parlay={p} strategy={strategy} onLogged={onLogged} onError={onError} />)}
              </div>
            </section>
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
        These are predictions, not certainties, and Edgebook never places bets. Every single and parlay is paper-tracked in the Ledger, so you can see if Claude&apos;s picks really make money before trusting them with bigger stakes.
      </p>
    </div>
  );
}
