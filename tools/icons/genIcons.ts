// `npm run icons`: renders prototipo/assets/svg/icon.svg into the PWA icon set with @resvg/resvg-js.
//   apps/app/web/public/icons/{icon.svg, icon-192.png, icon-512.png, maskable-512.png, apple-touch-180.png, favicon-32.png}
//   apps/admin/web/public/icons/{icon.svg, favicon-32.png}
// "any" icons keep the transparent rounded corners. Maskable and apple-touch sit on a full-bleed navy
// square (platforms crop them); maskable shrinks the mark to 80% so it stays inside the safe zone.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const NAVY = '#0F2A55';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = join(repo, 'prototipo', 'assets', 'svg', 'icon.svg');
const appOut = join(repo, 'apps', 'app', 'web', 'public', 'icons');
const adminOut = join(repo, 'apps', 'admin', 'web', 'public', 'icons');

const svg = await readFile(source, 'utf8');
const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];
if (!inner) throw new Error(`${source}: no <svg> root`);

/** The 64×64 mark on a navy square, scaled to `scale` of the side and centred. */
function onNavy(scale: number): string {
  const pad = (64 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${NAVY}"/><g transform="translate(${pad} ${pad}) scale(${scale})">${inner}</g></svg>`;
}

function png(markup: string, size: number): Buffer {
  return new Resvg(markup, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

const targets: [dir: string, file: string, markup: string, size: number][] = [
  [appOut, 'icon-192.png', svg, 192],
  [appOut, 'icon-512.png', svg, 512],
  [appOut, 'maskable-512.png', onNavy(0.8), 512],
  [appOut, 'apple-touch-180.png', onNavy(1), 180],
  [appOut, 'favicon-32.png', svg, 32],
  [adminOut, 'favicon-32.png', svg, 32],
];

// The favicon SVG is the prototype's file plus a <title> (accessible name).
const titled = svg.replace(/(<svg[^>]*>)/, '$1<title>Take It Easy</title>');
for (const dir of [appOut, adminOut]) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'icon.svg'), titled);
}
for (const [dir, file, markup, size] of targets) {
  const bytes = png(markup, size);
  await writeFile(join(dir, file), bytes);
  console.log(`${join(dir, file).slice(repo.length + 1)}  ${size}px  ${bytes.byteLength} bytes`);
}
