// Token Launch Radar — the model (radar-2).
//
// One sealed snapshot in, one ranked board out. The board covers every slug on the
// snapshot's watchlist (the floor, never the ceiling) and adds the pre-token
// protocols below the floor that the watchlist's own exclusion rule keeps: no
// exchange, no bridge, no liquid staking or restaking, no versioned pool, no
// wrapped or staked product of a token that already trades.
//
// Implied value is derived from the snapshot's own figures, never from a list of
// names. Live-token protocols in the same snapshot set the price of TVL: for
// each category, the median market-cap-per-TVL among its live-token protocols
// (three or more samples, else the global median), clamped to a sane band.
// A pre-token protocol is then worth its TVL at its category's multiple, moved
// by its own seven-day growth and by how long it has run with no token:
//
//   multiple   = category median mcap/TVL (n >= 3) or global median, clamped [0.05, 1.5]
//   growth     = clamp(change_7d, -50, 150) per cent
//   growthF    = 1 + (growth / 100) * 0.4
//   tenureF    = 0.75 + 0.25 * min(age_days, 1095) / 1095   (unknown age: 365 days)
//   implied    = max(1, round(tvl_usd * multiple * growthF * tenureF))
//
// The same function scores every row. The dashboard recomputes each row in the
// page, so the number the board carries is the number the page shows.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  min_category_samples: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  tenure_floor: number;
  tenure_range: number;
  tenure_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  min_category_samples: 3,
  growth_floor: -50,
  growth_cap: 150,
  growth_weight: 0.4,
  tenure_floor: 0.75,
  tenure_range: 0.25,
  tenure_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_CAP = 200;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: 'category' | 'global';
    multiple_samples: number;
    base_value_usd: number;
    growth_pct: number;
    growth_factor: number;
    tenure_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, carrying the farm plan it shows. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  multiple_source: 'category' | 'global';
  multiple_samples: number;
  base_value_usd: number;
  growth_factor: number;
  tenure_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Clamp `n` into [`lo`, `hi`]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Round to 4 decimal places, for display. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The mcap-per-TVL multiples the snapshot's live-token protocols imply, by category. */
export interface MultipleTable {
  byCategory: Map<string, { multiple: number; samples: number }>;
  global: number;
}

export function categoryMultiples(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): MultipleTable {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = perCategory.get(key);
    if (list === undefined) perCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length > 0 ? clamp(median(all), model.multiple_floor, model.multiple_cap) : 0.2;
  const byCategory = new Map<string, { multiple: number; samples: number }>();
  for (const [key, list] of perCategory) {
    if (list.length >= model.min_category_samples) {
      byCategory.set(key, { multiple: clamp(median(list), model.multiple_floor, model.multiple_cap), samples: list.length });
    }
  }
  return { byCategory, global };
}

/** The multiple one protocol is scored at, and where it came from. */
export function multipleFor(
  protocol: SnapshotProtocol,
  table: MultipleTable,
): { multiple: number; source: 'category' | 'global'; samples: number } {
  const hit = table.byCategory.get(protocol.category ?? 'Other');
  if (hit !== undefined) return { multiple: hit.multiple, source: 'category', samples: hit.samples };
  return { multiple: table.global, source: 'global', samples: 0 };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: MultipleTable,
  model: ModelConstants = MODEL,
): {
  implied: number;
  multiple: number;
  multipleSource: 'category' | 'global';
  multipleSamples: number;
  base: number;
  growthPct: number;
  growthFactor: number;
  tenureFactor: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, source, samples } = multipleFor(protocol, table);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const tenureFactor =
    model.tenure_floor + (Math.min(Math.max(ageForModel, 0), model.tenure_days) / model.tenure_days) * model.tenure_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthFactor * tenureFactor));
  return { implied, multiple, multipleSource: source, multipleSamples: samples, base: Math.round(base), growthPct, growthFactor, tenureFactor, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking, in any case. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;
/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_START = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
/** Categories the watchlist's own rule keeps out of the radar. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the early radar may rank: pre-token, and passing the
 * watchlist's own exclusion rule — no exchange, no bridge, no liquid staking or
 * restaking, no versioned pool, no wrapped or staked product, no exchange-named
 * protocol. The watchlist itself always passes: it was built by that rule.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  if (EXCHANGE_START.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = categoryMultiples(snapshot.protocols, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no
  // longer carries (it cannot, but the board's coverage is the gate's row and is
  // never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by
  // TVL, capped. Never a replacement for a watchlist row: a chosen protocol
  // stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_CAP);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, table, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      // Full precision here, not rounded: the page recomputes the row from
      // these exact numbers, and rounding would make its check disagree.
      category_multiple: s.v.multiple,
      multiple_source: s.v.multipleSource,
      multiple_samples: s.v.multipleSamples,
      base_value_usd: s.v.base,
      growth_pct: round4(s.v.growthPct),
      growth_factor: s.v.growthFactor,
      tenure_factor: s.v.tenureFactor,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age, i + 1).map(stepText),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The gas a transaction costs on the protocol's first chain, in words. */
function gasNote(p: SnapshotProtocol): string {
  const chain = (p.chains[0] ?? '').toLowerCase();
  if (chain.includes('ethereum')) return 'about $3–$12 of gas on Ethereum';
  if (chain.includes('solana')) return 'under $0.10 of gas on Solana';
  if (chain.includes('bitcoin') || chain.includes('tron')) return 'about $1–$3 of gas';
  return 'under $1 of gas';
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow. Two variants each. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string, variant: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return variant === 0
      ? `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning.`
      : `Borrow $25 against $${capital} of collateral on ${name} (${chain}), then repay half of it within a week.`;
  }
  if (c.includes('dex') || c.includes('amm')) {
    return variant === 0
      ? `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain}.`
      : `Swap $${capital} through ${name} on ${chain} in two trades on different days.`;
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('leveraged farm')) {
    return variant === 0
      ? `Deposit $${capital} into a ${name} vault on ${chain} and hold the receipt tokens.`
      : `Move $${capital} between two ${name} vaults on ${chain} a week apart to show repeat use.`;
  }
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('options') || c.includes('basis')) {
    return variant === 0
      ? `Post $${capital} of USDC as margin on ${name} (${chain}) and open one small hedged position.`
      : `Open and close one small ${name} position on ${chain} with $${capital} of margin, then leave the rest deposited.`;
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return variant === 0
      ? `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`
      : `Buy $${capital} of a ${name} tokenised asset on ${chain} and keep it for the full hold period.`;
  }
  if (c.includes('prediction')) {
    return variant === 0
      ? `Fund $${capital} and take one small position on a ${name} market on ${chain}.`
      : `Place two small ${name} market positions on ${chain} on different days.`;
  }
  if (c.includes('privacy')) {
    return variant === 0
      ? `Route $${capital} through ${name} on ${chain} in two or three private transfers.`
      : `Deposit $${capital} into ${name}'s shielded pool on ${chain} and withdraw part of it later.`;
  }
  if (c.includes('launchpad')) {
    return variant === 0
      ? `Stake $${capital} to join one ${name} sale on ${chain}.`
      : `Hold $${capital} of the launchpad's staking asset through ${name} for the full window.`;
  }
  if (c.includes('index')) {
    return variant === 0
      ? `Buy $${capital} of ${name}'s index on ${chain} and hold it.`
      : `Mint $${capital} of ${name}'s basket token on ${chain}.`;
  }
  if (c.includes('restak')) {
    return variant === 0
      ? `Restake $${capital} of the chain's staking asset through ${name} on ${chain}.`
      : `Deposit $${capital} into a ${name} restaking vault on ${chain} and hold the receipt.`;
  }
  if (c.includes('stable')) {
    return variant === 0
      ? `Mint $${capital} of ${name}'s stable asset on ${chain}.`
      : `Deposit $${capital} of collateral to mint ${name}'s stablecoin on ${chain}.`;
  }
  if (c.includes('insurance')) {
    return variant === 0
      ? `Buy $${capital} of cover from ${name} on ${chain}.`
      : `Deposit $${capital} into a ${name} cover pool on ${chain}.`;
  }
  if (c.includes('payment')) {
    return variant === 0
      ? `Send $${capital} through ${name} on ${chain} in two or three payments.`
      : `Hold $${capital} in a ${name} balance on ${chain} and make one payment a week.`;
  }
  if (c.includes('ai') || c.includes('agent')) {
    return variant === 0
      ? `Pay $${capital} to run one ${name} agent task on ${chain}.`
      : `Stake $${capital} in ${name}'s agent network on ${chain}.`;
  }
  return variant === 0
    ? `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`
    : `Use ${name} on ${chain} twice in separate weeks with $${capital} in total volume.`;
}

/** A second, different action for the same protocol, so the plan is not one move. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $20 against the deposit on ${name} and repay it within a week.`;
  if (c.includes('dex') || c.includes('amm')) return `Swap once more in the opposite direction on ${name} a week later.`;
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) return `Claim any rewards the vault pays and restake them on ${name}.`;
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('options') || c.includes('basis')) return `Close the position on ${name} and reopen a smaller one the next week.`;
  if (c.includes('rwa')) return `Read the redemption terms of ${name}'s asset on its own page before the hold ends.`;
  if (c.includes('prediction')) return `Settle one ${name} market and keep the winnings in the account.`;
  if (c.includes('privacy')) return `Make one more private transfer on ${name} a week after the first.`;
  if (c.includes('launchpad')) return `Vote on one ${name} sale proposal if the launchpad opens one.`;
  if (c.includes('index')) return `Rebalance the ${name} basket once, swapping a tenth of it.`;
  if (c.includes('stable')) return `Redeem a tenth of the minted stable asset on ${name} to test the exit.`;
  if (c.includes('insurance')) return `Check the ${name} cover terms on its own page once a month.`;
  return `Do one more qualifying action on ${name} a week later, such as a deposit, a swap or a vote.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The
 * plan is derived from the protocol's own record (category, chains, TVL, age),
 * never from a hand-written list of names. The main action rotates between two
 * variants by rank, so neighbouring rows do not read identically.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, rank: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(p);
  const variant = rank % 2;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainAction(p, capital, chain, variant),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, capital, chain),
      cost: 'about $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, and write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, carrying the farm plan the page shows. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    multiple_source: row.model.multiple_source,
    multiple_samples: row.model.multiple_samples,
    base_value_usd: row.model.base_value_usd,
    growth_factor: row.model.growth_factor,
    tenure_factor: row.model.tenure_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const table = categoryMultiples(snapshot.protocols, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(table.global),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
