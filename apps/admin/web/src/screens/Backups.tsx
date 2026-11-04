// Operação → Backup (permission backups.manage): make a backup now, set the automatic schedule, and
// download, restore or delete the stored ones. A restore puts the course content back in the draft
// (a content backup of the current state is taken first) and learners only see it after a publish.
import {
  adminBackupsApi,
  type BackupConfig,
  type BackupKind,
  type BackupRow,
  type BackupScope,
  type RestoreResult,
} from '@tie/shared/contracts/backups';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage, urlFor } from '../api';
import { fmtAgo, fmtBytes, fmtDateTime, fmtInt, plural } from '../format';
import { useEmails } from '../people';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Async, Button, Card, Empty, Facts, Field, Page, Pill, Seg, Sel, Switch, TextIn } from '../ui/kit';
import { confirmAction } from '../ui/modal';
import { type Col, Table } from '../ui/table';
import { toast } from '../ui/toast';
import type { ScreenProps } from './registry';

const SCOPE_OPTS: readonly (readonly [BackupScope, string])[] = [
  ['full', 'Completo'],
  ['content', 'Só o conteúdo'],
];

const SCOPE_HINT: Record<BackupScope, string> = {
  full: 'Banco inteiro: conteúdo, alunos, progresso, pontos, configurações e auditoria (sem sessões ativas).',
  content: 'Só o curso: temporadas, episódios, exercícios, e-books, testes, Extras, Mic, assistentes e cadastro.',
};

const KIND: Record<BackupKind, [string, string]> = {
  manual: ['Manual', 'navy'],
  auto: ['Automático', ''],
  pre_restore: ['Antes de restaurar', 'gold'],
  agent: ['Agente de IA', 'navy'],
};

const FREQ: readonly (readonly [BackupConfig['frequency'], string])[] = [
  ['daily', 'Todo dia'],
  ['weekly', 'Toda semana'],
  ['off', 'Desligado'],
];

const HOURS: readonly (readonly [string, string])[] = Array.from({ length: 24 }, (_, h) => [
  String(h),
  `${String(h).padStart(2, '0')}:00`,
]);

const WEEKDAYS: readonly (readonly [string, string])[] = [
  ['0', 'Domingo'],
  ['1', 'Segunda-feira'],
  ['2', 'Terça-feira'],
  ['3', 'Quarta-feira'],
  ['4', 'Quinta-feira'],
  ['5', 'Sexta-feira'],
  ['6', 'Sábado'],
];

const KEEP: readonly (readonly [string, string])[] = [
  ['7', 'Os 7 mais recentes'],
  ['14', 'Os 14 mais recentes'],
  ['30', 'Os 30 mais recentes'],
  ['60', 'Os 60 mais recentes'],
  ['90', 'Os 90 mais recentes'],
];

const TABLE_LABEL: Record<string, string> = {
  seasons: 'temporadas',
  episodes: 'episódios',
  mic_phrases: 'frases do Mic',
  exercises: 'exercícios',
  exercise_items: 'questões de exercício',
  ebooks: 'e-books',
  ebook_test_questions: 'questões de teste',
  extras: 'Extras',
  albums: 'álbuns',
  album_tracks: 'faixas',
  assistants: 'assistentes',
  mic_missions: 'missões do Mic',
  season_test_questions: 'questões do teste da temporada',
};

// ---------- Make one now ----------

function CreateCard({ onCreated }: { onCreated: () => void }) {
  const [scope, setScope] = useState<BackupScope>('full');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await call(adminBackupsApi.create, { body: { scope, note: note.trim() || undefined } });
      toast(`Backup feito: ${plural(res.item.rows, 'linha', 'linhas')}, ${fmtBytes(res.item.sizeBytes)}.`);
      setNote('');
      onCreated();
    } catch (err) {
      toast(errorMessage(err), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Fazer um backup agora"
      sub="Guarda uma cópia do banco de dados que dá para baixar ou restaurar depois."
    >
      <div class="stack" style={{ '--gap': '12px' }}>
        <div class="stack" style={{ '--gap': '6px' }}>
          <span class="lbl">O que guardar</span>
          <Seg value={scope} options={SCOPE_OPTS} onChange={setScope} label="O que guardar" />
          <span class="xs">{SCOPE_HINT[scope]}</span>
        </div>
        <Field id="bk-note" label="Nota" opt hint="Ex.: “Antes de reescrever a temporada 2”.">
          <TextIn id="bk-note" value={note} onValue={setNote} maxLength={200} />
        </Field>
        <div>
          <Button label="Fazer backup agora" icon="database" busy={busy} onClick={() => void run()} />
        </div>
      </div>
    </Card>
  );
}

// ---------- Schedule ----------

function ScheduleCard({
  config,
  nextAutoAt,
  onSaved,
}: {
  config: BackupConfig;
  nextAutoAt: number | null;
  onSaved: () => void;
}) {
  const [c, setC] = useState<BackupConfig>(config);
  const [busy, setBusy] = useState(false);
  useEffect(() => setC(config), [config]);
  const dirty = JSON.stringify(c) !== JSON.stringify(config);
  const set = <K extends keyof BackupConfig>(k: K, v: BackupConfig[K]) => setC((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      await call(adminBackupsApi.config, { body: c });
      toast('Agendamento salvo.');
      onSaved();
    } catch (err) {
      toast(errorMessage(err), 'err');
    } finally {
      setBusy(false);
    }
  };
  const off = c.frequency === 'off';
  return (
    <Card
      title="Backup automático"
      sub="O painel faz o backup sozinho no horário escolhido (horário de Brasília) e apaga os automáticos mais antigos."
    >
      <div class="stack" style={{ '--gap': '12px' }}>
        <div class="ad-grid">
          <Field id="bk-freq" label="Frequência">
            <Sel
              id="bk-freq"
              value={c.frequency}
              onValue={(v) => set('frequency', v as BackupConfig['frequency'])}
              options={FREQ}
            />
          </Field>
          {!off ? (
            <Field id="bk-hour" label="Horário">
              <Sel id="bk-hour" value={String(c.hour)} onValue={(v) => set('hour', Number(v))} options={HOURS} />
            </Field>
          ) : null}
          {c.frequency === 'weekly' ? (
            <Field id="bk-day" label="Dia da semana">
              <Sel
                id="bk-day"
                value={String(c.weekday)}
                onValue={(v) => set('weekday', Number(v))}
                options={WEEKDAYS}
              />
            </Field>
          ) : null}
          {!off ? (
            <Field id="bk-keep" label="Guardar">
              <Sel
                id="bk-keep"
                value={String(c.keep)}
                onValue={(v) => set('keep', Number(v))}
                options={
                  KEEP.some(([v]) => v === String(c.keep))
                    ? KEEP
                    : [[String(c.keep), `Os ${c.keep} mais recentes`], ...KEEP]
                }
              />
            </Field>
          ) : null}
        </div>
        {!off ? (
          <div class="stack" style={{ '--gap': '6px' }}>
            <span class="lbl">O que guardar</span>
            <Seg
              value={c.scope}
              options={SCOPE_OPTS}
              onChange={(v) => set('scope', v)}
              label="O que guardar no automático"
            />
            <span class="xs">{SCOPE_HINT[c.scope]}</span>
          </div>
        ) : null}
        <div class="row wrapx between" style={{ '--gap': '8px' }}>
          <span class="xs">
            {config.frequency === 'off'
              ? 'O backup automático está desligado.'
              : nextAutoAt
                ? `Próximo backup automático: ${fmtDateTime(nextAutoAt)}.`
                : ''}
          </span>
          <Button label="Salvar agendamento" icon="check" busy={busy} disabled={!dirty} onClick={() => void save()} />
        </div>
      </div>
    </Card>
  );
}

// ---------- Restore ----------

/** The "remove what was created after the backup" switch inside the confirm dialog. */
function RemoveNewSwitch({ opt }: { opt: { removeNew: boolean } }) {
  const [on, setOn] = useState(opt.removeNew);
  return (
    <div class="ad-flag">
      <Switch
        id="bk-remove-new"
        on={on}
        label="Remover o que foi criado depois do backup"
        onChange={(v) => {
          opt.removeNew = v;
          setOn(v);
        }}
      />
      <label for="bk-remove-new" class="ad-flag-t">
        <span class="ad-bool-l">Remover o que foi criado depois do backup</span>
        <span class="sm">
          Episódios, exercícios e outros itens novos saem do rascunho. Itens que já têm progresso ou respostas de alunos
          ficam.
        </span>
      </label>
    </div>
  );
}

function RestoreDone({ r, onClose }: { r: RestoreResult; onClose: () => void }) {
  return (
    <div class="card gr stack" style={{ '--gap': '10px' }} role="status">
      <div class="lbl gr">Conteúdo restaurado no rascunho</div>
      <Facts
        rows={[
          ['Itens restaurados', `${fmtInt(r.upserted)} em ${plural(r.tables, 'tabela', 'tabelas')}`],
          ['Itens novos removidos', fmtInt(r.removed)],
          [
            'Mantidos (em uso por alunos)',
            r.kept.length ? r.kept.map((k) => `${k.count} ${TABLE_LABEL[k.table] ?? k.table}`).join(', ') : 'nenhum',
          ],
        ]}
      />
      <div class="row wrapx between" style={{ '--gap': '8px' }}>
        <span class="xs">
          Os alunos ainda veem a versão publicada. Confira e publique em <a href="#/publicacoes">Publicações</a>. Para
          desfazer, restaure o backup "Antes de restaurar" que acabou de ser criado.
        </span>
        <Button label="Ok" kind="light" onClick={onClose} />
      </div>
    </div>
  );
}

// ---------- List ----------

function BackupList({
  items,
  onChanged,
  onRestored,
}: {
  items: readonly BackupRow[];
  onChanged: () => void;
  onRestored: (r: RestoreResult) => void;
}) {
  const email = useEmails(items.flatMap((b) => (b.createdBy ? [b.createdBy] : [])));
  const restore = (b: BackupRow) => {
    const opt = { removeNew: true };
    let result: RestoreResult | null = null;
    void confirmAction({
      title: `Restaurar o conteúdo de ${fmtDateTime(b.createdAt)}?`,
      body: (
        <div class="stack" style={{ '--gap': '10px' }}>
          <p class="sm">
            Temporadas, episódios, exercícios, e-books, testes, Extras e o resto do curso voltam a ser como neste
            backup, no rascunho. Alunos, progresso e pontos não mudam. Antes, o painel guarda um backup do conteúdo
            atual.
          </p>
          <RemoveNewSwitch opt={opt} />
        </div>
      ),
      confirm: 'Restaurar conteúdo',
      danger: true,
      typeToConfirm: 'RESTAURAR',
      run: async () => {
        result = (await call(adminBackupsApi.restore, { params: { id: b.id }, body: { removeNew: opt.removeNew } }))
          .result;
      },
    }).then((ok) => {
      if (ok && result) {
        toast('Conteúdo restaurado no rascunho.');
        onRestored(result);
        onChanged();
      }
    });
  };
  const remove = (b: BackupRow) =>
    void confirmAction({
      title: 'Excluir este backup?',
      body: `O backup de ${fmtDateTime(b.createdAt)} e o arquivo dele são apagados de vez.`,
      confirm: 'Excluir backup',
      danger: true,
      run: () => call(adminBackupsApi.remove, { params: { id: b.id } }),
    }).then((ok) => {
      if (ok) {
        toast('Backup excluído.');
        onChanged();
      }
    });
  const cols: Col<BackupRow>[] = [
    {
      key: 'at',
      label: 'Backup',
      cls: 'ad-bk-at',
      cell: (b) => (
        <span class="ad-cell2" title={fmtDateTime(b.createdAt)}>
          <span>{fmtDateTime(b.createdAt)}</span>
          <span class="xs">
            {b.scope === 'full' ? 'Completo' : 'Só o conteúdo'}
            {b.status === 'ok' ? ` · ${fmtBytes(b.sizeBytes)} · ${plural(b.rows, 'linha', 'linhas')}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'kind',
      label: 'Tipo',
      cell: (b) => {
        const [label, tone] = KIND[b.kind];
        return (
          <span class="row wrapx" style={{ '--gap': '6px' }}>
            <Pill label={label} tone={tone} />
            {b.status === 'failed' ? <Pill label="Falhou" tone="red" icon="alert" /> : null}
          </span>
        );
      },
    },
    {
      key: 'note',
      label: 'Nota',
      cls: 'ad-bk-note',
      cell: (b) => {
        const who = b.createdBy ? (email(b.createdBy) ?? 'alguém da equipe') : 'agendamento';
        return (
          <span class="ad-cell2">
            <span>{b.status === 'failed' ? (b.error ?? 'Falhou.') : (b.note ?? '—')}</span>
            <span class="xs">
              por {who}
              {b.restoredAt ? ` · restaurado ${fmtAgo(b.restoredAt)}` : ''}
            </span>
          </span>
        );
      },
    },
    {
      key: 'a',
      label: 'Ações',
      cls: 'shrink',
      cell: (b) => (
        <span class="row" style={{ '--gap': '6px' }}>
          {b.status === 'ok' ? (
            <>
              <a
                class="btn compact light"
                href={urlFor(adminBackupsApi.download, { params: { id: b.id } })}
                download
                title="Baixar o arquivo (.json.gz)"
                aria-label="Baixar backup"
              >
                <Icon name="download" size={16} />
              </a>
              <Button label="Restaurar" icon="history" kind="light" onClick={() => restore(b)} />
            </>
          ) : null}
          <Button ariaLabel="Excluir backup" title="Excluir" icon="trash" kind="ghost" onClick={() => remove(b)} />
        </span>
      ),
    },
  ];
  return items.length ? (
    <Table rows={items} cols={cols} rowKey={(b) => b.id} caption="Backups guardados" />
  ) : (
    <Empty icon="database" title="Nenhum backup ainda." body="Faça o primeiro agora ou ligue o backup automático." />
  );
}

export function Backups(_: ScreenProps) {
  const [tick, setTick] = useState(0);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const load = useLoad((signal) => call(adminBackupsApi.list, { signal }), [tick]);
  const reload = () => setTick((t) => t + 1);
  return (
    <Page title="Backup" kicker="Operação">
      {restored ? <RestoreDone r={restored} onClose={() => setRestored(null)} /> : null}
      <CreateCard onCreated={reload} />
      <Async load={load}>
        {(d) => (
          <>
            <ScheduleCard config={d.config} nextAutoAt={d.nextAutoAt} onSaved={reload} />
            <Card
              title="Backups guardados"
              sub="Do mais novo para o mais antigo. Restaurar traz de volta só o conteúdo do curso; o backup completo também serve para recuperar o banco inteiro (veja docs/DEPLOY.md)."
            >
              <BackupList items={d.items} onChanged={reload} onRestored={setRestored} />
            </Card>
          </>
        )}
      </Async>
    </Page>
  );
}
