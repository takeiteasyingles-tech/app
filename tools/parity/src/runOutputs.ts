// The files a parity run leaves behind: key.json (blind pairs) or shots/index.json (--shots-only).
// The CLI writes them while it still holds the slot lock (see cli.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Key } from './pair';

export interface RunOutputDirs {
  key: string;
  shots: string;
}

export interface ShotsIndex {
  runId: string;
  app: string;
  shots: { file: string }[];
}

export function writeRunOutputs(
  shotsOnly: boolean,
  dirs: RunOutputDirs,
  data: { index: ShotsIndex; key: Key },
): string {
  if (shotsOnly) {
    mkdirSync(dirs.shots, { recursive: true });
    const shots = [...data.index.shots].sort((x, y) => x.file.localeCompare(y.file));
    const file = join(dirs.shots, 'index.json');
    writeFileSync(file, `${JSON.stringify({ ...data.index, shots }, null, 2)}\n`);
    return file;
  }
  mkdirSync(dirs.key, { recursive: true });
  const file = join(dirs.key, 'key.json');
  writeFileSync(file, `${JSON.stringify(data.key, null, 2)}\n`);
  return file;
}
