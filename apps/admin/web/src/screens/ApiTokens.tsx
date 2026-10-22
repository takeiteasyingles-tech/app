// Configurações → Integrações (spec 07, feature D): API tokens for AI agents (Claude) that edit
// content through the MCP endpoint, and how to connect Claude Code / Claude Desktop. A token is shown
// once, right after it is created; the list keeps only its first characters. Agents read, edit and
// draft, never publish: humans publish in Publicações.
import {
  API_TOKEN_SCOPES,
  type ApiTokenRow,
  type ApiTokenScope,
  adminApiTokensApi,
} from '@tie/shared/contracts/apiTokens';
import { MCP_PATH } from '@tie/shared/contracts/mcp';
import { useState } from 'preact/hooks';
import { call, errorMessage } from '../api';
import { fmtAgo, fmtDate, fmtDateTime } from '../format';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Async, Button, Card, CopyButton, Empty, Field, Pill, Sel, Switch, TextIn } from '../ui/kit';
import { confirmAction } from '../ui/modal';
import { type Col, Table } from '../ui/table';
import { toast } from '../ui/toast';

const SCOPE_INFO: Record<ApiTokenScope, [string, string]> = {
  'content.read': ['Ler conteúdo', 'Temporadas, episódios, e-books, questões do teste e a prévia da publicação.'],
  'content.edit': ['Editar e rascunhar', 'Muda episódios, e-books e temporadas; cria questões do teste como rascunho.'],
};

const EXPIRY: readonly (readonly [string, string])[] = [
  ['30', '30 dias'],
  ['90', '90 dias (recomendado)'],
  ['180', '180 dias'],
  ['365', '1 ano'],
  ['never', 'Sem validade'],
];

const SERVER_NAME = 'take-it-easy';

function endpointUrl(): string {
  return `${typeof location === 'undefined' ? '' : location.origin}${MCP_PATH}`;
}

type TokenState = 'active' | 'revoked' | 'expired';
const stateOf = (t: ApiTokenRow, now = Date.now()): TokenState =>
  t.revokedAt !== null ? 'revoked' : t.expiresAt !== null && t.expiresAt <= now ? 'expired' : 'active';

function StatePill({ t }: { t: ApiTokenRow }) {
  const s = stateOf(t);
  if (s === 'revoked') return <Pill label="Revogado" tone="" icon="lock" />;
  if (s === 'expired') return <Pill label="Expirado" tone="gold" />;
  return <Pill label="Ativo" tone="gr" icon="check" />;
}

// ---------- Create ----------

function CreateForm({ onCreated }: { onCreated: (item: ApiTokenRow, token: string) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Record<ApiTokenScope, boolean>>({ 'content.read': true, 'content.edit': true });
  const [expiry, setExpiry] = useState('90');
  const [busy, setBusy] = useState(false);
  const chosen = API_TOKEN_SCOPES.filter((s) => scopes[s]);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim() || !chosen.length || busy) return;
    setBusy(true);
    try {
      const res = await call(adminApiTokensApi.create, {
        body: {
          name: name.trim(),
          scopes: chosen,
          expiresInDays: expiry === 'never' ? null : Number(expiry),
        },
      });
      onCreated(res.item, res.token);
      setName('');
      toast('Token criado. Copie agora: ele não aparece de novo.');
    } catch (err) {
      toast(errorMessage(err), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Novo token"
      sub="Cada pessoa ou computador com o seu token: assim dá para revogar um sem afetar os outros."
    >
      <form class="stack" style={{ '--gap': '12px' }} onSubmit={submit} noValidate>
        <div class="ad-grid">
          <Field id="tok-name" label="Nome" hint="Para reconhecer depois. Ex.: Claude Code da Ana.">
            <TextIn id="tok-name" value={name} onValue={setName} maxLength={80} placeholder="Claude Code" />
          </Field>
          <Field id="tok-exp" label="Validade">
            <Sel id="tok-exp" value={expiry} onValue={setExpiry} options={EXPIRY} />
          </Field>
        </div>
        <fieldset class="stack" style={{ '--gap': '10px', border: '0', padding: '0', margin: '0', minWidth: '0' }}>
          <legend class="lbl">Permissões</legend>
          {API_TOKEN_SCOPES.map((s) => {
            const [label, hint] = SCOPE_INFO[s];
            return (
              <div key={s} class="ad-flag">
                <Switch
                  id={`tok-scope-${s}`}
                  on={scopes[s]}
                  label={label}
                  onChange={(v) => setScopes((p) => ({ ...p, [s]: v }))}
                />
                <label for={`tok-scope-${s}`} class="ad-flag-t">
                  <span class="ad-bool-l">{label}</span>
                  <span class="sm">{hint}</span>
                  <span class="xs ad-mono">{s}</span>
                </label>
              </div>
            );
          })}
        </fieldset>
        <div class="ad-note bl">
          <Icon name="rocket" size={18} /> Nenhum token publica: o agente edita o rascunho e alguém da equipe publica em
          Publicações. Toda mudança fica na Auditoria como "agent".
        </div>
        <div class="row" style={{ '--gap': '8px' }}>
          <Button label="Criar token" icon="key" type="submit" busy={busy} disabled={!name.trim() || !chosen.length} />
          {!chosen.length ? <span class="xs">Escolha pelo menos uma permissão.</span> : null}
        </div>
      </form>
    </Card>
  );
}

function NewToken({ item, token, onDone }: { item: ApiTokenRow; token: string; onDone: () => void }) {
  return (
    <div class="card gr stack" style={{ '--gap': '10px' }} role="status">
      <div class="lbl gr">Token "{item.name}" criado</div>
      <code class="ad-code ad-break">{token}</code>
      <div class="row wrapx between" style={{ '--gap': '8px' }}>
        <span class="xs">
          Copie e guarde agora (num gerenciador de senhas): depois desta tela ele não aparece de novo.
          {item.expiresAt ? ` Vale até ${fmtDate(item.expiresAt)}.` : ' Sem validade.'}
        </span>
        <div class="row" style={{ '--gap': '8px' }}>
          <CopyButton text={token} label="Copiar token" />
          <Button label="Já guardei" kind="light" onClick={onDone} />
        </div>
      </div>
    </div>
  );
}

// ---------- How to connect ----------

function Snippet({ title, text }: { title: string; text: string }) {
  return (
    <div class="stack" style={{ '--gap': '6px' }}>
      <div class="row between wrapx" style={{ '--gap': '8px' }}>
        <span class="lbl">{title}</span>
        <CopyButton text={text} />
      </div>
      <pre class="ad-json">{text}</pre>
    </div>
  );
}

function HowToConnect({ token }: { token: string | null }) {
  const url = endpointUrl();
  const t = token ?? '<token>';
  const code = `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: Bearer ${t}"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        [SERVER_NAME]: {
          command: 'npx',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: mcp-remote expands ${TIE_TOKEN} from `env` itself.
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${TIE_TOKEN}'],
          env: { TIE_TOKEN: `Bearer ${t}` },
        },
      },
    },
    null,
    2,
  );
  return (
    <Card
      title="Como conectar o Claude"
      sub="O Claude conversa com o painel pelo MCP (Model Context Protocol), usando um token desta página."
    >
      <div class="stack" style={{ '--gap': '14px' }}>
        <p class="sm">
          <b>Claude Code</b>: rode no terminal (troque <code class="ad-mono">&lt;token&gt;</code> pelo token criado
          acima). Depois, dentro do Claude Code, <code class="ad-mono">/mcp</code> mostra a conexão.
        </p>
        <Snippet title="Claude Code" text={code} />
        <p class="sm">
          <b>Claude Desktop</b>: em Configurações → Desenvolvedor → Editar configuração, junte isto ao arquivo{' '}
          <code class="ad-mono">claude_desktop_config.json</code> e reinicie o app (precisa do Node.js instalado).
        </p>
        <Snippet title="claude_desktop_config.json" text={desktop} />
        <p class="xs">
          Endereço do servidor: <code class="ad-mono ad-break">{url}</code>. Peça, por exemplo: "liste os episódios da
          temporada 1", "melhore a sinopse do episódio 3", "rascunhe 10 questões para o teste da temporada 1". O token é
          uma senha: não cole em conversas, e-mails ou repositórios.
        </p>
      </div>
    </Card>
  );
}

// ---------- List ----------

export function ApiTokens() {
  const load = useLoad((signal) => call(adminApiTokensApi.list, { signal }), []);
  const [created, setCreated] = useState<{ item: ApiTokenRow; token: string } | null>(null);
  const put = (item: ApiTokenRow) =>
    load.setData((p) => ({ items: [item, ...(p?.items ?? []).filter((x) => x.id !== item.id)] }));
  const revoke = (t: ApiTokenRow) => {
    void confirmAction({
      title: `Revogar o token "${t.name}"?`,
      body: 'O agente que usa este token perde o acesso na hora. Não dá para desfazer: crie outro se precisar.',
      confirm: 'Revogar',
      danger: true,
      run: async () => {
        const res = await call(adminApiTokensApi.revoke, { params: { id: t.id } });
        load.setData((p) => ({ items: (p?.items ?? []).map((x) => (x.id === t.id ? res.item : x)) }));
      },
    }).then((ok) => {
      if (ok) toast('Token revogado.');
    });
  };
  const cols: Col<ApiTokenRow>[] = [
    {
      key: 'name',
      label: 'Token',
      cell: (t) => (
        <span class="ad-cell2">
          <span>{t.name}</span>
          <span class="xs ad-mono">{t.prefix}…</span>
        </span>
      ),
    },
    { key: 'state', label: 'Situação', cell: (t) => <StatePill t={t} /> },
    {
      key: 'scopes',
      label: 'Permissões',
      cell: (t) => (
        <span class="row wrapx" style={{ '--gap': '4px' }}>
          {t.scopes.map((s) => (
            <Pill key={s} label={SCOPE_INFO[s][0]} tone={s === 'content.edit' ? 'navy' : ''} />
          ))}
        </span>
      ),
    },
    {
      key: 'used',
      label: 'Último uso',
      cell: (t) => <span title={fmtDateTime(t.lastUsedAt)}>{t.lastUsedAt ? fmtAgo(t.lastUsedAt) : 'Nunca'}</span>,
    },
    {
      key: 'exp',
      label: 'Validade',
      cell: (t) =>
        t.revokedAt ? `Revogado ${fmtAgo(t.revokedAt)}` : t.expiresAt ? fmtDate(t.expiresAt) : 'Sem validade',
    },
    {
      key: 'by',
      label: 'Criado por',
      desktopOnly: true,
      cell: (t) => (
        <span class="ad-cell2" title={fmtDateTime(t.createdAt)}>
          <span class="ad-ell">{t.createdByEmail ?? '—'}</span>
          <span class="xs">{fmtAgo(t.createdAt)}</span>
        </span>
      ),
    },
    {
      key: 'act',
      label: 'Ações',
      cls: 'shrink',
      cell: (t) =>
        stateOf(t) === 'active' ? (
          <Button label="Revogar" icon="trash" kind="ad-danger-l" onClick={() => revoke(t)} />
        ) : (
          <span class="xs">—</span>
        ),
    },
  ];
  return (
    <>
      {created ? <NewToken item={created.item} token={created.token} onDone={() => setCreated(null)} /> : null}
      <CreateForm
        onCreated={(item, token) => {
          put(item);
          setCreated({ item, token });
        }}
      />
      <Card title="Tokens de API" sub="Agentes que podem ler e editar o conteúdo pelo MCP.">
        <Async load={load} rows={3}>
          {(d) =>
            d.items.length ? (
              <Table rows={d.items} cols={cols} rowKey={(t) => t.id} caption="Tokens de API" />
            ) : (
              <Empty icon="key" title="Nenhum token ainda." body="Crie um acima para conectar o Claude." />
            )
          }
        </Async>
      </Card>
      <HowToConnect token={created?.token ?? null} />
    </>
  );
}
