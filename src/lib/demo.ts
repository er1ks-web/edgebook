import type { RawBookmaker, RawEvent } from "./types";

/** Made-up fixtures and prices, so the app can be tried with no API keys. Never real. */

export const DEMO_SPORTS = [
  { key: "soccer_epl", title: "Demo Soccer League", group: "Demo", threeWay: true, mean: 2.6, step: 1 },
  { key: "soccer_uefa_champs_league", title: "Demo Soccer Cup", group: "Demo", threeWay: true, mean: 2.8, step: 1 },
  { key: "basketball_nba", title: "Demo Basketball", group: "Demo", threeWay: false, mean: 224, step: 3 },
  { key: "icehockey_nhl", title: "Demo Hockey", group: "Demo", threeWay: false, mean: 6, step: 1 },
];

const TEAMS = [
  "Riverton Rovers", "Northgate City", "Harbor Athletic", "Ashford United", "Eastvale Town", "Kingsmere FC",
  "Stonebridge Wanderers", "Lakeshore Albion", "Oakfield Rangers", "Westbrook Dynamo", "Millbrook Sporting",
  "Pinehurst Thistle", "Redcliff Comets", "Silverton Hawks", "Fairview Titans", "Crestwood Royals",
];

const BOOKS = [
  { key: "demo_sharp", title: "Demo Sharp", margin: 0.02, noise: 0.002 },
  { key: "demo_alpha", title: "Demo Alpha", margin: 0.035, noise: 0.03 },
  { key: "demo_bravo", title: "Demo Bravo", margin: 0.04, noise: 0.035 },
  { key: "demo_charlie", title: "Demo Charlie", margin: 0.03, noise: 0.025 },
  { key: "demo_delta", title: "Demo Delta", margin: 0.045, noise: 0.04 },
];

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const price = (p: number, margin: number) => Math.max(1.01, Math.round((100 / (p * (1 + margin)))) / 100);

function quote(probs: number[], margin: number, noise: number, rand: () => number) {
  const moved = probs.map((p) => Math.max(0.02, p * (1 + (rand() - 0.5) * 2 * noise * 2)));
  const sum = moved.reduce((a, b) => a + b, 0);
  return moved.map((p) => price(p / sum, margin));
}

export function demoEvents(sportKey: string, nowMs = Date.now()): RawEvent[] {
  const sport = DEMO_SPORTS.find((s) => s.key === sportKey);
  if (!sport) return [];
  const day = Math.floor(nowMs / 86_400_000);
  const index = DEMO_SPORTS.indexOf(sport);
  const rand = rng(day * 31 + index * 1009);
  const updated = new Date(nowMs - 120_000).toISOString();
  const teams = [...TEAMS].sort(() => rand() - 0.5);

  const events: RawEvent[] = [];
  for (let i = 0; i < 6; i++) {
    const home = teams[i * 2];
    const away = teams[i * 2 + 1];
    const strength = 0.25 + rand() * 0.5;
    const draw = sport.threeWay ? 0.22 + rand() * 0.06 : 0;
    const h2h = sport.threeWay
      ? [strength * (1 - draw), (1 - strength) * (1 - draw), draw]
      : [strength, 1 - strength];
    const total = sport.mean + Math.round((rand() - 0.5) * 2) * sport.step + (sport.step === 1 ? 0 : 0.5);
    const line = Math.floor(total) + 0.5;
    const overProb = 0.42 + rand() * 0.16;
    const handicap = Math.max(0.5, Math.round(Math.abs(strength - 0.5) * 2 * sport.step * 8) + 0.5);
    const coverProb = 0.44 + rand() * 0.12;

    const bookmakers: RawBookmaker[] = BOOKS.map((b) => {
      const h2hPrices = quote(h2h, b.margin, b.noise, rand);
      const totalPrices = quote([overProb, 1 - overProb], b.margin, b.noise, rand);
      const spreadPrices = quote([coverProb, 1 - coverProb], b.margin, b.noise, rand);
      const favHome = strength >= 0.5;
      return {
        key: b.key,
        title: b.title,
        last_update: updated,
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: home, price: h2hPrices[0] },
              { name: away, price: h2hPrices[1] },
              ...(sport.threeWay ? [{ name: "Draw", price: h2hPrices[2] }] : []),
            ],
          },
          {
            key: "totals",
            outcomes: [
              { name: "Over", price: totalPrices[0], point: line },
              { name: "Under", price: totalPrices[1], point: line },
            ],
          },
          {
            key: "spreads",
            outcomes: [
              { name: home, price: spreadPrices[0], point: favHome ? -handicap : handicap },
              { name: away, price: spreadPrices[1], point: favHome ? handicap : -handicap },
            ],
          },
        ],
      };
    });

    events.push({
      id: `demo-${day}-${index}-${i}`,
      sport_key: sport.key,
      sport_title: sport.title,
      // Anchored to the day, so fixtures hold still across reloads.
      commence_time: new Date(day * 86_400_000 + (30 + i * 7 + index * 2) * 3_600_000).toISOString(),
      home_team: home,
      away_team: away,
      bookmakers,
    });
  }
  return events;
}
