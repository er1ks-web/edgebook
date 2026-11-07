import { describe, expect, it } from "vitest";
import {
  bankrollSummary, betCategory, breakdown, byStrength, calibration, chasingWarning, legCategory, monthly,
  needsResult, oddsBand, realBets, recordSummary, stakeTotals, toCsv,
} from "./ledgerStats";
import type { Bet, BetLeg, MoneyEntry } from "./types";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

let n = 0;
const leg = (over: Partial<BetLeg> = {}): BetLeg => ({
  key: `k${n++}`, eventId: "e", sportKey: "soccer_x", sportTitle: "League X", commence: hours(-48), home: "H", away: "A",
  market: "h2h", selection: "H", label: "H to win", price: 2, prob: 0, result: "pending", ...over,
});
const bet = (status: Bet["status"], over: Partial<Bet> = {}, legOver: Partial<BetLeg> = {}): Bet => {
  const stake = over.stake ?? 10;
  const odds = over.odds ?? 2;
  return {
    id: `b${n++}`, placedAt: hours(-72), kind: "single", book: "b", bookTitle: "Betsafe", strategyId: "s", strategyName: "Steady",
    stake, odds, evAtPlacement: 0, status, returned: status === "won" ? stake * odds : status === "push" ? stake : 0, demo: false,
    legs: [leg({ result: status, ...legOver })], ...over,
  };
};

describe("bet types", () => {
  it("names standard and typed bets", () => {
    expect(legCategory({ market: "h2h", label: "", selection: "" })).toBe("Match result");
    expect(legCategory({ market: "other", label: "Both teams to score: Yes", selection: "" })).toBe("Both teams to score");
    expect(legCategory({ market: "other", label: "Arsenal or draw", selection: "" })).toBe("Double chance");
    expect(legCategory({ market: "other", label: "Arsenal draw no bet", selection: "" })).toBe("Draw no bet");
    expect(legCategory({ market: "other", label: "Over 9.5 corners", selection: "" })).toBe("Corners");
    expect(legCategory({ market: "other", label: "Over 4.5 cards", selection: "" })).toBe("Cards");
    expect(legCategory({ market: "other", label: "Haaland to score anytime", selection: "" })).toBe("Player to score");
    expect(legCategory({ market: "other", label: "Something else", selection: "" })).toBe("Other");
    expect(betCategory(bet("won", { kind: "parlay" }))).toBe("Parlay");
  });

  it("bands odds", () => {
    expect([1.3, 1.5, 2.5, 4, 7].map(oddsBand)).toEqual(["Under 1.50", "1.50 to 1.99", "2.00 to 2.99", "3.00 to 4.99", "5.00 and up"]);
  });
});

describe("breakdowns", () => {
  it("sums results per group and skips open bets", () => {
    const rows = breakdown([bet("won"), bet("lost"), bet("won", {}, { market: "totals", label: "Over 2.5" }), bet("pending")], "type");
    expect(rows).toEqual([
      { key: "Match result", settled: 2, won: 1, lost: 1, staked: 20, profit: 0, roi: 0, hitRate: 0.5 },
      { key: "Over/under", settled: 1, won: 1, lost: 0, staked: 10, profit: 10, roi: 1, hitRate: 1 },
    ]);
  });

  it("counts a bet under each of its tags", () => {
    const rows = breakdown([bet("won", { tags: ["From prompt", "Weekend"] }), bet("lost")], "tag");
    expect(rows.map((r) => r.key).sort()).toEqual(["From prompt", "No tag", "Weekend"]);
  });

  it("groups typed games as league not set", () => {
    expect(breakdown([bet("won", {}, { sportKey: "manual", sportTitle: "Added by hand" })], "league")[0].key).toBe("League not set");
  });

  it("leaves demo and paper bets out of real results", () => {
    expect(realBets([bet("won"), bet("won", { demo: true }), bet("won", { paper: true })])).toHaveLength(1);
  });
});

describe("research check", () => {
  it("compares stated chances with real results", () => {
    const rows = calibration([
      bet("won", {}, { chance: 0.65 }), bet("lost", {}, { chance: 0.62 }), bet("won", {}, { chance: 0.85 }),
      bet("push", {}, { chance: 0.65 }), bet("won"), bet("pending", {}, { chance: 0.6 }),
    ]);
    expect(rows.map((r) => [r.band, r.bets, r.won])).toEqual([["60 to 69%", 2, 1], ["80% and up", 1, 1]]);
    expect(rows[0].predicted).toBeCloseTo(0.635);
    expect(rows[0].actual).toBe(0.5);
  });

  it("multiplies a parlay's leg chances", () => {
    const parlay = { ...bet("won", { kind: "parlay" }), legs: [leg({ result: "won", chance: 0.6 }), leg({ result: "won", chance: 0.6 })] };
    expect(calibration([parlay])[0].band).toBe("Under 40%");
  });

  it("splits results by strength, rating a parlay by its weakest leg", () => {
    const parlay = { ...bet("lost", { kind: "parlay" }), legs: [leg({ result: "lost", strength: 8 }), leg({ result: "won", strength: 5 })] };
    const rows = byStrength([bet("won", {}, { strength: 8 }), bet("won", {}, { strength: 9 }), parlay, bet("won")]);
    expect(rows.map((r) => [r.key, r.settled, r.won])).toEqual([["5 to 6", 1, 0], ["8 to 10", 2, 2]]);
  });
});

describe("open bets needing a result", () => {
  it("lists bets whose games should be over", () => {
    const old = bet("pending", {}, { commence: hours(-4) });
    const soon = bet("pending", {}, { commence: hours(-1) });
    expect(needsResult([old, soon, bet("won")], NOW)).toEqual([old]);
  });
});

describe("discipline", () => {
  it("adds up stakes for today and this week", () => {
    const totals = stakeTotals([bet("pending", { placedAt: hours(-1), stake: 5 }), bet("won", { placedAt: hours(-30), stake: 3 }), bet("won", { placedAt: hours(-24 * 9), stake: 50 })], NOW);
    expect(totals.today).toBe(5);
    expect(totals.week).toBe(8);
  });

  const history = Array.from({ length: 6 }, (_, i) => bet("won", { placedAt: hours(-200 - i), stake: 5 }, { commence: hours(-190 - i) }));
  const losses = [bet("lost", { placedAt: hours(-60) }, { commence: hours(-55) }), bet("lost", { placedAt: hours(-58) }, { commence: hours(-52) })].map((b) => ({ ...b, stake: 5 }));

  it("warns when stakes jump after losses", () => {
    const big = bet("pending", { placedAt: hours(-2), stake: 15 }, { commence: hours(5) });
    expect(chasingWarning([...history, ...losses, big], NOW)).toEqual({ stake: 15, usual: 5, losses: 2 });
  });

  it("stays quiet for normal stakes, or a big stake after a win", () => {
    const normal = bet("pending", { placedAt: hours(-2), stake: 6 }, { commence: hours(5) });
    expect(chasingWarning([...history, ...losses, normal], NOW)).toBeNull();
    const afterWin = bet("pending", { placedAt: hours(-2), stake: 15 }, { commence: hours(5) });
    const win = bet("won", { placedAt: hours(-40), stake: 5 }, { commence: hours(-20) });
    expect(chasingWarning([...history, ...losses, win, afterWin], NOW)).toBeNull();
  });

  it("needs some history first", () => {
    expect(chasingWarning([...losses, bet("pending", { placedAt: hours(-2), stake: 50 })], NOW)).toBeNull();
  });
});

describe("money", () => {
  const entries: MoneyEntry[] = [
    { id: "1", at: "2026-10-01T10:00:00Z", kind: "deposit", amount: 50, note: "" },
    { id: "2", at: "2026-10-20T10:00:00Z", kind: "cost", amount: 20, note: "Claude" },
    { id: "3", at: "2026-11-02T10:00:00Z", kind: "withdrawal", amount: 10, note: "" },
    { id: "4", at: "2026-11-03T10:00:00Z", kind: "cost", amount: 5, note: "" },
  ];
  const bets = [
    bet("won", {}, { commence: "2026-10-10T15:00:00Z" }),
    bet("lost", { stake: 4 }, { commence: "2026-11-05T15:00:00Z" }),
    bet("pending", { stake: 3 }, { commence: hours(5) }),
  ];

  it("works out the balance and profit after costs", () => {
    expect(bankrollSummary(bets, entries)).toEqual({ deposits: 50, withdrawals: 10, costs: 25, betting: 6, open: 3, balance: 43, afterCosts: -19 });
  });

  it("splits profit and costs by month", () => {
    expect(monthly(bets, entries)).toEqual([
      { month: "2026-11", bets: 1, profit: -4, costs: 5, net: -9 },
      { month: "2026-10", bets: 1, profit: 10, costs: 20, net: -10 },
    ]);
  });
});

describe("record for the prompt", () => {
  it("needs a few results first", () => {
    expect(recordSummary([bet("won"), bet("lost")])).toBeNull();
  });

  it("summarises overall and by bet type", () => {
    const bets = [...Array.from({ length: 4 }, () => bet("won")), bet("lost"), ...Array.from({ length: 5 }, () => bet("lost", {}, { market: "other", label: "Over 9.5 corners" }))];
    const text = recordSummary(bets)!;
    expect(text).toContain("Overall: 10 settled bets, 4 won and 6 lost");
    expect(text).toContain("Match result: 5 bets, won 4, return +60%.");
    expect(text).toContain("Corners: 5 bets, won 0, return -100%.");
  });
});

describe("export", () => {
  it("writes one row per bet and quotes awkward text", () => {
    const csv = toCsv([bet("won", { note: 'Said "safe", wasn\'t' }, { chance: 0.6, strength: 7 }), bet("pending")]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("Placed,Type,Bookmaker")).toBe(true);
    expect(lines[1]).toContain(',won,20,10,60,7,,"Said ""safe"", wasn\'t"');
    expect(lines[2]).toContain(",pending,,,");
  });
});
