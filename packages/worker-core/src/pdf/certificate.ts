// Season certificate PDF (spec 07, feature B), shared by tie-app (the learner's download) and tie-admin
// (staff download). One A4 landscape page in the brand palette, with the self-hosted Archivo Black
// Italic / Figtree fonts embedded as subsets (fonts.gen.ts) and the three skewed bars of the logo drawn
// as shapes; nothing is fetched. pdf-lib and @pdf-lib/fontkit are plain JS, so this runs in workerd.
// The file is rendered on the first download and cached in R2 (certificateR2Key); certificates.r2_key
// records it.
// Import it from '@tie/worker-core/pdf/certificate' (it is kept out of the package index so pdf-lib
// is only bundled where a certificate is served).
import fontkit from '@pdf-lib/fontkit';
import { CERT_VERIFY_ROUTE, certificateR2Key } from '@tie/shared';
import { type Color, PDFDocument, type PDFFont, type PDFPage, rgb, setCharacterSpacing } from 'pdf-lib';
import { one, run } from '../db';
import { ARCHIVO_BLACK_ITALIC_TTF, FIGTREE_TTF } from './fonts.gen';

export interface CertificatePdfInput {
  code: string;
  fullName: string;
  seasonN: number;
  seasonTitle: string;
  /** CEFR level of the season ("A1"), when the level list names one. */
  cefr: string | null;
  scorePct: number;
  issuedAt: number;
  /** Absolute verification URL (`${APP_ORIGIN}/#/certificado/<code>`). */
  verifyUrl: string;
}

const hex = (h: string): Color => {
  const n = Number.parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const C = {
  navy: hex('#0F2A55'),
  navy2: hex('#163566'),
  navy3: hex('#2C4674'),
  orange: hex('#F45A28'),
  blue: hex('#2A6FF5'),
  cream: hex('#F8F5EB'),
  line: hex('#E6E0CE'),
  ink: hex('#1C1C1C'),
  muted: hex('#56607A'),
  onNavy: hex('#C9D3E6'),
  white: rgb(1, 1, 1),
};

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "18 de outubro de 2026" in Brasília time (UTC−3, no daylight saving since 2019). */
export function datePtBr(at: number): string {
  const d = new Date(at - 3 * 3600_000);
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** The public verification URL of a code. */
export const certificateVerifyUrl = (origin: string, code: string): string =>
  `${origin.replace(/\/+$/, '')}/#/${CERT_VERIFY_ROUTE}/${code}`;

const b64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
let fontBytes: { display: Uint8Array; text: Uint8Array } | null = null;

/** Latin letters that NFD does not decompose into a base letter + accent. */
const TRANSLIT: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i',
  Ŀ: 'L',
  ŀ: 'l',
  Ŧ: 'T',
  ŧ: 't',
  Ø: 'O',
  ø: 'o',
  Œ: 'OE',
  œ: 'oe',
  ẞ: 'SS',
};

/**
 * Text the embedded subset can draw: characters outside the font (latin subset) lose their accents
 * (NFD) or become '?', so an unusual name never breaks the render.
 */
function fit(font: PDFFont, text: string): string {
  const set = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0) ?? 63;
    if (set.has(cp)) out += ch;
    else if (TRANSLIT[ch] && [...(TRANSLIT[ch] ?? '')].every((b) => set.has(b.codePointAt(0) ?? 0))) {
      out += TRANSLIT[ch];
    } else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += [...base].every((b) => set.has(b.codePointAt(0) ?? 0)) && base ? base : '?';
    }
  }
  return out;
}

interface TextOpts {
  font: PDFFont;
  size: number;
  color: Color;
  /** Extra space between letters, in points (kickers). */
  tracking?: number;
}

function width(text: string, o: TextOpts): number {
  return o.font.widthOfTextAtSize(text, o.size) + (o.tracking ?? 0) * Math.max(0, [...text].length - 1);
}

function text(page: PDFPage, s: string, x: number, y: number, o: TextOpts): void {
  if (o.tracking) page.pushOperators(setCharacterSpacing(o.tracking));
  page.drawText(s, { x, y, size: o.size, font: o.font, color: o.color });
  if (o.tracking) page.pushOperators(setCharacterSpacing(0));
}

/** Largest size ≤ `size` (and ≥ `min`) at which the text fits `max` points. */
function shrink(s: string, o: TextOpts, max: number, min: number): TextOpts {
  let size = o.size;
  while (size > min && width(s, { ...o, size }) > max) size -= 1;
  return { ...o, size };
}

/** Greedy word wrap. */
function wrap(s: string, o: TextOpts, max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && width(next, o) > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * The logo's three bars (blue, orange, third), skewed like `.logo .el` (skewX(−22°)), with their top
 * left corner at (x, y). `h` is one bar's height; the bars are 4h wide with a 0.55h gap.
 */
function bars(page: PDFPage, x: number, y: number, h: number, third: Color): void {
  const w = h * 4.1;
  const gap = h * 0.55;
  const skew = Math.tan((22 * Math.PI) / 180);
  [C.blue, C.orange, third].forEach((color, i) => {
    const top = y - i * (h + gap);
    const bottom = top - h;
    // Skewed right as it rises: the top edge sits further right than the bottom edge.
    const dxTop = skew * (top - (y - 3 * h - 2 * gap));
    const dxBottom = skew * (bottom - (y - 3 * h - 2 * gap));
    const path = `M ${x + dxBottom} ${-bottom} L ${x + dxBottom + w} ${-bottom} L ${x + dxTop + w} ${-top} L ${x + dxTop} ${-top} Z`;
    page.drawSvgPath(path, { x: 0, y: 0, color });
  });
}

/** Wordmark "TAKE IT ≡ EASY" with its baseline at y; returns its width. */
function wordmark(page: PDFPage, x: number, y: number, size: number, font: PDFFont, ink: Color, third: Color): number {
  const o = { font, size, color: ink };
  const left = 'TAKE IT';
  text(page, left, x, y, o);
  const lw = width(left, o);
  const h = size * 0.22;
  const barsX = x + lw + size * 0.28;
  bars(page, barsX, y + size * 0.8, h, third);
  const rx = barsX + h * 4.1 + size * 0.42 + size * 0.2;
  text(page, 'EASY', rx, y, o);
  return rx + width('EASY', o) - x;
}

/** Renders the certificate (A4 landscape, one page). */
export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  fontBytes ??= { display: b64(ARCHIVO_BLACK_ITALIC_TTF), text: b64(FIGTREE_TTF) };
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const display = await doc.embedFont(fontBytes.display, { subset: true });
  const body = await doc.embedFont(fontBytes.text, { subset: true });

  const title = `Certificado ${input.code}`;
  doc.setTitle(`Take It Easy · ${title}`);
  doc.setAuthor('Take It Easy');
  doc.setSubject(`Certificado de conclusão da Temporada ${input.seasonN}`);
  doc.setCreator('Take It Easy');
  doc.setProducer('Take It Easy');
  doc.setLanguage('pt-BR');
  doc.setCreationDate(new Date(input.issuedAt));
  doc.setModificationDate(new Date(input.issuedAt));

  const W = 841.89;
  const H = 595.28;
  const page = doc.addPage([W, H]);

  // ---------- Background and the navy side panel ----------
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.cream });
  const P = 236;
  page.drawRectangle({ x: 0, y: 0, width: P, height: H, color: C.navy });
  // An orange rule along the panel's edge.
  page.drawRectangle({ x: P, y: 0, width: 6, height: H, color: C.orange });
  // A hairline frame on the cream side.
  page.drawRectangle({
    x: P + 26,
    y: 24,
    width: W - P - 50,
    height: H - 48,
    borderColor: C.line,
    borderWidth: 1.2,
  });

  // Panel: logo, tagline, the season number, the level.
  const panelX = 34;
  wordmark(page, panelX, H - 70, 21, display, C.white, C.white);
  text(page, fit(body, 'INGLÊS PARA QUEM FALA PORTUGUÊS'), panelX, H - 90, {
    font: body,
    size: 7,
    color: C.onNavy,
    tracking: 0.9,
  });

  text(page, 'TEMPORADA', panelX, 236, { font: body, size: 10, color: C.onNavy, tracking: 2.4 });
  const big = String(input.seasonN);
  text(page, big, panelX - 4, 96, { font: display, size: 150, color: C.white });
  if (input.cefr) {
    const lvl = fit(body, `NÍVEL ${input.cefr} · QECR`);
    text(page, lvl, panelX, 66, { font: body, size: 9, color: C.onNavy, tracking: 1.6 });
  }
  // The logo's bars, large, beside the season number.
  bars(page, 146, 196, 14, C.navy3);

  // ---------- Content ----------
  const L = P + 70;
  const R = W - 70;
  const maxW = R - L;

  const kicker = { font: body, size: 11, color: C.orange, tracking: 2.6 };
  text(page, fit(body, 'CERTIFICADO DE CONCLUSÃO'), L, H - 96, kicker);

  text(page, 'Certificamos que', L, H - 150, { font: body, size: 15, color: C.muted });

  // The name on one line down to 30pt; a longer one wraps onto two lines (down to 22pt).
  const name = fit(display, input.fullName.trim() || '—');
  const base = { font: display, size: 44, color: C.navy };
  let nameO = shrink(name, base, maxW, 30);
  let nameLines = [name];
  if (width(name, nameO) > maxW) {
    for (let size = 32; size >= 22; size -= 2) {
      nameO = { ...base, size };
      nameLines = wrap(name, nameO, maxW);
      if (nameLines.length <= 2 && nameLines.every((l) => width(l, nameO) <= maxW)) break;
    }
    nameLines = nameLines.slice(0, 2);
  }
  const lead = nameO.size * 1.12;
  let y = H - 206 + (nameLines.length > 1 ? nameO.size * 0.3 : 0);
  for (const line of nameLines) {
    text(page, line, L, y, nameO);
    y -= lead;
  }
  const ruleY = y + lead - 20;
  // Underline: orange then blue, like the bars.
  const ruleW = Math.min(maxW, Math.max(140, Math.max(...nameLines.map((l) => width(l, nameO))) * 0.5));
  page.drawRectangle({ x: L, y: ruleY, width: ruleW * 0.62, height: 4, color: C.orange });
  page.drawRectangle({ x: L + ruleW * 0.62 + 4, y: ruleY, width: ruleW * 0.38, height: 4, color: C.blue });

  const season = `Temporada ${input.seasonN} · ${input.seasonTitle.trim()}`;
  const sentence =
    `concluiu a ${season} do curso de inglês Take It Easy` +
    `${input.cefr ? `, nível ${input.cefr} do Quadro Europeu Comum de Referência,` : ''}` +
    ` com ${input.scorePct}% de acertos no teste da temporada.`;
  const para = { font: body, size: 15, color: C.ink };
  y = ruleY - 42;
  for (const line of wrap(fit(body, sentence), para, maxW)) {
    text(page, line, L, y, para);
    y -= 23;
  }

  // ---------- Footer: date, code, score seal, verification ----------
  const footY = 112;
  const sealR = 46;
  page.drawLine({
    start: { x: L, y: footY + 44 },
    end: { x: R - 2 * sealR - 18, y: footY + 44 },
    thickness: 1,
    color: C.line,
  });
  const label = { font: body, size: 8.5, color: C.muted, tracking: 1.6 };
  const value = { font: display, size: 14, color: C.navy };
  const date = fit(display, datePtBr(input.issuedAt));
  const col2 = L + Math.max(maxW * 0.36, width(date, value) + 34);
  text(page, 'EMITIDO EM', L, footY + 22, label);
  text(page, date, L, footY, value);
  text(page, fit(body, 'CÓDIGO'), col2, footY + 22, label);
  text(page, input.code, col2, footY, value);

  // Seal: an orange disc with the score.
  const sealX = R - sealR;
  const sealY = footY + 6;
  page.drawCircle({ x: sealX, y: sealY, size: sealR, color: C.orange });
  page.drawCircle({ x: sealX, y: sealY, size: sealR - 6, borderColor: C.white, borderWidth: 1.2 });
  const pct = `${input.scorePct}%`;
  const pctO = { font: display, size: 24, color: C.white };
  text(page, pct, sealX - width(pct, pctO) / 2, sealY - 2, pctO);
  const sealLbl = { font: body, size: 7, color: C.white, tracking: 1.4 };
  const acertos = 'ACERTOS';
  text(page, acertos, sealX - width(acertos, sealLbl) / 2, sealY - 16, sealLbl);

  const verify = { font: body, size: 9.5, color: C.muted };
  text(page, fit(body, 'Confira a autenticidade deste certificado em'), L, 62, verify);
  const urlO = shrink(input.verifyUrl, { font: body, size: 10.5, color: C.blue }, maxW, 6);
  text(page, fit(body, input.verifyUrl), L, 46, urlO);
  page.drawLine({
    start: { x: L, y: 43 },
    end: { x: L + width(input.verifyUrl, urlO), y: 43 },
    thickness: 0.6,
    color: C.blue,
  });

  return doc.save({ useObjectStreams: true });
}

// ---------- Storage (both Workers) ----------

export interface CertificateRow {
  id: string;
  code: string;
  user_id: string;
  season_n: number;
  full_name_snapshot: string;
  season_title_snapshot: string;
  score_pct: number;
  issued_at: number;
  r2_key: string | null;
  revoked_at: number | null;
  /** CEFR of the season from the onboarding level list (option_lists 'levels'). */
  cefr: string | null;
}

/** The certificate row plus the season's CEFR label, or null. */
export function loadCertificate(db: D1Database, id: string): Promise<CertificateRow | null> {
  return one<CertificateRow>(
    db,
    `SELECT c.id, c.code, c.user_id, c.season_n, c.full_name_snapshot, c.season_title_snapshot, c.score_pct,
       c.issued_at, c.r2_key, c.revoked_at,
       (SELECT json_extract(o.extra, '$.cefr') FROM option_lists o
         WHERE o.list_key = 'levels' AND json_valid(o.extra) AND json_extract(o.extra, '$.season') = c.season_n
         ORDER BY o.sort LIMIT 1) AS cefr
     FROM certificates c WHERE c.id = ?`,
    id,
  );
}

/**
 * The certificate's PDF bytes: the copy cached in R2 when there is one, else rendered now, stored at
 * certificateR2Key() and recorded in certificates.r2_key (only the first render records it).
 */
export async function certificatePdf(
  env: { DB: D1Database; MEDIA: R2Bucket },
  row: CertificateRow,
  appOrigin: string,
): Promise<Uint8Array> {
  if (row.r2_key) {
    const cached = await env.MEDIA.get(row.r2_key);
    if (cached) return new Uint8Array(await cached.arrayBuffer());
  }
  const bytes = await renderCertificatePdf({
    code: row.code,
    fullName: row.full_name_snapshot,
    seasonN: row.season_n,
    seasonTitle: row.season_title_snapshot,
    cefr: typeof row.cefr === 'string' && row.cefr.trim() ? row.cefr.trim() : null,
    scorePct: row.score_pct,
    issuedAt: row.issued_at,
    verifyUrl: certificateVerifyUrl(appOrigin, row.code),
  });
  const key = certificateR2Key(row.user_id, row.id);
  await env.MEDIA.put(key, bytes, {
    httpMetadata: {
      contentType: 'application/pdf',
      contentDisposition: `attachment; filename="${pdfFilename(row.code)}"`,
    },
  });
  await run(env.DB, 'UPDATE certificates SET r2_key = ? WHERE id = ? AND r2_key IS NULL', key, row.id);
  return bytes;
}

export const pdfFilename = (code: string): string => `certificado-take-it-easy-${code}.pdf`;

/** application/pdf download, never cached by the browser or a proxy. */
export function pdfResponse(bytes: Uint8Array, code: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFilename(code)}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
