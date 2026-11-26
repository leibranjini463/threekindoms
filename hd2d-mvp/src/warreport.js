// Battle report presentation, after resolveWar has placed every officer.
import { cityName, officerCity, isRuler, DEAD, RONIN } from './core/game.js';

export function warFate(g, war, res, id) {
  const o = g.officers[id];
  if (res.dead.includes(id)) return ['阵亡', 'bad', true];
  // checkFactions runs after the report (and may ask the player to choose an heir).
  // Its ronin ruler is already doomed: show that outcome without advancing events or mutating the game. One the AI
  // settlement sent 下野 alive (res.adrift, warcore resolveWar) is reported as 下野 like his officers.
  if (o.status === DEAD || (o.status === RONIN && isRuler(g, id) && !res.adrift?.includes(id))) return ['无路可退，身亡', 'bad', true];
  if (o.status === RONIN) return [`下野（${cityName(o.loc)}）`, 'bad'];
  const city = officerCity(g, id), captured = res.captured.byAtt.includes(id) || res.captured.byDef.includes(id);
  if (captured) return [`被俘归顺${city ? `（${cityName(city.id)}）` : ''}`, 'bad'];
  if (city && (city.id !== war.city || res.retreated.some((x) => x.id === id))) {
    const retreat = res.survivors[res.loser].includes(id) || res.retreated.some((x) => x.id === id);
    return [`${retreat ? '退往' : '前往'}${cityName(city.id)}`, ''];
  }
  return ['生还', 'good'];
}
