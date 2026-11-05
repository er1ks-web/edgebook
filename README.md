# Edgebook

A private tool for finding sports picks and parlays. It runs on your own computer and only listens on `127.0.0.1`. There is no login, so add authentication before hosting it anywhere public.

## Run it

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3100. With no keys it runs on made-up demo data.

## Connect real data

Copy `.env.example` to `.env.local`, fill in the keys, and restart:

- `ODDS_API_KEY`, from [The Odds API](https://the-odds-api.com). A refresh costs sports × markets × regions credits. Odds refresh only when you press the button.
- `ANTHROPIC_API_KEY`, from the [Anthropic Console](https://console.anthropic.com). Used only when you press AI research. Each run shows its approximate cost.

## How a pick is made

1. **Fair price.** Removes the bookmaker margin from the sharp books (or all books) to estimate each outcome's true chance. A book is never used to value its own price.
2. **Edge.** Compares that chance to the best price: `EV = chance × odds - 1`.
3. **Stake.** Fractional Kelly, capped by your maximum stake.
4. **AI research (optional).** Claude searches for injuries, lineups and news on your top selections, applying your written strategy. It can back or pass on a selection and move its probability, within the cap you set.
5. **Parlays.** Combines legs at a single book, from different games only, and keeps tickets with positive expected value.

## Judging a strategy

The ledger tracks profit, return and "beat the close", which compares your price with the last fair price seen before kickoff. Profit is mostly luck for the first few hundred bets, so watch the closing number first. Refresh odds shortly before games start, or there is no closing price to compare with.

No model guarantees a profit, and these numbers are estimates. Bookmakers can also limit accounts that win consistently.

## Known limits

- Fair chances assume sharp markets are close to correct. A strategy that disagrees with them needs evidence.
- Parlay chances assume legs are independent. Games in the same league can still be related.
- Asian quarter lines are skipped. Player props and outright markets aren't covered.
- Data lives in `data/` as JSON files. Back it up if the ledger matters to you.

## Commands

```bash
npm test
npm run typecheck
```
