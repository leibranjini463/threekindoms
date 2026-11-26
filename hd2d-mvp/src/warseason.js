// Which ground a battle is fought on: the month's grass, snow and tree sheet at the field's latitude (the war
// map's materials, src/warplate.js), and which of a painted battlefield's four pictures (spring, summer, autumn,
// winter; assets/ai/warground/maps) it shows. No three.js here: the painting tools read it too.
import { MONTHS } from './seasons.js';

// The month and latitude pick the grass (a base and a second one in patches), how much snow lies and the tree
// sheet, by the same rules as the weather (seasonenv.js): snow north of the month's snow line, blossom only
// south of the 黄河, the far south (交州) green through the winter.
export function groundSeason(month, lat) {
  const m = MONTHS[month], snowing = lat > m.snow - 0.6, south = lat < 27.5 && m.south > 0.5;
  const snow = snowing ? Math.min(0.78, 0.32 + (lat - m.snow + 0.6) * 0.18) : 0;
  let grass = 'grass', mix = null;
  if (south) mix = ['grass-autumn', 0.3];
  else if (month <= 1) grass = 'grass-spring';
  else if (month === 2) [grass, mix] = ['grass-spring', ['grass', 0.45]];
  else if (month === 3) mix = ['grass-spring', 0.35];
  else if (month === 7) mix = ['grass-autumn', 0.4];
  else if (month === 8) [grass, mix] = ['grass-autumn', ['grass', 0.35]];
  else if (month >= 9) grass = 'grass-autumn';
  const trees = snowing || (!south && m.bare > 0.6) ? 'trees-winter' : !south && m.autumn > 0.5 ? 'trees-autumn' : m.blossom > 0.4 && lat < 38.5 ? 'trees-spring' : 'trees';
  return { grass, mix, snow, trees };
}

export const seasonKey = (month, s) => (s.snow ? 'winter' : s.trees === 'trees-autumn' || s.grass === 'grass-autumn' ? 'autumn' : month <= 3 ? 'spring' : 'summer');
// The pictures a field needs over the year, given its latitude.
export const seasonsOf = (lat) => [...new Set(MONTHS.map((_, m) => seasonKey(m, groundSeason(m, lat))))];
