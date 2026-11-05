"use client";

import { useState } from "react";
import { isComplete, QUESTIONS, type Answers, type Question } from "@/lib/questionnaire";
import type { Strategy } from "@/lib/strategy";
import { api, money } from "./common";

export interface BuildResult {
  strategy: Strategy;
  explanation: string[];
  warnings: string[];
  aiUsed: boolean;
  note?: string;
  costUsd: number;
}

function QuestionBlock({ question, selected, onChange }: { question: Question; selected: string[]; onChange: (next: (current: string[]) => string[]) => void }) {
  return (
    <fieldset className="question">
      <legend>{question.title}</legend>
      {question.hint && <p className="small muted">{question.hint}</p>}
      <div className="answer-grid">
        {question.options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              type="button"
              key={o.value}
              className={on ? "answer on" : "answer"}
              aria-pressed={on}
              onClick={() => {
                onChange((current) => {
                  if (!question.multiple) return [o.value];
                  return current.includes(o.value) ? current.filter((v) => v !== o.value) : [...current, o.value];
                });
              }}
            >
              <span>{o.label}</span>
              {o.detail && <span className="answer-detail">{o.detail}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function StrategySummary({ strategy: s }: { strategy: Strategy }) {
  return (
    <dl className="summary">
      <div><dt>Leagues</dt><dd className="num">{s.sports.length}</dd></div>
      <div><dt>Odds range</dt><dd className="num">{s.minOdds.toFixed(2)} to {s.maxOdds.toFixed(2)}</dd></div>
      <div><dt>Minimum edge</dt><dd className="num">{s.minEvPct}%</dd></div>
      <div><dt>Largest stake</dt><dd className="num">{money((s.bankroll * s.maxStakePct) / 100)}</dd></div>
      <div><dt>Parlays</dt><dd>{s.parlay.enabled ? `${s.parlay.minLegs} to ${s.parlay.maxLegs} legs` : "Off"}</dd></div>
      <div><dt>Trust in Claude</dt><dd className="num">{s.ai.aiWeightPct}%</dd></div>
    </dl>
  );
}

export function Questionnaire({
  draft, onBuilt, onError,
}: {
  draft: Strategy;
  onBuilt: (result: BuildResult) => void;
  onError: (message: string) => void;
}) {
  const [answers, setAnswers] = useState<Answers>(draft.answers ?? {});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const answered = QUESTIONS.filter((q) => (answers[q.id]?.length ?? 0) > 0).length;

  async function build() {
    setBusy(true);
    try {
      onBuilt(await api<BuildResult>("/api/strategies/build", { method: "POST", body: { base: draft, answers, notes } }));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel questionnaire">
      <h2>Build your strategy</h2>
      <p className="small muted">Answer these and Claude sets up the strategy. Nothing changes until you save it, and you can adjust every setting afterwards.</p>
      {QUESTIONS.map((q) => (
        <QuestionBlock
          key={q.id}
          question={q}
          selected={answers[q.id] ?? []}
          onChange={(next) => setAnswers((a) => ({ ...a, [q.id]: next(a[q.id] ?? []) }))}
        />
      ))}
      <label className="field question">
        <span className="field-label">Anything else? (optional)</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={notes}
          placeholder="Example: I follow Serie A closely, and I don't want to bet on my own team, Inter."
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="build-row">
        <span className="small muted num" role="status">{answered} of {QUESTIONS.length} answered</span>
        <button type="button" className="btn primary" disabled={!isComplete(answers) || busy} onClick={build}>
          {busy ? "Claude is building…" : "Build my strategy"}
        </button>
      </div>
    </section>
  );
}

export function BuildSummary({ result, strategy }: { result: BuildResult; strategy: Strategy }) {
  return (
    <section className="panel ai-note build-result">
      <h2>{strategy.name}</h2>
      {strategy.description && <p>{strategy.description}</p>}
      <StrategySummary strategy={strategy} />
      {result.explanation.length > 0 && (
        <ul className="plain-list">
          {result.explanation.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {result.note && <p className="small warn-text">{result.note}</p>}
      {result.warnings.map((w) => <p className="small warn-text" key={w}>{w}</p>)}
      <p className="small muted">
        Not saved yet. Press Save strategy to use it, or Save as copy to keep your current one too. Saving loads odds for any new leagues, which uses credits.
        {result.costUsd > 0 && ` Building this used about $${result.costUsd.toFixed(2)} of Claude usage.`}
      </p>
    </section>
  );
}
