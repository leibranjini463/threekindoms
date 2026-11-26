// The original's percent roll. `$E87A` reads a fixed 256-byte table (`$E8BA..$E9B9`, file 0x3E8CA: a permutation of
// 0..255) at cursor `$50` and steps the cursor; a percent check repeats it until the byte is under 100 (`bank12:$B84B`
// for a 计略, `$B72B` for 笼络). The cursor moves with every frame and idle loop, so where a roll starts is as good as
// uniform, but the value it ends on is not: a value under 100 with a long run of rejected bytes before it in the table
// is reached from more starting points. Low values happen to sit behind longer runs, so a check against p succeeds more
// often than p% (20 → 25.8%, 39 → 44.1%, 50 → 55.1%; +4.8 points on average over 5..95). A uniform 0..99 draw loses that.
// Source: analysis/rng-table.json, research/reverse-engineering.md (随机数), research/war-strategies-evidence.md §3, §8.
export const RNG_TABLE = [
  62, 78, 79, 131, 14, 201, 127, 93, 252, 230, 186, 1, 248, 0, 244, 10, 229, 169, 141, 209, 232, 219, 222, 129, 149, 114, 8, 154, 199, 73, 200, 35,
  57, 55, 224, 145, 195, 51, 155, 95, 190, 65, 238, 116, 226, 11, 71, 126, 191, 96, 187, 32, 97, 5, 178, 148, 182, 228, 58, 33, 30, 180, 140, 206,
  123, 254, 34, 220, 24, 196, 109, 251, 205, 39, 160, 9, 110, 56, 138, 4, 124, 86, 151, 90, 168, 77, 120, 181, 108, 170, 3, 26, 74, 13, 38, 130,
  173, 2, 161, 185, 163, 107, 216, 12, 76, 174, 25, 69, 91, 156, 22, 7, 137, 81, 144, 41, 245, 98, 247, 203, 241, 83, 255, 20, 101, 208, 135, 53,
  16, 115, 122, 159, 235, 217, 60, 239, 158, 215, 61, 111, 214, 132, 171, 17, 202, 210, 136, 23, 225, 166, 82, 142, 94, 54, 36, 68, 40, 164, 85, 167,
  194, 253, 118, 46, 183, 213, 246, 100, 21, 49, 153, 147, 192, 143, 179, 250, 233, 227, 103, 75, 133, 50, 198, 105, 72, 223, 162, 236, 152, 106, 231, 212,
  28, 243, 88, 80, 237, 43, 29, 134, 240, 113, 189, 52, 27, 175, 48, 45, 104, 204, 15, 87, 234, 146, 139, 63, 59, 172, 184, 193, 47, 242, 70, 117,
  150, 125, 42, 121, 64, 218, 157, 37, 18, 66, 84, 211, 31, 128, 92, 89, 67, 249, 176, 221, 99, 165, 119, 207, 19, 44, 102, 188, 112, 177, 197, 6,
];
// WEIGHT[v]: of the 256 starting cursors, how many end the rejection loop on v (v < 100).
const WEIGHT = Array(100).fill(0);
RNG_TABLE.forEach((v, i) => { if (v >= 100) return; let n = 1; for (let j = (i + 255) & 255; RNG_TABLE[j] >= 100; j = (j + 255) & 255) n++; WEIGHT[v] = n; });
// The same distribution laid out in order of value, so one draw of r(256) is one roll (and a stubbed r of 0 rolls 0).
const ROLL = WEIGHT.flatMap((n, v) => Array(n).fill(v));
const BELOW = [0]; for (const n of WEIGHT) BELOW.push(BELOW[BELOW.length - 1] + n);
// One percent roll as the original makes it: 0..99, weighted as above. r is the game's rng (r(n) → 0..n-1).
export const roll100 = (r) => ROLL[r(256)];
// The chance in percent that roll100 comes under p — what a check written as "r < p" really gives.
export const realChance = (p) => (BELOW[Math.min(100, Math.max(0, Math.floor(p)))] / 256) * 100;
// Draws one routine makes back to back read on from the same cursor, so they are not independent: the 单挑 blow
// (`bank23:$B8D3`) takes its hit roll, its damage spread and a missed 舍身's recoil in a row with no frame in between.
// One r(256) picks where the cursor stands; draw(limit, mask) is `JSR $E87A; AND #mask; CMP #limit; BCS` back.
export const tableDraws = (r) => { let c = r(256); return (limit, mask = 255) => { for (;;) { const v = RNG_TABLE[c++ & 255] & mask; if (v < limit) return v; } }; };
