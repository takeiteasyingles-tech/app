// Configurações (admin): feature flags (on/off, gradual rollout, allowlists), the app settings the
// Worker reads (retention, terms version, Workers AI model ids, the student app origin) and the AI
// prompt templates (versioned: a save over a newer edit is refused).
import { FLAGS, SETTINGS } from '@tie/shared/constants';
import { adminAiApi, adminOpsApi, type AppSetting, type FeatureFlag, type PromptRow } from '@tie/shared/contracts/admin';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage, isCode } from '../api';
import { fmtAgo, fmtDateTime } from '../format';
import { useEmails } from '../people';
import { setQuery } from '../router';
import { can } from '../session';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Area, Async, Button, Card, Empty, Field, Page, Pill, Sel, Switch, TextIn } from '../ui/kit';
import { Modal } from '../ui/modal';
import { toast } from '../ui/toast';
import type { ScreenProps } from './registry';

const FLAG_INFO: Record<string, string> = {
  [FLAGS.aiEnabled]: 'IA ligada: conversa, pronúncia e voz pelo Workers AI. Desligada, o app usa o modo demo.',
  [FLAGS.freeSteps]: 'Etapas livres: pula a trava entre as etapas do episódio (testes).',
  [FLAGS.storeRecordings]: 'Guardar as gravações do Mic (para moderação).',
};

const SETTING_INFO: readonly (readonly [string, string, string])[] = [
  [SETTINGS.retentionTranscriptsDays, 'Dias que as conversas do Mic ficam guardadas', 'Entre 1 e 3650. Padrão: 180.'],
  [SETTINGS.termsVersion, 'Versão dos termos de uso', 'Ex.: 2026-10. Quem aceitou outra versão aceita de novo.'],
  ['app.origin', 'Endereço do app dos alunos', 'Usado nos links de nova senha (https://…, sem barra no fim).'],
  [SETTINGS.modelTutor, 'Modelo da conversa', 'Id do Workers AI (@cf/…).'],
  [SETTINGS.modelTutorFallback, 'Modelo reserva da conversa', 'Usado quando o principal falha.'],
  [SETTINGS.modelAsr, 'Modelo de transcrição', 'Whisper.'],
  [SETTINGS.modelTts, 'Modelo de voz', 'Deepgram Aura.'],
  [SETTINGS.modelGuard, 'Modelo de segurança', 'Llama Guard.'],
];

const PROMPT_INFO: Record<string, string> = {
  tutor_system: 'Instruções da conversa (todas as assistentes)',
  report_system: 'Instruções do relatório no fim da conversa',
};

// ---------- Flags ----------

function RulesModal({ flag, onClose, onSaved }: { flag: FeatureFlag; onClose: () => void; onSaved: (f: FeatureFlag) => void }) {
  const r = (flag.rules ?? {}) as { users?: string[]; plans?: string[]; roles?: string[] };
  const [users, setUsers] = useState((r.users ?? []).join('\n'));
  const [plans, setPlans] = useState((r.plans ?? []).join('\n'));
  const [roles, setRoles] = useState((r.roles ?? []).join('\n'));
  const [pct, setPct] = useState(String(flag.rolloutPct));
  const [busy, setBusy] = useState(false);
  const lines = (s: string) =>
    s
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  const save = async () => {
    setBusy(true);
    try {
      const rules = { users: lines(users), plans: lines(plans), roles: lines(roles) };
      const empty = !rules.users.length && !rules.plans.length && !rules.roles.length;
      const res = await call(adminOpsApi.setFlag, {
        params: { key: flag.key },
        body: { enabled: flag.enabled, rolloutPct: Math.max(0, Math.min(100, Number.parseInt(pct || '0', 10))), rules: empty ? null : rules },
      });
      onSaved(res.item);
      toast('Flag salva.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Regras de ${flag.key}`}
      onClose={onClose}
      locked={busy}
      foot={
        <>
          <Button label="Cancelar" kind="light" onClick={onClose} />
          <Button label="Salvar" icon="check" busy={busy} onClick={() => void save()} />
        </>
      }
    >
      <Field id="fl-pct" label="Liberação gradual (%)" hint="Percentual de alunos que recebem a flag ligada. As listas abaixo recebem sempre.">
        <TextIn id="fl-pct" type="number" min={0} max={100} value={pct} onValue={setPct} />
      </Field>
      <Field id="fl-users" label="Ids de usuários" opt hint="Um por linha.">
        <Area id="fl-users" value={users} onValue={setUsers} rows={3} mono />
      </Field>
      <Field id="fl-plans" label="Planos (slug)" opt>
        <Area id="fl-plans" value={plans} onValue={setPlans} rows={2} mono />
      </Field>
      <Field id="fl-roles" label="Papéis" opt hint="super_admin, admin, editor, moderator.">
        <Area id="fl-roles" value={roles} onValue={setRoles} rows={2} mono />
      </Field>
    </Modal>
  );
}

function Flags() {
  const load = useLoad((signal) => call(adminOpsApi.flags, { signal }), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [rules, setRules] = useState<FeatureFlag | null>(null);
  const [newKey, setNewKey] = useState('');
  const email = useEmails(load.data?.items.map((f) => f.updatedBy) ?? []);
  const put = (f: FeatureFlag) => load.setData((p) => ({ items: [...(p?.items ?? []).filter((x) => x.key !== f.key), f].sort((a, b) => a.key.localeCompare(b.key)) }));
  const toggle = async (key: string, enabled: boolean) => {
    setBusy(key);
    try {
      put((await call(adminOpsApi.setFlag, { params: { key }, body: { enabled } })).item);
      toast(enabled ? `${key} ligada.` : `${key} desligada.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(null);
    }
  };
  const known = Object.values(FLAGS) as string[];
  return (
    <Card title="Flags" sub="Mudam o comportamento do app sem nova versão. Cada isolate do Worker vê a mudança em até 30 s.">
      <Async load={load}>
        {(d) => {
          const keys = [...new Set([...known, ...d.items.map((f) => f.key)])];
          return (
            <ul class="ad-feed">
              {keys.map((key) => {
                const f = d.items.find((x) => x.key === key);
                const r = (f?.rules ?? null) as { users?: string[]; plans?: string[]; roles?: string[] } | null;
                const nRules = (r?.users?.length ?? 0) + (r?.plans?.length ?? 0) + (r?.roles?.length ?? 0);
                return (
                  <li key={key} style={{ alignItems: 'center' }}>
                    <Switch id={`flag-${key}`} on={!!f?.enabled} label={key} disabled={busy === key} onChange={(v) => void toggle(key, v)} />
                    <label for={`flag-${key}`} class="grow" style={{ minWidth: '0', cursor: 'pointer' }}>
                      <span class="ad-bool-l ad-mono">{key}</span>
                      <span class="xs" style={{ display: 'block' }}>
                        {FLAG_INFO[key] ?? 'Flag personalizada.'}
                        {f ? ` · ${f.rolloutPct}% dos alunos${nRules ? ` + ${nRules} na lista` : ''} · ${fmtAgo(f.updatedAt)}${f.updatedBy ? ` por ${email(f.updatedBy) ?? 'alguém'}` : ''}` : ' · ainda não criada (desligada)'}
                      </span>
                    </label>
                    {f ? <Button label="Regras" icon="sliders" kind="light" onClick={() => setRules(f)} /> : null}
                  </li>
                );
              })}
            </ul>
          );
        }}
      </Async>
      <form
        class="row wrapx"
        style={{ '--gap': '8px' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[a-z][a-z0-9_.-]{0,79}$/.test(newKey)) {
            void toggle(newKey, false);
            setNewKey('');
          }
        }}
      >
        <TextIn id="flag-new" class="ad-mono" value={newKey} onValue={(v) => setNewKey(v.toLowerCase())} placeholder="nova.flag" aria-label="Chave da nova flag" style={{ maxWidth: '280px' }} />
        <Button label="Criar flag (desligada)" icon="plus" kind="light" type="submit" disabled={!/^[a-z][a-z0-9_.-]{0,79}$/.test(newKey)} />
      </form>
      {rules ? (
        <RulesModal
          flag={rules}
          onClose={() => setRules(null)}
          onSaved={(f) => {
            put(f);
            setRules(null);
          }}
        />
      ) : null}
    </Card>
  );
}

// ---------- Settings ----------

function SettingRow({ k, label, hint, s, onSaved }: { k: string; label: string; hint: string; s?: AppSetting; onSaved: (s: AppSetting) => void }) {
  const [v, setV] = useState(s?.value ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(s?.value ?? ''), [s?.value]);
  const id = `set-${k.replace(/\W/g, '-')}`;
  const save = async () => {
    setBusy(true);
    try {
      onSaved((await call(adminOpsApi.setSetting, { params: { key: k }, body: { value: v.trim() } })).item);
      toast('Configuração salva.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      class="ad-grid"
      style={{ alignItems: 'end' }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field id={id} label={label} hint={`${hint}${s ? ` · mudou ${fmtAgo(s.updatedAt)}` : ' · usando o padrão'}`}>
        <TextIn id={id} class="ad-mono" value={v} onValue={setV} placeholder="(padrão)" />
      </Field>
      <div class="row" style={{ '--gap': '8px', paddingBottom: '22px' }}>
        <Button label="Salvar" icon="check" kind="light" type="submit" busy={busy} disabled={!v.trim() || v.trim() === (s?.value ?? '')} />
        <span class="xs ad-mono">{k}</span>
      </div>
    </form>
  );
}

function AppSettings() {
  const load = useLoad((signal) => call(adminOpsApi.settings, { signal }), []);
  const current = load.data?.items.find((s) => s.key === SETTINGS.contentCurrent);
  return (
    <Card title="Configurações do app" sub="Valores que o Worker lê a cada pedido. Vazio = o padrão do código.">
      {current ? (
        <div class="ad-note bl">
          <Icon name="rocket" size={18} /> Versão publicada: <code class="ad-mono">{current.value.slice(0, 12)}</code> desde {fmtDateTime(current.updatedAt)}. Ela só muda por Publicações.
        </div>
      ) : null}
      <Async load={load}>
        {(d) => (
          <div class="stack" style={{ '--gap': '6px' }}>
            {SETTING_INFO.map(([k, label, hint]) => (
              <SettingRow
                key={k}
                k={k}
                label={label}
                hint={hint}
                s={d.items.find((x) => x.key === k)}
                onSaved={(s) => load.setData((p) => ({ items: [...(p?.items ?? []).filter((x) => x.key !== s.key), s] }))}
              />
            ))}
          </div>
        )}
      </Async>
    </Card>
  );
}

// ---------- Prompts ----------

function Prompts() {
  const load = useLoad((signal) => call(adminAiApi.prompts, { signal }), []);
  const [sel, setSel] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const email = useEmails(load.data?.items.map((p) => p.updatedBy) ?? []);
  const items = load.data?.items ?? [];
  const cur: PromptRow | undefined = items.find((p) => p.key === sel) ?? items[0];
  useEffect(() => {
    if (cur) {
      setSel(cur.key);
      setText(cur.template);
    }
  }, [cur?.key, cur?.version]);
  const save = async () => {
    if (!cur) return;
    setBusy(true);
    try {
      const res = await call(adminAiApi.setPrompt, { params: { key: cur.key }, body: { template: text, expectedVersion: cur.version } });
      load.setData((p) => ({ items: (p?.items ?? []).map((x) => (x.key === res.item.key ? res.item : x)) }));
      toast(`Prompt salvo (versão ${res.item.version}).`);
    } catch (e) {
      toast(isCode(e, 'conflict') ? 'Alguém salvou este prompt antes. Recarregue para ver a versão nova.' : errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Prompts da IA" sub="Modelos das instruções. Valem na hora para as próximas chamadas.">
      <Async load={load}>
        {() =>
          !cur ? (
            <Empty icon="chat" title="Nenhum prompt." />
          ) : (
            <>
              <div class="row wrapx" style={{ '--gap': '10px' }}>
                <Sel ariaLabel="Prompt" value={cur.key} onValue={setSel} options={items.map((p) => [p.key, PROMPT_INFO[p.key] ?? p.key] as const)} cls="ad-grow" />
                <Pill label={`versão ${cur.version}`} tone="navy" />
                <span class="xs">
                  {fmtAgo(cur.updatedAt)}
                  {cur.updatedBy ? ` por ${email(cur.updatedBy) ?? 'alguém'}` : ''}
                </span>
              </div>
              <Field id="prompt-t" label="Modelo" hint={`${text.length} caracteres. As variáveis entre chaves são preenchidas pelo servidor.`}>
                <Area id="prompt-t" value={text} onValue={setText} rows={16} mono maxLength={20000} />
              </Field>
              <div class="row" style={{ '--gap': '8px' }}>
                <Button label="Salvar nova versão" icon="check" busy={busy} disabled={text === cur.template || !text.trim()} onClick={() => void save()} />
                <Button label="Descartar" kind="light" disabled={text === cur.template || busy} onClick={() => setText(cur.template)} />
                <Button label="Recarregar" kind="link" onClick={load.reload} />
              </div>
            </>
          )
        }
      </Async>
    </Card>
  );
}

export function Settings({ q }: ScreenProps) {
  const tabs = [
    ...(can('flags.manage') ? ([['flags', 'Flags']] as const) : []),
    ...(can('settings.manage') ? ([['app', 'Configurações']] as const) : []),
    ...(can('ai.prompts') ? ([['prompts', 'Prompts da IA']] as const) : []),
  ];
  const tab = tabs.some(([t]) => t === q.aba) ? (q.aba as string) : (tabs[0]?.[0] ?? 'flags');
  return (
    <Page
      title="Configurações"
      kicker="Operação"
      width={980}
      bar={
        tabs.length > 1 ? (
          <nav class="ad-tabs" aria-label="Partes">
            {tabs.map(([t, l]) => (
              <a
                key={t}
                href="#/config"
                class={`ad-tab${t === tab ? ' on' : ''}`}
                aria-current={t === tab ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setQuery({ aba: t });
                }}
              >
                {l}
              </a>
            ))}
          </nav>
        ) : undefined
      }
    >
      {tab === 'flags' ? <Flags /> : tab === 'app' ? <AppSettings /> : <Prompts />}
    </Page>
  );
}
