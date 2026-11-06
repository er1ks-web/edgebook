"use client";

import { useCallback, useEffect, useState } from "react";
import { ago, api, SPEND_EVENT } from "./common";

const BILLING_URL = "https://console.anthropic.com/settings/billing";
const LOW_USD = 5;

interface Estimate { leftUsd: number; setAt: string }

/** Claude's API has no balance lookup, so this is the entered balance minus estimated spending. */
export function ClaudeBalance({ onError }: { onError: (message: string) => void }) {
  const [estimate, setEstimate] = useState<Estimate | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const load = useCallback(() => {
    api<{ estimate: Estimate | null }>("/api/claude-balance").then((r) => setEstimate(r.estimate)).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(SPEND_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener(SPEND_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ estimate: Estimate }>("/api/claude-balance", { method: "PUT", body: { balanceUsd: Number(text) } });
      setEstimate(r.estimate);
      setEditing(false);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  if (estimate === undefined) return null;

  const billing = <a href={BILLING_URL} target="_blank" rel="noreferrer noopener">Check exact balance</a>;

  if (editing) {
    return (
      <form className="claude-balance" onSubmit={save}>
        <label>
          <span>Claude balance $</span>
          <input className="num" type="number" min="0" step="0.01" autoFocus required value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button className="btn tiny">Save</button>
        <button type="button" className="link-btn" onClick={() => setEditing(false)}>Cancel</button>
        {billing}
      </form>
    );
  }

  const open = () => {
    setText(estimate ? estimate.leftUsd.toFixed(2) : "");
    setEditing(true);
  };

  if (!estimate) {
    return (
      <span className="claude-balance">
        <button type="button" className="link-btn" onClick={open}>Set Claude balance</button>
        {billing}
      </span>
    );
  }

  return (
    <span className="claude-balance">
      <span className={estimate.leftUsd < LOW_USD ? "warn-text" : undefined} title={`Your entered balance minus Edgebook's estimated spending since ${ago(estimate.setAt)}. Other uses of this Claude account aren't counted.`}>
        Claude: about <span className="num">${estimate.leftUsd.toFixed(2)}</span> left (estimate)
      </span>
      <button type="button" className="link-btn" onClick={open}>Update</button>
      {billing}
    </span>
  );
}
