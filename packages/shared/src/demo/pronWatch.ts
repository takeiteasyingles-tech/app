import type { PronTip } from '../contracts/ai';

/** Up to 2 words worth a pronunciation tip for Portuguese speakers: h, s+consonant, th, final stops. */
export function pronWatch(text: unknown): PronTip[] {
  const out: PronTip[] = [];
  const seen = new Set<string>();
  for (const w of String(text)
    .toLowerCase()
    .match(/[a-z’']+/g) || []) {
    if (seen.has(w) || out.length >= 2) continue;
    let tip = '';
    if (/^h/.test(w) && !/^(hour|honest|honor)/.test(w)) tip = `O h de ${w} é só ar. Nada de R de “rato”.`;
    else if (/^s[ptkcmnlw]/.test(w)) tip = `Comece pelo S: sss-${w.slice(1)}. Sem “i” antes.`;
    else if (/^th/.test(w)) tip = 'Th: língua entre os dentes e sopro.';
    else if (/[bdgkp]$/.test(w) && w.length >= 3) tip = `Termine ${w} seco, sem “${w}i” no fim.`;
    if (tip) {
      out.push({ word: w, tip_pt: tip });
      seen.add(w);
    }
  }
  return out;
}
