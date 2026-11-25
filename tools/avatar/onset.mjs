// Speech onset of a talk clip: first frame where the mouth region starts to change fast.
// SSIM of the mouth crop against frame 0; onset = first n where ssim[n] - ssim[n+2] > 0.04.
// Usage: node onset.mjs <talk.mp4> [crop=w:h:x:y]   (FFMPEG=path/to/ffmpeg if it is not on PATH)
// Check the result by eye: a smile during the lead-in can trigger it early.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FF = process.env.FFMPEG ?? 'ffmpeg';
const [arg, crop = '160:90:550:240'] = process.argv.slice(2);
const video = resolve(arg);
const tmp = tmpdir();
const ref = join(tmpdir(), `onset-${process.pid}.png`);
const statsName = `onset-${process.pid}.txt`;
const stats = join(tmp, statsName);
execFileSync(FF, ['-v', 'error', '-y', '-i', video, '-vf', `select=eq(n\\,0),crop=${crop}`, '-frames:v', '1', ref]);
execFileSync(
  FF,
  [
    '-v',
    'error',
    '-i',
    video,
    '-loop',
    '1',
    '-i',
    ref,
    '-lavfi',
    `[0]crop=${crop}[a];[a][1]ssim=stats_file=${statsName}`,
    '-frames:v',
    '120',
    '-f',
    'null',
    '-',
  ],
  { cwd: tmp },
);
const s = readFileSync(stats, 'utf8')
  .trim()
  .split('\n')
  .map((l) => Number(l.match(/All:([0-9.]+)/)[1]));
rmSync(ref);
rmSync(stats);
const onset = s.findIndex((v, i) => i + 2 < s.length && v - s[i + 2] > 0.04);
console.log(JSON.stringify({ video, onset, ssimAtOnset: s[onset]?.toFixed(3) }));
