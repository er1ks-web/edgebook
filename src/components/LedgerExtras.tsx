"use client";

import { useMemo, useState } from "react";
import { bankrollSummary, breakdown, byStrength, calibration, DIMENSIONS, type Dimension, monthly } from "@/lib/ledgerStats";
import { parseLogList, type LogBet } from "@/lib/logList";
import type { Bet, Money, MoneyEntry } from "@/lib/types";
import { api, money, pct, signedMoney, signedPct, Stat } from "./common";

const BOOK_KEY = "edgebook.promptBookmaker";
const SUGGESTED_TAGS = ["From prompt", "My own idea"];

const readBook = () => {
  try { return localStorage.getItem(BOOK_KEY) ?? ""; } catch { return ""; }
};

/** Adds every bet from the chat's log list at once. Reading it is done here, so it's free. */
export function LogListImport({ strategyId, onAdded, onError }: { strategyId: string | null; onAdded: () => void; onError: (m: string) => void }) {
  const [text, setText] = useState("");
  const [book, setBook] = useState(readBook);
  const [preview, setPreview] = useState<{ bets: LogBet[]; problems: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function save() {
    if (!preview || !strategyId) return;
    if (!book.trim()) return onError("Enter the bookmaker these bets were placed at.");
    setSaving(true);
    let added = 0;
    const failed: string[] = [];
    const now = new Date().toISOString();
    for (const bet of preview.bets) {
      try {
        await api("/api/bets/manual", {
          method: "POST",
          body: {
            strategyId,
            book: book.trim(),
            stake: bet.stake,
            odds: bet.odds,
            placedAt: now,
            tags: ["From prompt"],
            legs: bet.legs.map((l) => ({
              sportKey: "manual",
              sportTitle: "Added by hand",
              commence: l.commence ? new Date(l.commence).toISOString() : now,
              home: l.home,
              away: l.away,
              market: l.market,
              selection: l.selection,
              point: l.point,
              price: l.price,
              chance: l.chance,
              strength: l.strength,
            })),
          },
        });
        added++;
      } catch (err) {
        failed.push(`${bet.legs.map((l) => l.label).join(" + ")}: ${(err as Error).message}`);
      }
    }
    setSaving(false);
    setDone(`Added ${added} of ${preview.bets.length} bets.${failed.length ? ` Not added: ${failed.join("; ")}` : ""}`);
    if (added) {
      setText("");
      setPreview(null);
      onAdded();
    }
  }

  const missingKickoff = preview?.bets.some((b) => b.legs.some((l) => !l.commence));

  return (
    <div className="past-bet">
      <p className="small muted">Paste the LOG LIST from your research chat. Reading it is free, and nothing is saved until you press Add.</p>
      <div className="grid">
        <label className="field wide">
          <span className="field-label">Log list</span>
          <textarea rows={6} value={text} placeholder={"Arsenal vs Chelsea | 2026-11-08 17:30 | Arsenal to win | 2.10 | 5 | 55% | 7\nPARLAY | 3.55 | 2\n+ Inter vs Roma | 2026-11-09 20:45 | Over 2.5 | 1.80 | 60% | 6"} onChange={(e) => { setText(e.target.value); setPreview(null); setDone(null); }} />
        </label>
        <label className="field">
          <span className="field-label">Bookmaker</span>
          <input value={book} maxLength={60} placeholder="Betsafe" onChange={(e) => {
            setBook(e.target.value);
            try { localStorage.setItem(BOOK_KEY, e.target.value); } catch { /* storage may be blocked */ }
          }} />
        </label>
      </div>
      <button type="button" className="btn past-add" disabled={!text.trim()} onClick={() => setPreview(parseLogList(text))}>Read the list</button>

      {preview && (
        <fieldset className="past-section">
          <legend>{preview.bets.length ? `${preview.bets.length} bets found` : "No bets found"}</legend>
          <ul className="past-legs">
            {preview.bets.map((b, i) => (
              <li key={i}>
                <div>
                  <div>{b.legs.length > 1 ? `${b.legs.length}-leg parlay` : b.legs[0].label} <span className="num muted">@ {b.odds.toFixed(2)} · {money(b.stake)}</span></div>
                  {b.legs.map((l, j) => (
                    <div className="small muted" key={j}>
                      {b.legs.length > 1 && `${l.label} @ ${l.price.toFixed(2)} · `}{l.home} vs {l.away}{l.commence ? ` · ${l.commence.replace("T", " ")}` : " · no kickoff"}
                      {l.chance !== undefined && ` · chat ${Math.round(l.chance * 100)}%`}{l.strength !== undefined && ` · ${l.strength}/10`}
                    </div>
                  ))}
                </div>
                <button type="button" className="link-btn" onClick={() => setPreview({ ...preview, bets: preview.bets.filter((_, x) => x !== i) })}>Remove</button>
              </li>
            ))}
          </ul>
          {missingKickoff && <p className="small warn-text">Some bets have no kickoff, so they use the current time. That only affects which day they count on.</p>}
          {preview.problems.length > 0 && <ul className="small warn-text">{preview.problems.map((p) => <li key={p}>Skipped: {p}</li>)}</ul>}
          {preview.bets.length > 0 && (
            <button type="button" className="btn primary past-add" disabled={saving || !strategyId} onClick={save}>
              {saving ? "Adding…" : `Add ${preview.bets.length} bets to the ledger`}
            </button>
          )}
        </fieldset>
      )}
      {done && <p className="small logged" role="status">{done}</p>}
    </div>
  );
}

/** A bet's note and tags, shown on its card and edited in place. */
export function BetNotes({ bet, onChange, onError }: { bet: Bet; onChange: (b: Bet) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(bet.note ?? "");
  const [tags, setTags] = useState((bet.tags ?? []).join(", "));

  const tagList = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { bet: next } = await api<{ bet: Bet }>(`/api/bets/${bet.id}`, { method: "PATCH", body: { note: note.trim(), tags: tagList(tags) } });
      onChange(next);
      setEditing(false);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  if (editing) {
    return (
      <form className="bet-notes-form" onSubmit={save}>
        <label className="field">
          <span className="field-label">Tags, separated by commas</span>
          <input value={tags} maxLength={200} onChange={(e) => setTags(e.target.value)} />
        </label>
        <div className="chips">
          {SUGGESTED_TAGS.filter((t) => !tagList(tags).includes(t)).map((t) => (
            <button type="button" key={t} className="chip-toggle" onClick={() => setTags([...tagList(tags), t].join(", "))}>+ {t}</button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">Note</span>
          <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="prompt-actions">
          <button className="btn tiny">Save</button>
          <button type="button" className="link-btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className="bet-notes small">
      {bet.tags?.map((t) => <span key={t} className="chip">{t}</span>)}
      {bet.note && <span className="muted">{bet.note}</span>}
      <button type="button" className="link-btn" onClick={() => setEditing(true)}>{bet.note || bet.tags?.length ? "Edit notes" : "Add notes or tags"}</button>
    </div>
  );
}

const DIMENSION_KEYS = Object.keys(DIMENSIONS) as Dimension[];

/** Results split by type, league and more, and whether the chat's research holds up. */
export function StatsPanel({ bets }: { bets: Bet[] }) {
  const [dimension, setDimension] = useState<Dimension>("type");
  const rows = useMemo(() => breakdown(bets, dimension), [bets, dimension]);
  const calib = useMemo(() => calibration(bets), [bets]);
  const strength = useMemo(() => byStrength(bets), [bets]);

  return (
    <>
      <section className="panel">
        <h2>Breakdown</h2>
        <div className="segmented bet-filter" role="group" aria-label="Split results by">
          {DIMENSION_KEYS.map((d) => (
            <button key={d} className={d === dimension ? "on" : ""} aria-pressed={d === dimension} onClick={() => setDimension(d)}>{DIMENSIONS[d].label}</button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="small muted">No settled bets yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="stats-table">
              <thead><tr><th>{DIMENSIONS[dimension].label}</th><th>Bets</th><th>Won</th><th>Hit rate</th><th>Staked</th><th>Profit</th><th>Return</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.key}</td>
                    <td className="num">{r.settled}</td>
                    <td className="num">{r.won}</td>
                    <td className="num">{r.hitRate === null ? "n/a" : pct(r.hitRate, 0)}</td>
                    <td className="num">{money(r.staked)}</td>
                    <td className={`num ${r.profit > 0 ? "up" : r.profit < 0 ? "down" : ""}`}>{signedMoney(r.profit)}</td>
                    <td className="num">{r.roi === null ? "n/a" : signedPct(r.roi, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">A few bets per row is mostly luck. Look for patterns that hold over 30 or more.</p>
      </section>

      <section className="panel">
        <h2>Is the chat&apos;s research any good?</h2>
        {calib.length === 0 && strength.length === 0 ? (
          <p className="small muted">This fills in as bets from the chat&apos;s log list settle, because those include its chance and strength score.</p>
        ) : (
          <>
            {calib.length > 0 && (
              <div className="table-wrap">
                <table className="stats-table">
                  <thead><tr><th>Chat said</th><th>Bets</th><th>Expected wins</th><th>Actual wins</th><th>Chat&apos;s average</th><th>Real hit rate</th></tr></thead>
                  <tbody>
                    {calib.map((r) => (
                      <tr key={r.band}>
                        <td>{r.band}</td>
                        <td className="num">{r.bets}</td>
                        <td className="num">{r.expected.toFixed(1)}</td>
                        <td className="num">{r.won}</td>
                        <td className="num">{pct(r.predicted, 0)}</td>
                        <td className={`num ${r.actual < r.predicted - 0.1 ? "down" : ""}`}>{pct(r.actual, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted">If real hit rates stay well below what the chat said, its chances are too confident. A parlay&apos;s chance is its legs&apos; chances multiplied.</p>
            {strength.length > 0 && (
              <div className="table-wrap">
                <table className="stats-table">
                  <thead><tr><th>Strength</th><th>Bets</th><th>Hit rate</th><th>Profit</th><th>Return</th></tr></thead>
                  <tbody>
                    {strength.map((r) => (
                      <tr key={r.key}>
                        <td>{r.key}</td>
                        <td className="num">{r.settled}</td>
                        <td className="num">{r.hitRate === null ? "n/a" : pct(r.hitRate, 0)}</td>
                        <td className={`num ${r.profit > 0 ? "up" : r.profit < 0 ? "down" : ""}`}>{signedMoney(r.profit)}</td>
                        <td className="num">{r.roi === null ? "n/a" : signedPct(r.roi, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted">Stronger picks should do better. A parlay is rated by its weakest leg.</p>
          </>
        )}
      </section>
    </>
  );
}

const KIND_LABEL: Record<MoneyEntry["kind"], string> = { deposit: "Deposit", withdrawal: "Withdrawal", cost: "Cost" };

const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/** Bankroll, costs, monthly results and your stake limits. */
export function MoneyPanel({ bets, money: data, onChange, onError }: { bets: Bet[]; money: Money; onChange: (m: Money) => void; onError: (m: string) => void }) {
  const [kind, setKind] = useState<MoneyEntry["kind"]>("deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(localNow);
  const [daily, setDaily] = useState(data.limits.dailyStake?.toString() ?? "");
  const [weekly, setWeekly] = useState(data.limits.weeklyStake?.toString() ?? "");
  const summary = bankrollSummary(bets, data.entries);
  const months = monthly(bets, data.entries);
  const recent = [...data.entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ money: Money }>("/api/money", { method: "POST", body: { kind, amount: Number(amount), note, at: new Date(`${date}T12:00:00`).toISOString() } });
      onChange(r.money);
      setAmount("");
      setNote("");
    } catch (err) {
      onError((err as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      onChange((await api<{ money: Money }>(`/api/money?id=${encodeURIComponent(id)}`, { method: "DELETE" })).money);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  async function saveLimits(e: React.FormEvent) {
    e.preventDefault();
    const value = (s: string) => (s.trim() === "" ? null : Number(s));
    try {
      onChange((await api<{ money: Money }>("/api/money", { method: "PUT", body: { dailyStake: value(daily), weeklyStake: value(weekly) } })).money);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <section className="panel">
      <h2>Bankroll and costs</h2>
      <div className="stats paper-stats record-stats">
        <Stat label="Balance" value={money(summary.balance)} note={summary.open ? `after ${money(summary.open)} in open bets` : "deposits, withdrawals and results"} />
        <Stat label="Betting profit" value={signedMoney(summary.betting)} tone={summary.betting > 0 ? "up" : summary.betting < 0 ? "down" : undefined} />
        <Stat label="Costs" value={money(summary.costs)} note="Claude and other tools" />
        <Stat label="Profit after costs" value={signedMoney(summary.afterCosts)} tone={summary.afterCosts > 0 ? "up" : summary.afterCosts < 0 ? "down" : undefined} />
        <Stat label="Deposited" value={money(summary.deposits)} note={`${money(summary.withdrawals)} withdrawn`} />
      </div>

      <form className="money-form" onSubmit={add}>
        <label className="field">
          <span className="field-label">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as MoneyEntry["kind"])}>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="cost">Cost, such as Claude</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Amount €</span>
          <input className="num" type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Note</span>
          <input value={note} maxLength={120} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn">Add</button>
      </form>

      {recent.length > 0 && (
        <ul className="money-list small">
          {recent.map((e) => (
            <li key={e.id}>
              <span>{e.at.slice(0, 10)} · {KIND_LABEL[e.kind]}{e.note && ` · ${e.note}`}</span>
              <span className="num">{e.kind === "deposit" ? "" : "-"}{money(e.amount)}</span>
              <button type="button" className="link-btn" onClick={() => remove(e.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      {months.length > 0 && (
        <div className="table-wrap">
          <table className="stats-table">
            <thead><tr><th>Month</th><th>Bets</th><th>Betting profit</th><th>Costs</th><th>After costs</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="num">{m.bets}</td>
                  <td className={`num ${m.profit > 0 ? "up" : m.profit < 0 ? "down" : ""}`}>{signedMoney(m.profit)}</td>
                  <td className="num">{money(m.costs)}</td>
                  <td className={`num ${m.net > 0 ? "up" : m.net < 0 ? "down" : ""}`}>{signedMoney(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Stake limits</h3>
      <form className="money-form" onSubmit={saveLimits}>
        <label className="field">
          <span className="field-label">Most per day €</span>
          <input className="num" type="number" min="0.01" step="0.01" placeholder="No limit" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Most per week €</span>
          <input className="num" type="number" min="0.01" step="0.01" placeholder="No limit" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
        </label>
        <button className="btn">Save limits</button>
      </form>
      <p className="small muted">The ledger warns you when you go over these. It can&apos;t stop a bet at your bookmaker, so set limits there too.</p>
    </section>
  );
}
