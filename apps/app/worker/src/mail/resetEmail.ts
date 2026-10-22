// The "Esqueci a senha" e-mail (spec 07, feature A): pt-BR, plain text + a simple table-based HTML in
// the app's colours (navy header with the TAKE IT / EASY wordmark drawn in markup, orange button on
// white, cream page). No remote images, no web fonts, no tracking: every e-mail client shows it as is.

export interface ResetEmailInput {
  /** Display name (profiles.name); empty falls back to a neutral greeting. */
  name: string;
  /** `${APP_ORIGIN}/#/entrar?reset=<token>`. */
  link: string;
  /** Link lifetime in minutes (DURATIONS.resetEmailTokenMs). */
  minutes: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// tie.css tokens.
const NAVY = '#0F2A55';
const NAVY2 = '#163566';
const BLUE = '#2A6FF5';
const ORANGE = '#F45A28';
const CREAM = '#F8F5EB';
const LINE = '#E6E0CE';
const INK = '#1C1C1C';
const MUTED = '#56607A';
const ON_NAVY = '#C9D3E6';
const FONT = "'Nunito','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => ESC[ch] ?? ch);

function lifetime(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hora' : `${h} horas`;
  }
  return `${minutes} minutos`;
}

/** The wordmark of @tie/ui Logo (white variant): TAKE IT, three slanted bars, EASY. */
function wordmark(): string {
  const bar = (color: string) =>
    `<div style="width:14px;height:4px;margin:2px 0;border-radius:3px 1px 3px 1px;background:${color};font-size:0;line-height:0;">&nbsp;</div>`;
  const word = (t: string) =>
    `<td style="font-family:${FONT};font-size:22px;font-weight:900;font-style:italic;color:#ffffff;letter-spacing:.01em;line-height:1;">${t}</td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${word('TAKE IT')}<td style="padding:0 6px;transform:skewX(-22deg);">${bar(BLUE)}${bar(ORANGE)}${bar('#ffffff')}</td>${word('EASY')}</tr></table>
<div style="font-family:${FONT};font-size:10px;font-weight:800;letter-spacing:.14em;color:${ON_NAVY};margin-top:6px;">INGLÊS PARA QUEM FALA PORTUGUÊS</div>`;
}

export function resetEmail({ name, link, minutes }: ResetEmailInput): RenderedEmail {
  const who = name.trim();
  const hello = who ? `Oi, ${who}!` : 'Oi!';
  const valid = lifetime(minutes);
  const subject = 'Crie uma senha nova no Take It Easy';
  const preheader = `O link vale por ${valid} e funciona uma vez só.`;

  const text = [
    hello,
    '',
    'Recebemos um pedido para criar uma senha nova para a sua conta no Take It Easy.',
    'Abra o link abaixo para escolher a senha nova:',
    '',
    link,
    '',
    `O link vale por ${valid} e funciona uma vez só. Depois de trocar a senha, as outras sessões abertas são encerradas.`,
    '',
    'Não pediu? Pode ignorar este e-mail: a sua senha atual continua valendo.',
    '',
    'Take It Easy · Inglês para quem fala português',
  ].join('\n');

  const href = escapeHtml(link);
  const p = (body: string, extra = '') =>
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.55;color:${INK};${extra}">${body}</p>`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${CREAM};">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1.5px solid ${LINE};border-radius:20px;overflow:hidden;">
<tr><td style="background:${NAVY};background-image:linear-gradient(135deg,${NAVY},${NAVY2});padding:26px 28px 24px;">
${wordmark()}
</td></tr>
<tr><td style="height:4px;background:${ORANGE};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 14px;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:900;color:${NAVY};">${escapeHtml(hello)}</h1>
${p('Recebemos um pedido para criar uma senha nova para a sua conta no Take It Easy. Use o botão abaixo para escolher a senha nova.')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;"><tr>
<td align="center" bgcolor="${ORANGE}" style="border-radius:999px;background:${ORANGE};">
<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:999px;">Criar senha nova</a>
</td></tr></table>
${p(`O link vale por <b>${escapeHtml(valid)}</b> e funciona uma vez só. Depois de trocar a senha, as outras sessões abertas são encerradas.`, `color:${MUTED};font-size:15px;`)}
${p('Se o botão não abrir, copie e cole este endereço no navegador:', `color:${MUTED};font-size:14px;margin-bottom:6px;`)}
<p style="margin:0 0 22px;font-family:${FONT};font-size:13px;line-height:1.5;word-break:break-all;"><a href="${href}" target="_blank" rel="noopener" style="color:${BLUE};">${href}</a></p>
<div style="border-top:1.5px solid ${LINE};padding-top:16px;margin-bottom:20px;">
${p('<b>Não pediu?</b> Pode ignorar este e-mail: a sua senha atual continua valendo.', `color:${MUTED};font-size:14px;margin:0;`)}
</div>
</td></tr>
</table>
<p style="margin:16px 0 0;font-family:${FONT};font-size:12px;color:${MUTED};">Take It Easy · Inglês para quem fala português</p>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
