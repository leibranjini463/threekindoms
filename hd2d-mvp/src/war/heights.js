// How high each cell of the 3D war board stands (docs/战场3D矮台地修改计划_2026-11-21.md). Kept apart, with no imports, so the
// board (src/war/board.js) and the occlusion test (tests/warocclusion.test.mjs) read the one set of numbers. The rules never
// read these heights.
//
// Plain, sand, wood and village ground at PLAIN_Y; a hill is a low flat mesa: HILL_RIM above the plain where any of its four
// neighbours is other ground, HILL_CORE where all four are hill too. Low on purpose: a mesa 0.75 high hid the lower half of a
// general one cell behind it at the 38° pitch and 45° yaw the camera keeps (a face 1 high shades 1.28 cells of ground behind it);
// at 0.35 the line over its top lands past his feet.
export const PLAIN_Y = 0.3, CASTLE_Y = 0.8, RIVER_BED_Y = 0.05;
export const HILL_RIM = 0.35, HILL_CORE = 0.6;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// isHill(x, y): whether that cell is hill (the caller decides what lies past the board's edge).
export const hillTop = (isHill, x, y) => PLAIN_Y + (N4.every(([dx, dy]) => isHill(x + dx, y + dy)) ? HILL_CORE : HILL_RIM);
