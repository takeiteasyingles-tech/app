// Course home (web/home.html): the page's phase (pre-premiere, MVP, official launch), the premiere
// countdown, the demo conversation with the Woods and the sign-up form, which hands its fields to the
// app's own sign-up (#/cadastro/1) where the visitor picks a password and the account is created.
// The CSP forbids innerHTML: every node is built with the DOM API.
import '@tie/ui/css/fonts.css';
import './site.css';
import { writeSignupHandoff } from '../core/signupHandoff';
import { APP_BASE, type Fase, SITE } from './config';
import { CONVERSAS, type Opcao, type Personagem, RESULTADOS, type Tipo } from './conversa';

/* ---------- Phase ---------- */

function faseAtual(): Fase {
  const q = new URLSearchParams(location.search).get('fase');
  if (q === 'pre' || q === 'mvp' || q === 'oficial') return q;
  if (SITE.forcarFase) return SITE.forcarFase;
  const agora = Date.now();
  if (agora >= new Date(SITE.lancamentoOficial).getTime()) return 'oficial';
  if (agora >= new Date(SITE.estreia).getTime()) return 'mvp';
  return 'pre';
}
const FASE = faseAtual();
document.body.classList.add(`fase-${FASE}`);
const CTA_EPISODIO = FASE === 'pre' ? 'Garantir meu acesso ao Episódio 1' : 'Assistir ao Episódio 1 grátis';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** document.createElement with classes and children (strings become text nodes). */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...children);
  return e;
}

/* ---------- Countdown ---------- */

if (FASE === 'pre') {
  const alvo = new Date(SITE.estreia).getTime();
  const cell = (k: string) => document.querySelector<HTMLElement>(`[data-cd="${k}"]`);
  const [d, h, m] = [cell('d'), cell('h'), cell('m')];
  const tick = () => {
    const s = Math.max(0, Math.floor((alvo - Date.now()) / 1000));
    if (d) d.textContent = String(Math.floor(s / 86400));
    if (h) h.textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
    if (m) m.textContent = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  };
  tick();
  setInterval(tick, 30000);
}

/* ---------- Talk to the Woods ---------- */

const ROTULO: Record<Tipo, string> = { certo: 'Certo', ajuste: 'Ajuste', natural: 'Mais natural' };
const PONTOS: Record<Tipo, number> = { certo: 2, natural: 1, ajuste: 0 };
const MAX_PONTOS = 14;

const pick = byId('woods-pick');
const chat = byId('chat');
const body = byId('chat-body');
const opcoesEl = byId('chat-opcoes');
const resEl = byId('chat-resultado');
const barra = byId('chat-progresso');

if (pick && chat && body && opcoesEl && resEl && barra) {
  let estado: { id: Personagem; i: number; pontos: number } | null = null;

  const rolar = () => {
    body.scrollTop = body.scrollHeight;
  };
  const add = (cls: string, ...children: (Node | string)[]) => {
    body.append(el('div', `msg ${cls}`, ...children));
    rolar();
  };
  const botFala = (en: string, pt: string) => {
    const e = el('span', 'en', en);
    e.lang = 'en';
    add('bot', e, el('span', 'pt', pt));
  };

  const iniciar = (id: Personagem) => {
    const c = CONVERSAS[id];
    estado = { id, i: 0, pontos: 0 };
    const foto = byId<HTMLImageElement>('chat-foto');
    if (foto) foto.src = c.foto;
    const nome = byId('chat-nome');
    if (nome) nome.textContent = c.nome;
    const onde = byId('chat-onde');
    if (onde) onde.textContent = c.onde;
    body.replaceChildren();
    resEl.hidden = true;
    resEl.replaceChildren();
    pick.hidden = true;
    chat.classList.add('open');
    chat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    proxima();
  };

  const proxima = () => {
    if (!estado) return;
    const c = CONVERSAS[estado.id];
    const f = c.falas[estado.i];
    if (!f) return;
    barra.style.width = `${(estado.i / c.falas.length) * 100}%`;
    opcoesEl.replaceChildren();
    opcoesEl.hidden = true;
    const t = el('div', 'typing', el('i'), el('i'), el('i'));
    body.append(t);
    rolar();
    setTimeout(() => {
      t.remove();
      botFala(f.en, f.pt);
      opcoesEl.hidden = false;
      opcoesEl.append(el('p', '', 'Sua resposta'));
      for (const o of f.opcoes) {
        const b = el('button', 'opcao', o.t);
        b.type = 'button';
        b.lang = 'en';
        b.addEventListener('click', () => responder(o));
        opcoesEl.append(b);
      }
    }, 650);
  };

  const responder = (o: Opcao) => {
    if (!estado) return;
    opcoesEl.replaceChildren();
    opcoesEl.hidden = true;
    add('user', o.t);
    add(`fb ${o.tipo}`, el('b', '', ROTULO[o.tipo]), o.fb);
    estado.pontos += PONTOS[o.tipo];
    estado.i++;
    setTimeout(estado.i < CONVERSAS[estado.id].falas.length ? proxima : final, 700);
  };

  const final = () => {
    if (!estado) return;
    const atual = estado;
    const c = CONVERSAS[atual.id];
    barra.style.width = '100%';
    const r = RESULTADOS.find((x) => atual.pontos <= x.ate) ?? RESULTADOS[RESULTADOS.length - 1];
    if (!r) return;
    botFala('Thanks for the chat! See you on Main Street.', 'Obrigado pela conversa! Te vejo na Main Street.');
    const outro: Personagem = atual.id === 'margaret' ? 'robert' : 'margaret';
    const cta = el('a', 'btn btn-cta', CTA_EPISODIO);
    cta.href = '#cadastro';
    const trocar = el('button', 'btn btn-ghost', `Conversar com ${outro === 'robert' ? 'o Robert' : 'a Maggie'}`);
    trocar.type = 'button';
    trocar.addEventListener('click', () => iniciar(outro));
    resEl.replaceChildren(
      el('p', 'eyebrow', 'Seu ponto de partida estimado'),
      el('div', 'nivel', r.nivel),
      el('h3', 'mt8', r.titulo),
      el('p', '', r.texto),
      el(
        'p',
        'small muted',
        `Você fez ${atual.pontos} de ${MAX_PONTOS} pontos com ${c.apelido}. ` +
          'Estimativa com base em 7 respostas prontas, não é teste de proficiência.',
      ),
      el('div', 'acoes', cta, trocar),
    );
    resEl.hidden = false;
  };

  for (const b of pick.querySelectorAll<HTMLElement>('[data-personagem]')) {
    const id = b.dataset.personagem;
    if (id === 'margaret' || id === 'robert') b.addEventListener('click', () => iniciar(id));
  }
  byId('chat-trocar')?.addEventListener('click', () => {
    chat.classList.remove('open');
    pick.hidden = false;
  });
  byId<HTMLInputElement>('legenda')?.addEventListener('change', (e) => {
    chat.classList.toggle('sem-legenda', !(e.currentTarget as HTMLInputElement).checked);
  });
}

/* ---------- Sign-up: hands the fields over to the app's sign-up ---------- */

/** Age from dd/mm/aaaa, or null when it is not a real past date. */
function idade(str: string, hoje = new Date()): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const a = Number(m[3]);
  const dt = new Date(a, mes - 1, d);
  if (dt.getDate() !== d || dt.getMonth() !== mes - 1 || a < 1900 || dt > hoje) return null;
  let anos = hoje.getFullYear() - a;
  if (hoje.getMonth() < mes - 1 || (hoje.getMonth() === mes - 1 && hoje.getDate() < d)) anos--;
  return anos;
}

/** dd/mm/aaaa → YYYY-MM-DD (the app's date input). */
const isoDe = (br: string) => br.split('/').reverse().join('-');

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

const form = byId<HTMLFormElement>('form-cadastro');
const nasc = byId<HTMLInputElement>('f-nasc');

nasc?.addEventListener('input', () => {
  let v = nasc.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
  else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
  nasc.value = v;
});

function marcar(input: HTMLInputElement, ok: boolean): boolean {
  input.closest('.campo')?.classList.toggle('invalido', !ok);
  input.setAttribute('aria-invalid', String(!ok));
  return ok;
}

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const campo = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const nome = campo('nome');
  const apelido = campo('apelido');
  const nascimento = campo('nascimento');
  const email = campo('email');
  const aceite = campo('aceite');

  let ok = true;
  ok = marcar(nome, nome.value.trim().split(/\s+/).length >= 2) && ok;
  ok = marcar(apelido, apelido.value.trim().length >= 2) && ok;
  // The app accepts ages 5 to 110 (cadastro/onb.ts accountErrors).
  const anos = idade(nascimento.value);
  ok = marcar(nascimento, anos !== null && anos >= 5 && anos <= 110) && ok;
  ok = marcar(email, emailOk(email.value.trim())) && ok;
  byId('check-termos')?.classList.toggle('invalido', !aceite.checked);
  ok = aceite.checked && ok;
  if (!ok) {
    form.querySelector<HTMLInputElement>('.invalido input')?.focus();
    return;
  }

  writeSignupHandoff({
    fullName: nome.value.trim().replace(/\s+/g, ' '),
    name: apelido.value.trim(),
    birth: isoDe(nascimento.value),
    email: email.value.trim(),
  });
  const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (btn) btn.disabled = true;
  location.assign(`${APP_BASE}#/cadastro/1`);
});

// Back from the app's sign-up (bfcache): the button works again.
window.addEventListener('pageshow', () => {
  const btn = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (btn) btn.disabled = false;
});
