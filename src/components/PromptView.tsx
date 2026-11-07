"use client";

import { useEffect, useMemo, useState } from "react";
import { localDay } from "@/lib/engine/settle";
import { realBets, recordSummary } from "@/lib/ledgerStats";
import type { Bet } from "@/lib/types";
import { api } from "./common";
import { buildPrompt } from "@/lib/promptBuilder";
import type { Strategy } from "@/lib/strategy";
import type { SportInfo } from "./StrategyView";

const BOOK_KEY = "edgebook.promptBookmaker";

/** Writes the research prompt for a chat from the chosen strategy. Nothing here uses Claude credit. */
export function PromptView({ strategy, sports, onEditStrategy }: { strategy: Strategy; sports: SportInfo[]; onEditStrategy: () => void }) {
  const [bookmaker, setBookmaker] = useState("");
  const [games, setGames] = useState("");
  const [copied, setCopied] = useState(false);
  const [record, setRecord] = useState<string | null>(null);
  const [useRecord, setUseRecord] = useState(true);

  useEffect(() => {
    api<{ bets: Bet[] }>("/api/bets").then((r) => setRecord(recordSummary(realBets(r.bets)))).catch(() => setRecord(null));
  }, []);

  useEffect(() => {
    try { setBookmaker(localStorage.getItem(BOOK_KEY) ?? ""); } catch { /* storage may be blocked */ }
  }, []);

  const prompt = useMemo(
    () =>
      buildPrompt(strategy, {
        date: localDay(Date.now()),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        bookmaker,
        leagueTitles: Object.fromEntries(sports.map((s) => [s.key, s.title])),
        games,
        record: useRecord ? record : null,
      }),
    [strategy, sports, bookmaker, games, record, useRecord],
  );

  useEffect(() => setCopied(false), [prompt]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Older browsers: select the text so it can be copied by hand.
      const box = document.getElementById("strategy-prompt") as HTMLTextAreaElement | null;
      box?.select();
      document.execCommand("copy");
    }
    setCopied(true);
  }

  return (
    <div className="prompt-view">
      <section className="panel">
        <h2>Research prompt for {strategy.name}</h2>
        <p className="small muted">
          Paste this into a Claude chat with web search on. Switch strategy at the top to get its prompt, or change its settings in Strategy.
        </p>
        <div className="grid">
          <label className="field">
            <span className="field-label">Your bookmaker</span>
            <input
              value={bookmaker}
              maxLength={60}
              placeholder="Betsafe"
              onChange={(e) => {
                setBookmaker(e.target.value);
                try { localStorage.setItem(BOOK_KEY, e.target.value); } catch { /* storage may be blocked */ }
              }}
            />
          </label>
          <label className="field wide">
            <span className="field-label">Games and odds (optional)</span>
            <textarea rows={4} value={games} placeholder="Arsenal v Chelsea: 2.10 / 3.40 / 3.50. Or leave empty and attach a screenshot in the chat." onChange={(e) => setGames(e.target.value)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={useRecord && record !== null} disabled={record === null} onChange={(e) => setUseRecord(e.target.checked)} />
          {record === null ? "Include my record (after 5 settled bets)" : "Include my record, so the chat can see which bet types have been losing"}
        </label>
        <div className="prompt-actions">
          <button type="button" className="btn primary" onClick={copy}>{copied ? "Copied" : "Copy prompt"}</button>
          <button type="button" className="btn ghost" onClick={onEditStrategy}>Edit strategy</button>
        </div>
      </section>
      <textarea id="strategy-prompt" className="prompt-text num" readOnly rows={24} value={prompt} aria-label="Research prompt" />
    </div>
  );
}
