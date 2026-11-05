"use client";

import { useState } from "react";
import type { RestoreResult } from "@/lib/backup";
import { api } from "./common";

function summary(r: RestoreResult) {
  const parts = [`${r.betsAdded} ${r.betsAdded === 1 ? "bet" : "bets"} added`];
  if (r.betsAlreadyThere) parts.push(`${r.betsAlreadyThere} already here`);
  const strategies = r.strategiesAdded + r.strategiesUpdated;
  parts.push(`${strategies} ${strategies === 1 ? "strategy" : "strategies"} added or updated`);
  return `Restored: ${parts.join(", ")}.`;
}

export function BackupPanel({ onRestored }: { onRestored: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function restore(file: File) {
    setBusy(true);
    setMessage(null);
    setProblem(null);
    try {
      const body = JSON.parse(await file.text()) as unknown;
      const result = await api<RestoreResult>("/api/backup", { method: "POST", body });
      setMessage(summary(result));
      // Reload so the strategy list and ledger both show what was restored.
      if (result.betsAdded || result.strategiesAdded || result.strategiesUpdated) {
        onRestored();
        window.setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      setProblem(err instanceof SyntaxError ? "That isn't an Edgebook backup file." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="panel add-past">
      <summary>Back up or move your data</summary>
      <div className="past-bet">
        <p className="small muted">
          The file holds your bets and strategies, but no keys or passwords. Restoring adds to what&apos;s here and never deletes anything, so it&apos;s safe to run twice.
        </p>
        <div className="backup-actions">
          <a className="btn" href="/api/backup" download>Download backup</a>
          <label className={busy ? "btn file-btn disabled" : "btn file-btn"}>
            {busy ? "Restoring…" : "Restore from a file"}
            <input
              className="sr-only"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) restore(file);
              }}
            />
          </label>
        </div>
        {message && <p className="small logged" role="status">{message}</p>}
        {problem && <p className="small warn-text" role="alert">{problem}</p>}
      </div>
    </details>
  );
}
