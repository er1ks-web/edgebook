"use client";

import { useState } from "react";
import { kelly } from "@/lib/engine/odds";
import type { Strategy } from "@/lib/strategy";
import { money, signedPct } from "./common";

const CHECKS = [
  { title: "The price is still there", detail: "Compare your book's live odds with the pick. If they fell, type the real odds into the calculator below." },
  { title: "The edge clears your minimum at that price", detail: "Odds × fair chance − 1. A small price drop can wipe out a small edge." },
  { title: "The odds are fresh", detail: "Refresh close to betting. An edge seen an hour ago may be gone, and the fair price may have moved too." },
  { title: "You know why this book is different", detail: "Search for injuries and lineups, or run AI research. If your book knows something the reference books don't yet, the edge isn't real." },
  { title: "You can actually bet there", detail: "The book is legal for you, and its rules and stake limit work for this bet." },
  { title: "It adds no hidden risk", detail: "You aren't already on this game. Two bets on one game can win or lose together." },
  { title: "The stake is the suggested one or less", detail: "Never raise it because you feel sure or want to win back a loss." },
  { title: "Log it", detail: "An unlogged bet can't teach you anything. Record the odds you really got." },
];

const BREAK_EVEN = [1.3, 1.5, 1.7, 1.91, 2, 2.5, 3, 4, 5, 10];

const EDGES = [
  {
    name: "Bonuses and promotions",
    strength: "Strongest",
    why: "The book gives away value directly: free bets, deposit matches, odds boosts. A free bet can have positive value even at poor odds.",
    how: "Calculate it by hand for now. Put a boost's odds and the fair chance in the calculator.",
    catch: "Limited supply, and wagering rules can remove much of the value. Read the terms first.",
  },
  {
    name: "Soft book vs sharp price",
    strength: "Strong",
    why: "Sharp books and exchanges set prices closest to the truth. Retail books can be slower or differently priced, leaving gaps.",
    how: "This is what the Sharp value strategy does.",
    catch: "Winning this way regularly can get your account limited by the book.",
  },
  {
    name: "Shopping for the best price",
    strength: "Strong",
    why: "The same bet at 2.05 instead of 1.95 improves your return by about 5% on every bet, whatever else you do.",
    how: "Open accounts at the books you can legally use, then select them all in Strategy.",
    catch: "Takes several accounts and some admin.",
  },
  {
    name: "Beating slow reactions",
    strength: "Moderate",
    why: "When news hits, sharp prices move first and some books follow minutes later.",
    how: "Refresh around lineup announcements, about an hour before many soccer games.",
    catch: "The window is short, and every refresh costs credits.",
  },
  {
    name: "Arbitrage",
    strength: "Moderate",
    why: "When books disagree enough, you can back every outcome and lock in a small profit.",
    how: "Not built in yet.",
    catch: "Returns are thin, prices can vanish before the second bet, and it attracts account limits fast.",
  },
  {
    name: "Your own specialist knowledge",
    strength: "Hard",
    why: "Smaller leagues get less attention, so a real specialist can sometimes know more than the price.",
    how: "Write your rules into the AI strategy box and raise the adjustment limit only if your ledger supports it.",
    catch: "Sharp prices are weaker here too, so Edgebook's fair chance is less reliable. Most people overrate their own read.",
  },
];

const TRAPS = [
  { name: "Long parlays", why: "Each leg adds the book's margin. At 5% per leg, a typical 3-leg parlay gives up about 14% and a 6-leg about 25%. Only combine legs that each have their own edge." },
  { name: "Longshots", why: "They are usually the worst value on the board, and one big win hides many bad bets." },
  { name: "Doubling after a loss", why: "It doesn't change the odds of any bet. It only makes one bad run big enough to end your bankroll." },
  { name: "Hot and cold streaks", why: "At fair even odds, there's about a 39% chance of 10 straight losses somewhere in 1,000 bets. A streak alone proves nothing." },
  { name: "Paid tipsters", why: "Screenshots of winners prove nothing. Without every bet logged at the odds available then, ignore them." },
  { name: "Full Kelly stakes", why: "In a simulation with a true 52% chance at even odds, full Kelly fell 50% from a peak in about 9 of 10 runs of 1,000 bets. Quarter Kelly almost never did, and keeps about 44% of the growth rate." },
];

const SAMPLE = [
  { odds: "1.50", two: "4,700", five: "730" },
  { odds: "2.00", two: "9,600", five: "1,500" },
  { odds: "3.00", two: "19,400", five: "3,100" },
  { odds: "5.00", two: "39,000", five: "6,400" },
];

function Calculator({ strategy }: { strategy: Strategy }) {
  const [odds, setOdds] = useState("2.10");
  const [chance, setChance] = useState("50");
  const price = Number(odds);
  const prob = Number(chance) / 100;
  const valid = price > 1 && prob > 0 && prob < 1;

  const ev = prob * price - 1;
  const lowest = (1 + strategy.minEvPct / 100) / prob;
  const stake = Math.floor(strategy.bankroll * Math.min(kelly(prob, price) * strategy.kellyFraction, strategy.maxStakePct / 100) * 100) / 100;

  return (
    <section className="panel">
      <h2>Bet calculator</h2>
      <p className="small muted">Check a price you found, a boost, or a pick whose odds moved. Uses the {strategy.name} settings.</p>
      <div className="calc">
        <label className="field">
          <span className="field-label">Odds you can get</span>
          <input className="num" type="number" min="1.01" step="0.01" value={odds} onChange={(e) => setOdds(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Fair chance %</span>
          <input className="num" type="number" min="0.1" max="99.9" step="0.1" value={chance} onChange={(e) => setChance(e.target.value)} />
        </label>
      </div>
      {valid ? (
        <dl className="calc-result" aria-live="polite">
          <div><dt>Edge</dt><dd className={`num ${ev > 0 ? "up" : "down"}`}>{signedPct(ev)}</dd></div>
          <div><dt>Break-even odds</dt><dd className="num">{(1 / prob).toFixed(2)}</dd></div>
          <div><dt>Lowest odds to bet</dt><dd className="num">{lowest.toFixed(2)}</dd><dd className="small muted">for your {strategy.minEvPct}% minimum</dd></div>
          <div><dt>Suggested stake</dt><dd className="num">{money(stake)}</dd><dd className="small muted">{money(strategy.bankroll)} bankroll</dd></div>
        </dl>
      ) : (
        <p className="small warn-text">Enter odds above 1 and a chance between 0 and 100.</p>
      )}
    </section>
  );
}

export function PlaybookView({ strategy }: { strategy: Strategy }) {
  return (
    <div className="playbook">
      <section className="panel">
        <h2>Before every bet</h2>
        <p className="small muted">If any answer is no, skip the bet. There will be another one.</p>
        <ul className="checklist">
          {CHECKS.map((c) => (
            <li key={c.title}>
              <label>
                <input type="checkbox" />
                <span>
                  <span className="strong">{c.title}</span>
                  <span className="small muted check-detail">{c.detail}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <Calculator strategy={strategy} />

      <section className="panel">
        <h2>Break-even chance by odds</h2>
        <p className="small muted">The bet must win more often than this to make money.</p>
        <div className="break-even">
          {BREAK_EVEN.map((o) => (
            <div key={o}>
              <span className="num strong">{o.toFixed(2)}</span>
              <span className="num muted">{(100 / o).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">Where an edge can come from</h2>
        <div className="edge-list">
          {EDGES.map((e) => (
            <article className="panel edge" key={e.name}>
              <div className="edge-head">
                <h3>{e.name}</h3>
                <span className="chip">{e.strength}</span>
              </div>
              <p>{e.why}</p>
              <p className="small"><span className="strong">In Edgebook: </span><span className="muted">{e.how}</span></p>
              <p className="small"><span className="strong">The catch: </span><span className="muted">{e.catch}</span></p>
            </article>
          ))}
        </div>
        <p className="small muted">These rankings are a judgment based on how betting markets work, not measured returns. Your ledger is the real test.</p>
      </section>

      <section className="panel">
        <h2>Traps that feel like strategies</h2>
        <dl className="traps">
          {TRAPS.map((t) => (
            <div key={t.name}>
              <dt className="strong">{t.name}</dt>
              <dd className="small muted">{t.why}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel">
        <h2>How to know if it&apos;s working</h2>
        <p>Profit takes a very long time to prove anything. These are the bets needed for 95% confidence that an edge is real from results alone:</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Typical odds</th><th scope="col">2% edge</th><th scope="col">5% edge</th></tr>
            </thead>
            <tbody>
              {SAMPLE.map((r) => (
                <tr key={r.odds}><td className="num">{r.odds}</td><td className="num">{r.two}</td><td className="num">{r.five}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Use <span className="strong">Beat the close</span> in the Ledger instead. It compares your odds with the last fair price before kickoff,
          and it has far less noise than wins and losses. As a rule of thumb, look for a positive average across at least 50 to 100 bets.
          If it stays near zero or negative, the strategy probably has no edge, even if you are up money.
        </p>
      </section>

      <section className="panel">
        <h2>Rules to set in advance</h2>
        <ul className="plain-list">
          <li>Bet only from a bankroll you can afford to lose completely, kept apart from living money.</li>
          <li>Set a monthly limit for deposits, and don&apos;t move it after a loss.</li>
          <li>Stop for the day if you catch yourself betting to win something back.</li>
          <li>If betting stops being fun or starts causing stress, take a break and talk to someone. Free gambling support services exist in most countries.</li>
        </ul>
      </section>
    </div>
  );
}
