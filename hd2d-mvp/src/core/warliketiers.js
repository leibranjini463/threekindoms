// 电脑好战 2.0 tiers and the accessors that read them (see warlike.js). No imports: game.js reads aiIncome from
// here, so game.js ↔ warlike.js stays free of an import cycle (tests/strategymodules.test.mjs).

// One row per g.level. Off (g.warlike falsy) never reads this table: every accessor returns the original constant.
export const TIERS = [
  { search: 20, miss: 10, ronin: 20, roninMiss: 10, conscriptShare: 0.5, goldFloor: 300, refillPerMonth: 2,
    sourceExtra: 3, giveDrop: 1, keepDrop: 1, attackWeight: 0, strength: 0, target: 'original',
    extraPoints: 0, loyaltyBonus: 0, loyaltyCap: 90, devK: null, freeRefill: false,
    popFloor: 250, rewardBelow: 70, floodBelow: 50, charityBelow: 60, incomeBonus: 0, incomeRiceBonus: 0 },
  { search: 50, miss: 25, ronin: 50, roninMiss: 25, conscriptShare: 1, goldFloor: 200, refillPerMonth: Infinity,
    sourceExtra: 2, giveDrop: 1, keepDrop: 1, attackWeight: 4, strength: 0.5, target: 'fewestThenTroops',
    extraPoints: 0, loyaltyBonus: 0, loyaltyCap: 90, devK: null, freeRefill: false,
    popFloor: 250, rewardBelow: 70, floodBelow: 50, charityBelow: 60, incomeBonus: 0, incomeRiceBonus: 0 },
  { search: 100, miss: 40, ronin: 100, roninMiss: 40, conscriptShare: 1, goldFloor: 100, refillPerMonth: Infinity,
    sourceExtra: 2, giveDrop: 1, keepDrop: 1, attackWeight: 4, strength: 1, target: 'fewestThenTroops',
    extraPoints: 10, loyaltyBonus: 10, loyaltyCap: 95, devK: 22, freeRefill: true,
    popFloor: 250, rewardBelow: 70, floodBelow: 50, charityBelow: 60, incomeBonus: 150, incomeRiceBonus: 150 },
];

export const tier = (g) => (g.warlike ? TIERS[g.level] : null);
// A C66F/search draws: original 10/10 (found on 10, miss on 10)
export const searchOdds = (g) => { const t = tier(g); return t ? { search: t.search, miss: t.miss, ronin: t.ronin, roninMiss: t.roninMiss } : { search: 10, miss: 10, ronin: 10, roninMiss: 10 }; };
export const extraPoints = (g) => tier(g)?.extraPoints ?? 0;
// A208: the source needs defenders + 3 officers originally
export const sourceExtra = (g) => tier(g)?.sourceExtra ?? 3;
// A303: threshold drop for cities giving officers
export const giveDrop = (g) => tier(g)?.giveDrop ?? 0;
// A6C9: officers kept behind
export const keepDrop = (g) => tier(g)?.keepDrop ?? 0;
// BEC7: development multiplier (tenths); null = keep the ROM table value
export const devK = (g, K) => tier(g)?.devK ?? K;
// Gold (March) and rice (September) income (game.js income, 5.2) of an AI faction's city: + the tier's incomeBonus /
// incomeRiceBonus percent (上级 resources). Player cities and the option off: inc itself; the 9999 cap is the caller's.
export const aiIncome = (g, c, kind, inc) => { const t = tier(g), b = t && (kind === 'gold' ? t.incomeBonus : t.incomeRiceBonus); return b && g.factions[c.faction]?.ai ? Math.floor((inc * (100 + b)) / 100) : inc; };
// recruitLoyalty() result for an AI recruit; the bonus is capped, and a tier without bonus returns base untouched
export const aiRecruitLoyalty = (g, base) => { const t = tier(g); return t && t.loyaltyBonus ? Math.min(t.loyaltyCap, base + t.loyaltyBonus) : base; };
