import type { FactorKey, FactorRow, FactorScores, Recommendation, StrategyDef, Weights } from "@/lib/strategy/types";

export const UNIVERSE_MIN_LOTS = 200; // 排除殭屍股
export const UNIVERSE_MIN_CLOSE = 5;  // 排除雞蛋水餃股

export const FACTOR_KEYS: FactorKey[] = ["value", "dividend", "momentum", "chips", "heat", "growth"];
export const FACTOR_LABELS: Record<FactorKey, string> = {
  value: "價值", dividend: "收息", momentum: "動能", chips: "籌碼", heat: "熱度", growth: "成長",
};

export function inUniverse(r: FactorRow): boolean {
  return r.volumeLots >= UNIVERSE_MIN_LOTS && r.close >= UNIVERSE_MIN_CLOSE;
}

// 百分位(高者佳):嚴格小於該值的檔數/(母體-1)×100;null 不入母體;母體<2 → 50
export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  const n = sorted.length;
  return values.map((v) => {
    if (v == null) return null;
    if (n < 2) return 50;
    let lo = 0, hi = n; // lower bound 二分:嚴格小於 v 的個數
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return (lo / (n - 1)) * 100;
  });
}

const invert = (p: number | null): number | null => (p == null ? null : 100 - p);
const mean2 = (a: number | null, b: number | null): number | null =>
  a == null && b == null ? null : a == null ? b : b == null ? a : (a + b) / 2;

// rows 應已通過 inUniverse 門檻;回傳與 rows 逐列對齊的六因子分數(0–100 或 null)
export function computeFactorScores(rows: FactorRow[]): FactorScores[] {
  const peLow = percentileRanks(rows.map((r) => r.peRatio)).map(invert);
  const pbLow = percentileRanks(rows.map((r) => r.pbRatio)).map(invert);
  const yieldHigh = percentileRanks(rows.map((r) => r.dividendYield));
  const biasHigh = percentileRanks(rows.map((r) => r.biasPct));
  const chgHigh = percentileRanks(rows.map((r) => r.changePct));
  const chipsHigh = percentileRanks(rows.map((r) => r.chipsRatio));
  const heatHigh = percentileRanks(rows.map((r) => r.volumeLots));
  const growthHigh = percentileRanks(rows.map((r) => r.revenueYoyPct));
  return rows.map((_, i) => ({
    value: mean2(peLow[i], pbLow[i]),
    dividend: yieldHigh[i],
    momentum: mean2(biasHigh[i], chgHigh[i]),
    chips: chipsHigh[i],
    heat: heatHigh[i],
    growth: growthHigh[i],
  }));
}

export const MIN_FACTORS = 3; // 資料太殘缺的股票不進榜

export function compositeScore(f: FactorScores, weights: Weights): number | null {
  let num = 0, den = 0, count = 0;
  for (const k of FACTOR_KEYS) {
    const v = f[k];
    if (v == null) continue;
    num += weights[k] * v;
    den += weights[k];
    count++;
  }
  if (count < MIN_FACTORS || den <= 0) return null;
  // Round to 10 decimal places to avoid floating point precision errors
  return Math.round((num / den) * 1e10) / 1e10;
}

// ≥90 分講「前 X%」更有力,其餘講「贏過 X%」
function pctPhrase(score: number): string {
  if (score >= 90) return `前 ${Math.max(1, Math.round(100 - score))}%`;
  return `贏過 ${Math.round(score)}% 的股票`;
}

function reasonText(k: FactorKey, score: number, row: FactorRow): string {
  switch (k) {
    case "value": return `估值便宜度${pctPhrase(score)}`;
    case "dividend": return `殖利率${pctPhrase(score)}`;
    case "momentum":
      return row.biasPct != null && row.biasPct > 0
        ? `站上月均線 +${row.biasPct.toFixed(1)}%,動能${pctPhrase(score)}`
        : `價格動能${pctPhrase(score)}`;
    case "chips": return `法人買超力道${pctPhrase(score)}`;
    case "heat": return `成交熱度${pctPhrase(score)}`;
    case "growth": return `營收年增動能${pctPhrase(score)}`;
  }
}

// 只描述事實不喊買賣;取分數最高兩因子
export function buildReasons(f: FactorScores, row: FactorRow): string[] {
  return FACTOR_KEYS
    .filter((k) => f[k] != null)
    .sort((a, b) => f[b]! - f[a]!)
    .slice(0, 2)
    .map((k) => reasonText(k, f[k]!, row));
}

export function recommend(rows: FactorRow[], weights: Weights, topN = 20): Recommendation[] {
  const universe = rows.filter(inUniverse);
  const scores = computeFactorScores(universe);
  // 主因子(最高權重,並列取全部)缺值不進榜——存股收息榜不該出現無殖利率資料的股票
  const maxW = Math.max(...FACTOR_KEYS.map((k) => weights[k]));
  const dominant = maxW > 0 ? FACTOR_KEYS.filter((k) => weights[k] === maxW) : [];
  const recs: Recommendation[] = [];
  for (let i = 0; i < universe.length; i++) {
    if (dominant.some((k) => scores[i][k] == null)) continue;
    const score = compositeScore(scores[i], weights);
    if (score == null) continue;
    recs.push({ row: universe[i], score, factors: scores[i], reasons: buildReasons(scores[i], universe[i]) });
  }
  recs.sort((a, b) => b.score - a.score || b.row.volumeLots - a.row.volumeLots);
  return recs.slice(0, topN);
}

export const STRATEGIES: StrategyDef[] = [
  { key: "balanced", label: "均衡精選", blurb: "六力平均、體質全面",
    weights: { value: 0.2, dividend: 0.2, momentum: 0.15, chips: 0.15, heat: 0.1, growth: 0.2 } },
  { key: "income", label: "存股收息", blurb: "領股息為主,兼顧不買貴",
    weights: { value: 0.25, dividend: 0.45, momentum: 0.05, chips: 0.1, heat: 0.05, growth: 0.1 } },
  { key: "value", label: "價值獵手", blurb: "便宜是硬道理",
    weights: { value: 0.5, dividend: 0.15, momentum: 0.05, chips: 0.1, heat: 0.05, growth: 0.15 } },
  { key: "momentum", label: "動能突擊", blurb: "順勢而為、量價齊揚",
    weights: { value: 0.05, dividend: 0.05, momentum: 0.4, chips: 0.2, heat: 0.15, growth: 0.15 } },
  { key: "chips", label: "主力同行", blurb: "跟著法人腳步",
    weights: { value: 0.1, dividend: 0.05, momentum: 0.15, chips: 0.5, heat: 0.1, growth: 0.1 } },
  { key: "growth", label: "成長飛輪", blurb: "營收年增領航",
    weights: { value: 0.1, dividend: 0.05, momentum: 0.2, chips: 0.1, heat: 0.05, growth: 0.5 } },
];
