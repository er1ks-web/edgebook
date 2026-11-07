"use client";

import { useEffect, useMemo, useState } from "react";
import { MAX_RESEARCH_ALL } from "@/lib/engine/aiPicks";
import { LOW_TIER_LEAGUES, type Strategy } from "@/lib/strategy";
import { LEDGER_ONLY } from "@/lib/features";
import { api } from "./common";
import { BuildSummary, Questionnaire, type BuildResult } from "./Questionnaire";

export interface SportInfo { key: string; title: string; group: string }

const LOW_TIER_GROUP = "Low-tier football";

/** Number input that allows a partly typed value. `scale` shows 0.25 as 25. */
function NumberField({
  label, value, onChange, hint, scale = 1, step = "any", suffix,
}: {
  label: string; value: number; onChange: (n: number) => void; hint?: string; scale?: number; step?: string; suffix?: string;
}) {
  const shown = String(+(value * scale).toFixed(4));
  const [text, setText] = useState(shown);
  useEffect(() => {
    if (Number(text) !== Number(shown)) setText(shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          className="num"
          type="number"
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) onChange(n / scale);
          }}
          onBlur={() => setText(shown)}
        />
        {suffix && <span className="muted small">{suffix}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Choice<T extends string>({
  label, value, options, onChange, hint,
}: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Chips({ options, selected, onChange }: { options: { value: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="chips">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            className={on ? "chip-toggle on" : "chip-toggle"}
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value])}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const MARKETS = [
  { value: "h2h", label: "Match winner" },
  { value: "spreads", label: "Spreads" },
  { value: "totals", label: "Totals" },
];
const REGIONS = [
  { value: "eu", label: "Europe" },
  { value: "uk", label: "UK" },
  { value: "us", label: "US" },
  { value: "us2", label: "US 2" },
  { value: "au", label: "Australia" },
];

export function StrategyView({
  strategy, sports, books, canDelete, onSaved, onDeleted, onError,
}: {
  strategy: Strategy;
  sports: SportInfo[];
  books: { key: string; title: string }[];
  canDelete: boolean;
  onSaved: (s: Strategy) => Promise<void>;
  onDeleted: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(strategy);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [showQuestions, setShowQuestions] = useState(true);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(strategy), [draft, strategy]);

  const set = <K extends keyof Strategy>(key: K, value: Strategy[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const setParlay = <K extends keyof Strategy["parlay"]>(key: K, value: Strategy["parlay"][K]) => set("parlay", { ...draft.parlay, [key]: value });
  const setAi = <K extends keyof Strategy["ai"]>(key: K, value: Strategy["ai"][K]) => set("ai", { ...draft.ai, [key]: value });

  const sportGroups = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const s of sports) {
      const group = LOW_TIER_LEAGUES.includes(s.key) ? LOW_TIER_GROUP : s.group;
      groups.set(group, [...(groups.get(group) ?? []), { value: s.key, label: s.title }]);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [sports]);

  const unavailable = draft.sports.filter((k) => sports.length > 0 && !sports.some((s) => s.key === k));
  const lowTier = LOW_TIER_LEAGUES.filter((k) => sports.some((s) => s.key === k));
  const withoutLowTier = draft.sports.filter((k) => !LOW_TIER_LEAGUES.includes(k));
  const credits = draft.sports.length * draft.markets.length * draft.regions.length;

  async function save(next: Strategy) {
    setSaving(true);
    try {
      await api("/api/strategies", { method: "PUT", body: next });
      await onSaved(next);
      setSaved(true);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the strategy "${strategy.name}"? Logged bets are kept.`)) return;
    try {
      await api(`/api/strategies?id=${encodeURIComponent(strategy.id)}`, { method: "DELETE" });
      await onDeleted();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <form className="strategy" onSubmit={(e) => { e.preventDefault(); save(draft); }}>
      <div className="save-bar">
        <div className="save-state small">
          {dirty ? "Unsaved changes" : saved ? "Saved, and picks are updated" : "Saved"}
        </div>
        <div className="save-actions">
          <button type="button" className="btn ghost" disabled={saving} onClick={() => save({ ...draft, id: `s-${Date.now().toString(36)}`, name: `${draft.name} copy`.slice(0, 60) })}>Save as copy</button>
          {canDelete && <button type="button" className="btn ghost danger" disabled={saving} onClick={remove}>Delete</button>}
          <button className="btn primary" disabled={!dirty || saving}>{saving ? "Saving…" : "Save strategy"}</button>
        </div>
      </div>

      {result && <BuildSummary result={result} strategy={draft} />}

      {showQuestions ? (
        <Questionnaire
          draft={draft}
          onBuilt={(built) => {
            setDraft(built.strategy);
            setResult(built);
            setSaved(false);
            setShowQuestions(false);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onError={onError}
        />
      ) : (
        <button type="button" className="btn retake" onClick={() => setShowQuestions(true)}>Answer the questions again</button>
      )}

      <details className="advanced">
        <summary>Adjust the settings yourself</summary>

      <section className="panel">
        <h2>Identity</h2>
        <div className="grid">
          <label className="field wide">
            <span className="field-label">Name</span>
            <input value={draft.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="field wide">
            <span className="field-label">Description</span>
            <input value={draft.description} maxLength={240} onChange={(e) => set("description", e.target.value)} />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>{LEDGER_ONLY ? "Leagues and bet types" : "What to scan"}</h2>
        {unavailable.length > 0 && <p className="small warn-text">Not available right now, or out of season: {unavailable.join(", ")}</p>}
        <div className="sport-groups">
          {sportGroups.map(([group, options]) => (
            <div key={group}>
              <h3>{group}</h3>
              {group === LOW_TIER_GROUP && (
                <div className="league-actions">
                  <button type="button" className="btn ghost tiny" onClick={() => set("sports", lowTier)}>Only these</button>
                  <button type="button" className="btn ghost tiny" onClick={() => set("sports", [...withoutLowTier, ...lowTier])}>Add all</button>
                  <button type="button" className="btn ghost tiny" disabled={!withoutLowTier.length} onClick={() => set("sports", withoutLowTier)}>Remove all</button>
                </div>
              )}
              <Chips options={options} selected={draft.sports} onChange={(sel) => set("sports", sel)} />
            </div>
          ))}
        </div>
        <h3>Markets</h3>
        <Chips options={MARKETS} selected={draft.markets} onChange={(m) => set("markets", m as Strategy["markets"])} />
        {!LEDGER_ONLY && (
          <>
            <h3>Bookmaker regions</h3>
            <Chips options={REGIONS} selected={draft.regions} onChange={(r) => set("regions", r as Strategy["regions"])} />
            <p className="field-hint">A live refresh of this setup costs up to {credits} odds credits. Saving fetches odds only for leagues that don&apos;t have them yet, and changing markets or regions means fetching every league again.</p>
            <h3>Books you can bet at</h3>
            {books.length ? (
              <Chips options={books.map((b) => ({ value: b.key, label: b.title }))} selected={draft.betBooks} onChange={(b) => set("betBooks", b)} />
            ) : (
              <p className="field-hint">Refresh the odds to list books.</p>
            )}
            <p className="field-hint">Leave all off to show any book. All books still help set the fair price.</p>
          </>
        )}
        <div className="grid">
          <NumberField label="Starts in at least" suffix="hours" value={draft.minHoursAhead} onChange={(n) => set("minHoursAhead", n)} />
          <NumberField label="Starts in at most" suffix="hours" value={draft.maxHoursAhead} onChange={(n) => set("maxHoursAhead", n)} />
        </div>
      </section>

      {!LEDGER_ONLY && (
      <section className="panel">
        <h2>How fair value is judged</h2>
        <div className="grid">
          <Choice
            label="Fair price comes from"
            value={draft.fairSource}
            onChange={(v) => set("fairSource", v)}
            options={[{ value: "sharp", label: "Sharp books only" }, { value: "consensus", label: "All books, sharps weighted" }]}
            hint="Sharp books such as Pinnacle and exchanges set the most accurate prices."
          />
          <Choice
            label="Margin removal"
            value={draft.devig}
            onChange={(v) => set("devig", v)}
            options={[{ value: "power", label: "Power (favors favorites)" }, { value: "multiplicative", label: "Proportional" }]}
            hint="Power accounts for longshots being overpriced."
          />
          <NumberField label="Minimum reference books" step="1" value={draft.minReferenceBooks} onChange={(n) => set("minReferenceBooks", n)} />
          <NumberField label="Ignore prices older than" suffix="min" value={draft.maxStalenessMin} onChange={(n) => set("maxStalenessMin", n)} />
          <NumberField label="Exchange commission" suffix="%" value={draft.exchangeCommissionPct} onChange={(n) => set("exchangeCommissionPct", n)} hint="Taken off Betfair and Matchbook winnings before the edge is worked out." />
        </div>
      </section>
      )}

      <section className="panel">
        <h2>Which picks qualify</h2>
        <div className="grid">
          {!LEDGER_ONLY && <NumberField label="Minimum edge" suffix="%" value={draft.minEvPct} onChange={(n) => set("minEvPct", n)} />}
          {!LEDGER_ONLY && <NumberField label="Maximum edge" suffix="%" value={draft.maxEvPct} onChange={(n) => set("maxEvPct", n)} hint="Huge edges are usually stale prices or errors." />}
          <NumberField label="Minimum odds" value={draft.minOdds} onChange={(n) => set("minOdds", n)} />
          <NumberField label="Maximum odds" value={draft.maxOdds} onChange={(n) => set("maxOdds", n)} />
          {!LEDGER_ONLY && <NumberField label="Maximum picks" step="1" value={draft.maxPicks} onChange={(n) => set("maxPicks", n)} />}
          <NumberField label="Picks per game" step="1" value={draft.maxPicksPerEvent} onChange={(n) => set("maxPicksPerEvent", n)} />
          {!LEDGER_ONLY && (
            <Choice
              label="Rank by"
              value={draft.rankBy}
              onChange={(v) => set("rankBy", v)}
              options={[{ value: "ev", label: "Highest edge" }, { value: "stake", label: "Largest stake" }, { value: "probability", label: "Most likely to win" }]}
            />
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Staking</h2>
        <div className="grid">
          <NumberField label="Bankroll" suffix="€" value={draft.bankroll} onChange={(n) => set("bankroll", n)} hint="Only money you can afford to lose." />
          <NumberField label="Kelly fraction" suffix="%" scale={100} value={draft.kellyFraction} onChange={(n) => set("kellyFraction", n)} hint="25% is a common cautious choice. Full Kelly swings hard." />
          <NumberField label="Maximum stake" suffix="% of bankroll" value={draft.maxStakePct} onChange={(n) => set("maxStakePct", n)} />
        </div>
      </section>

      <section className="panel">
        <h2>Parlays</h2>
        <label className="check">
          <input type="checkbox" checked={draft.parlay.enabled} onChange={(e) => setParlay("enabled", e.target.checked)} />
          Build parlays
        </label>
        {draft.parlay.enabled && (
          <div className="grid">
            <NumberField label="Minimum legs" step="1" value={draft.parlay.minLegs} onChange={(n) => setParlay("minLegs", n)} />
            <NumberField label="Maximum legs" step="1" value={draft.parlay.maxLegs} onChange={(n) => setParlay("maxLegs", n)} />
            <NumberField label="Minimum total odds" value={draft.parlay.minCombinedOdds} onChange={(n) => setParlay("minCombinedOdds", n)} />
            <NumberField label="Maximum total odds" value={draft.parlay.maxCombinedOdds} onChange={(n) => setParlay("maxCombinedOdds", n)} />
            {!LEDGER_ONLY && <NumberField label="Minimum edge per leg" suffix="%" value={draft.parlay.legMinEvPct} onChange={(n) => setParlay("legMinEvPct", n)} hint="A leg with no edge drags the whole ticket down." />}
            <NumberField label="Minimum leg odds" value={draft.parlay.legMinOdds} onChange={(n) => setParlay("legMinOdds", n)} />
            <NumberField label="Maximum leg odds" value={draft.parlay.legMaxOdds} onChange={(n) => setParlay("legMaxOdds", n)} />
            <NumberField label="Minimum hit chance" suffix="%" value={draft.parlay.minHitProbPct} onChange={(n) => setParlay("minHitProbPct", n)} />
            <NumberField label="Legs per sport" step="1" value={draft.parlay.maxPerSport} onChange={(n) => setParlay("maxPerSport", n)} />
            <NumberField label="Tickets to show" step="1" value={draft.parlay.count} onChange={(n) => setParlay("count", n)} />
            {!LEDGER_ONLY && <NumberField label="Kelly fraction" suffix="%" scale={100} value={draft.parlay.kellyFraction} onChange={(n) => setParlay("kellyFraction", n)} />}
            <NumberField label="Maximum stake" suffix="% of bankroll" value={draft.parlay.maxStakePct} onChange={(n) => setParlay("maxStakePct", n)} />
          </div>
        )}
      </section>

      <section className="panel">
        <h2>{LEDGER_ONLY ? "How Claude should pick" : "AI picks and research"}</h2>
        <label className="field wide">
          <span className="field-label">Your strategy, in your own words</span>
          <textarea
            rows={5}
            maxLength={4000}
            value={draft.ai.instructions}
            placeholder="Example: Be skeptical of away teams on short rest. Favor Unders when heavy rain is forecast. Pass on anything right after a European midweek game."
            onChange={(e) => setAi("instructions", e.target.value)}
          />
          <span className="field-hint">{LEDGER_ONLY ? "Added to the research prompt in your own words." : "Claude applies this while it researches your top selections, and needs evidence to change a probability."}</span>
        </label>
        <div className="grid">
          <Choice
            label={LEDGER_ONLY ? "What to look for" : "What Best Picks looks for"}
            value={draft.ai.pickStyle}
            onChange={(v) => setAi("pickStyle", v)}
            options={[{ value: "best", label: "Most likely to come in" }, { value: "value", label: "Only bets with a price edge" }]}
            hint="Most likely ranks by Claude's reasoning on form and news, and only shows how the price compares."
          />
          <NumberField label="Stake on each best pick" suffix="% of bankroll" value={draft.ai.flatStakePct} onChange={(n) => setAi("flatStakePct", n)} hint="A flat stake, because most likely picks may have no price edge to size a bet from. It never goes above your largest stake." />
          {!LEDGER_ONLY && (
          <Choice
            label="Games to research"
            value={draft.ai.researchAll ? "all" : "next"}
            onChange={(v) => setAi("researchAll", v === "all")}
            options={[{ value: "next", label: "The next few" }, { value: "all", label: "Every game" }]}
            hint={`Soonest first, at roughly $0.40 per game. Every game stops at ${MAX_RESEARCH_ALL} per run, about $${Math.round(MAX_RESEARCH_ALL * 0.4)}, and asks you first.`}
          />
          )}
          {!LEDGER_ONLY && !draft.ai.researchAll && <NumberField label="How many games" step="1" value={draft.ai.gamesToResearch} onChange={(n) => setAi("gamesToResearch", n)} />}
          <NumberField label={LEDGER_ONLY ? "Most singles" : "Most bets per run"} step="1" value={draft.ai.picksCount} onChange={(n) => setAi("picksCount", n)} />
          {LEDGER_ONLY && draft.ai.pickStyle === "value" && <NumberField label="Minimum edge" suffix="%" value={draft.ai.minEdgePct} onChange={(n) => setAi("minEdgePct", n)} />}
          {!LEDGER_ONLY && (
          <>
          <NumberField label="Trust in Claude's estimate" suffix="%" value={draft.ai.aiWeightPct} onChange={(n) => setAi("aiWeightPct", n)} hint="How much of the gap between Claude and the market to accept. Raise it only if the Ledger's track record supports it." />
          <NumberField label="Minimum edge for AI picks" suffix="%" value={draft.ai.minEdgePct} onChange={(n) => setAi("minEdgePct", n)} />
          <NumberField label="Largest AI adjustment" suffix="pts" value={draft.ai.maxAdjustmentPts} onChange={(n) => setAi("maxAdjustmentPts", n)} hint="A hard cap on how far Claude can move a market probability." />
          <NumberField label="Value picks to check" step="1" value={draft.ai.reviewCount} onChange={(n) => setAi("reviewCount", n)} />
          <NumberField label="Web searches per turn" step="1" value={draft.ai.maxSearches} onChange={(n) => setAi("maxSearches", n)} hint="More searches cost more. AI picks always allow up to 6 per game." />
          <Choice
            label="Research depth"
            value={draft.ai.effort}
            onChange={(v) => setAi("effort", v)}
            options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "xhigh", label: "Very high" }]}
            hint="Deeper research takes longer and costs more."
          />
          </>
          )}
        </div>
      </section>
      </details>
    </form>
  );
}
