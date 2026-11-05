"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketKey } from "@/lib/types";
import { api, kickoff } from "./common";

interface Game {
  id: string;
  sportKey: string;
  sportTitle: string;
  commence: string;
  home: string;
  away: string;
}

interface DraftLeg {
  gameId?: string;
  sportKey: string;
  sportTitle: string;
  commence: string;
  home: string;
  away: string;
  market: MarketKey;
  selection: string;
  point?: number;
  price: number;
}

const NOT_LISTED = "__typed";

/** Formats a time for a datetime-local input, in the viewer's own time zone. */
function localInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function legLabel(leg: DraftLeg) {
  if (leg.market === "h2h") return leg.selection === "Draw" ? "Draw" : `${leg.selection} to win`;
  if (leg.market === "totals") return `${leg.selection} ${leg.point}`;
  return `${leg.selection} ${leg.point! > 0 ? "+" : ""}${leg.point}`;
}

export function AddPastBet({
  strategyId, onAdded, onError,
}: {
  strategyId: string | null;
  onAdded: () => void;
  onError: (message: string) => void;
}) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [search, setSearch] = useState("");
  const [gameId, setGameId] = useState("");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [commence, setCommence] = useState(() => localInput(new Date()));
  const [market, setMarket] = useState<MarketKey>("h2h");
  const [side, setSide] = useState("");
  const [point, setPoint] = useState("");
  const [price, setPrice] = useState("");
  const [legs, setLegs] = useState<DraftLeg[]>([]);
  const [book, setBook] = useState("");
  const [stake, setStake] = useState("");
  const [totalOdds, setTotalOdds] = useState("");
  const [placedAt, setPlacedAt] = useState(() => localInput(new Date()));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api<{ games: Game[] }>("/api/games")
      .then((r) => setGames(r.games))
      .catch((e) => onError(e.message));
  }, [onError]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = games ?? [];
    return q ? list.filter((g) => `${g.home} ${g.away} ${g.sportTitle}`.toLowerCase().includes(q)) : list;
  }, [games, search]);

  const typed = gameId === NOT_LISTED;
  const game = games?.find((g) => g.id === gameId);
  const homeName = typed ? home.trim() : game?.home ?? "";
  const awayName = typed ? away.trim() : game?.away ?? "";
  const hasTeams = Boolean(homeName && awayName);
  const hockey = game?.sportKey.startsWith("icehockey_");

  const productOdds = legs.reduce((a, l) => a * l.price, 1);
  const legsKey = legs.map((l) => l.price).join();
  useEffect(() => {
    if (legs.length) setTotalOdds(productOdds.toFixed(2));
    else setTotalOdds("");
    // Recalculate only when the legs change, so a typed total isn't overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legsKey, legs.length]);

  const sideOptions = market === "totals"
    ? ["Over", "Under"]
    : market === "spreads"
      ? [homeName, awayName]
      : [homeName, awayName, "Draw"];

  function addLeg() {
    setProblem(null);
    const odds = Number(price);
    const line = Number(point);
    if (!hasTeams) return setProblem("Choose a game, or type both teams or players.");
    if (!side) return setProblem("Choose what you bet on.");
    if (market !== "h2h" && (point.trim() === "" || !Number.isFinite(line))) return setProblem("Enter the line, such as 2.5.");
    if (!(odds > 1)) return setProblem("Enter the odds you got, above 1.");
    setLegs((current) => [
      ...current,
      {
        gameId: typed ? undefined : game?.id,
        sportKey: typed ? "manual" : game!.sportKey,
        sportTitle: typed ? "Added by hand" : game!.sportTitle,
        commence: typed ? new Date(commence).toISOString() : game!.commence,
        home: homeName,
        away: awayName,
        market,
        selection: side,
        point: market === "h2h" ? undefined : line,
        price: odds,
      },
    ]);
    setSide("");
    setPoint("");
    setPrice("");
    setGameId("");
    setSearch("");
    setHome("");
    setAway("");
  }

  async function save() {
    setProblem(null);
    setSaved(null);
    if (!strategyId) return setProblem("Choose a strategy first.");
    setSaving(true);
    try {
      await api("/api/bets/manual", {
        method: "POST",
        body: {
          strategyId,
          book,
          stake: Number(stake),
          odds: Number(totalOdds),
          placedAt: new Date(placedAt).toISOString(),
          legs,
        },
      });
      setSaved(legs.length > 1 ? `${legs.length}-leg parlay added.` : "Bet added.");
      setLegs([]);
      setStake("");
      onAdded();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="past-bet">
      <p className="small muted">
        For bets you&apos;ve already placed, including started or finished games. Add one leg for a single, or several for a parlay.
      </p>

      <fieldset className="past-section">
        <legend>{legs.length ? "Add another leg" : "The bet"}</legend>
        <div className="grid">
          <label className="field">
            <span className="field-label">Find a game</span>
            <input type="search" value={search} placeholder="Team, player or league" onChange={(e) => { setSearch(e.target.value); setGameId(""); setSide(""); }} />
          </label>
          <label className="field">
            <span className="field-label">Game</span>
            <select value={gameId} onChange={(e) => { setGameId(e.target.value); setSide(""); }}>
              <option value="">{games === null ? "Loading games…" : `Choose (${matches.length} found)`}</option>
              {matches.slice(0, 200).map((g) => (
                <option key={g.id} value={g.id}>{g.home} vs {g.away}, {kickoff(g.commence)}</option>
              ))}
              <option value={NOT_LISTED}>My game isn&apos;t listed, type it</option>
            </select>
          </label>
          {typed && (
            <>
              <label className="field">
                <span className="field-label">Home team or player</span>
                <input value={home} maxLength={80} onChange={(e) => { setHome(e.target.value); setSide(""); }} />
              </label>
              <label className="field">
                <span className="field-label">Away team or player</span>
                <input value={away} maxLength={80} onChange={(e) => { setAway(e.target.value); setSide(""); }} />
              </label>
              <label className="field">
                <span className="field-label">Kickoff</span>
                <input type="datetime-local" value={commence} onChange={(e) => setCommence(e.target.value)} />
              </label>
            </>
          )}
          <label className="field">
            <span className="field-label">Bet type</span>
            <select value={market} onChange={(e) => { setMarket(e.target.value as MarketKey); setSide(""); setPoint(""); }}>
              <option value="h2h">Match winner</option>
              <option value="totals">Over/under total</option>
              <option value="spreads">Spread or handicap</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Your pick</span>
            <select value={side} disabled={!hasTeams} onChange={(e) => setSide(e.target.value)}>
              <option value="">{hasTeams ? "Choose" : "Choose a game first"}</option>
              {hasTeams && sideOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          {market !== "h2h" && (
            <label className="field">
              <span className="field-label">Line</span>
              <input className="num" type="number" step="0.5" value={point} placeholder={market === "totals" ? "2.5" : "-1.5"} onChange={(e) => setPoint(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span className="field-label">Odds you got</span>
            <input className="num" type="number" min="1.01" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        {hockey && market !== "h2h" && <p className="small warn-text">Check if your book&apos;s line includes overtime. Mark this one by hand, because automatic checks can&apos;t tell.</p>}
        <button type="button" className="btn past-add" onClick={addLeg}>Add this {legs.length ? "leg" : "bet"}</button>
      </fieldset>

      {legs.length > 0 && (
        <fieldset className="past-section">
          <legend>{legs.length > 1 ? `Your parlay (${legs.length} legs)` : "Your bet"}</legend>
          <ul className="past-legs">
            {legs.map((l, i) => (
              <li key={`${l.home}-${l.selection}-${i}`}>
                <div>
                  <div>{legLabel(l)} <span className="num muted">@ {l.price.toFixed(2)}</span></div>
                  <div className="small muted">{l.home} vs {l.away} · {kickoff(l.commence)}</div>
                </div>
                <button type="button" className="link-btn" onClick={() => setLegs((c) => c.filter((_, x) => x !== i))}>Remove</button>
              </li>
            ))}
          </ul>
          <div className="grid">
            <label className="field">
              <span className="field-label">Bookmaker</span>
              <input value={book} maxLength={60} placeholder="Where you placed it" onChange={(e) => setBook(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Stake €</span>
              <input className="num" type="number" min="0.01" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">{legs.length > 1 ? "Total odds" : "Odds"}</span>
              <input className="num" type="number" min="1.01" step="0.01" value={totalOdds} onChange={(e) => setTotalOdds(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Placed on</span>
              <input type="datetime-local" value={placedAt} onChange={(e) => setPlacedAt(e.target.value)} />
            </label>
          </div>
          <button type="button" className="btn primary past-add" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save to ledger"}
          </button>
        </fieldset>
      )}

      {problem && <p className="small warn-text" role="alert">{problem}</p>}
      {saved && <p className="small logged" role="status">{saved} Mark Won, Lost or Push on it below once it&apos;s finished.</p>}
    </div>
  );
}
