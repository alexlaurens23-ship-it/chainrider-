// Temporary helper: prints golden strings for test/trackgen.test.ts.
import { normalize, rawTrack, smoothTrack, stats } from "../src/trackgen.js";

// ~24 closes with a violent spike so the 55-degree clamp engages.
const SPIKY_CLOSES = [
  100, 102, 99, 104, 108, 105, 111, 118, 114, 122, 240, 130, 126, 133, 129, 138, 145, 141, 152,
  148, 158, 163, 159, 168,
];

// Gentle drift: low vol, clamp must NOT engage.
const CALM_CLOSES = [
  100, 100.5, 101.2, 100.8, 101.5, 102.1, 101.7, 102.4, 103.0, 102.6, 103.3, 103.9,
];

for (const [label, closes] of [
  ["SPIKY", SPIKY_CLOSES],
  ["CALM", CALM_CLOSES],
] as const) {
  const points = normalize(closes);
  const raw = rawTrack(points);
  const smooth = smoothTrack(points);
  console.log(`${label}_NORMALIZED = ${JSON.stringify(points)}`);
  console.log(`${label}_RAW_STATS = ${JSON.stringify(stats(raw))}`);
  console.log(`${label}_SMOOTH = ${JSON.stringify(smooth)}`);
  console.log(`${label}_SMOOTH_STATS = ${JSON.stringify(stats(smooth))}`);
  console.log("");
}
