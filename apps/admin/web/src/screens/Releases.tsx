// Publicações: compile the draft into a preview (what changed, what blocks a publish), publish it as
// a new immutable version, and (admins) see past versions and roll back to one.
import { adminContentApi, adminReleasesApi, type PreviewRes, type Release } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call } from '../api';
import { fmtAgo, fmtDateTime, fmtInt, plural } from '../format';
import { useEmails } from '../people';
import { can } from '../session';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Area, Async, Button, Card, Empty, ErrorBox, Field, Page, Pill } from '../ui/kit';
import { confirmAction } from '../ui/modal';
import { type Col, Table } from '../ui/table';
import { toast } from '../ui/toast';
import type { ScreenProps } from './registry';

export function fileLabel(f: string): string {
  if (f === 'catalog.json') return 'Catálogo';
  if (f === 'manifest.json') return 'Manifesto';
  const m = /^(ep|ebook|extra)\/(.+)\.json$/.exec(f);
  if (!m) return f;
  return `${m[1] === 'ep' ? 'Episódio' : m[1] === 'ebook' ? 'E-book' : 'Extra'} ${m[2]}`;
}

const short = (v: string) => v.slice(0, 10);

function PreviewCard({ onPublished }: { onPublished: () => void }) {
  const [p, setP] = useState<PreviewRes | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setP(await call(adminContentApi.preview));
    } catch (e) {
      setErr(e);
      setP(null);
    } finally {
      setBusy(false);
    }
  };
  const publish = () =>
    void confirmAction({
      title: 'Publicar para todos os alunos?',
      body: `A versão ${p ? short(p.version) : ''} passa a ser a que os alunos recebem, na hora. Dá para voltar a uma versão anterior em Publicações.`,
      confirm: 'Publicar agora',
      run: () => call(adminContentApi.publish, { body: { notes: notes.trim() || undefined } }),
    }).then((ok) => {
      if (ok) {
        toast('Conteúdo publicado.');
        setP(null);
        setNotes('');
        onPublished();
      }
    });
  const blocked = !!p?.errors.length;
  return (
    <Card
      title="Publicar o rascunho"
      sub="A prévia compila todo o conteúdo do rascunho e compara com a versão que os alunos veem."
      actions={
        <Button
          label={p ? 'Gerar de novo' : 'Gerar prévia'}
          icon="refresh"
          kind={p ? 'light' : 'navy'}
          busy={busy}
          onClick={() => void run()}
        />
      }
    >
      {err ? <ErrorBox error={err} retry={() => void run()} /> : null}
      {!p && !err ? <p class="sm">Gere a prévia para ver o que muda antes de publicar.</p> : null}
      {p ? (
        <>
          <div class="row wrapx" style={{ '--gap': '8px' }}>
            <Pill label={`Versão ${short(p.version)}`} tone="navy" />
            <Pill label={plural(p.manifest.files.episodes.length, 'episódio', 'episódios')} />
            <Pill label={plural(p.manifest.files.ebooks.length, 'e-book', 'e-books')} />
            <Pill label={plural(p.manifest.files.extras.length, 'Extra', 'Extras')} />
          </div>
          {p.errors.length ? (
            <section class="stack" style={{ '--gap': '8px' }} aria-label="Problemas">
              <div class="ad-note">
                <Icon name="alert" size={18} />{' '}
                {p.errors.length === 1 ? '1 problema impede' : `${fmtInt(p.errors.length)} problemas impedem`} publicar.
                Corrija no rascunho e gere de novo.
              </div>
              <ul class="ad-feed">
                {p.errors.slice(0, 30).map((e, i) => (
                  <li key={i}>
                    <span class="ad-feed-ic">
                      <Icon name="alert" size={15} />
                    </span>
                    <div class="grow">
                      <b>{fileLabel(e.file)}</b> <span class="xs ad-mono">{e.path}</span>
                      <div class="sm">{e.message}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : p.changed.length ? (
            <section class="stack" style={{ '--gap': '8px' }} aria-label="O que muda">
              <div class="lbl">O que muda ({p.changed.length})</div>
              <ul class="ad-files">
                {p.changed.map((f) => (
                  <li key={f} title={f}>
                    {fileLabel(f)}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <div class="ad-note bl">
              <Icon name="check" size={18} /> Nada mudou: o rascunho é igual à versão publicada.
            </div>
          )}
          {!blocked && p.changed.length ? (
            <div class="stack" style={{ '--gap': '10px' }}>
              <Field
                id="pub-notes"
                label="Notas da versão"
                opt
                hint="Ex.: “Episódio 3 publicado; correções no e-book 1”."
              >
                <Area id="pub-notes" value={notes} onValue={setNotes} rows={2} maxLength={500} />
              </Field>
              <div>
                <Button label={`Publicar versão ${short(p.version)}`} icon="rocket" onClick={publish} />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function History({ tick }: { tick: number }) {
  const load = useLoad((signal) => call(adminReleasesApi.list, { signal }), [tick]);
  const email = useEmails(load.data?.items.map((r) => r.publishedBy) ?? []);
  const rollback = (r: Release) =>
    void confirmAction({
      title: `Voltar para a versão ${short(r.version)}?`,
      body: `Os alunos passam a receber a versão publicada em ${fmtDateTime(r.publishedAt)}. O rascunho não muda: a próxima publicação traz as edições de volta.`,
      confirm: 'Voltar para esta versão',
      danger: true,
      run: () => call(adminReleasesApi.rollback, { params: { id: r.id } }),
    }).then((ok) => {
      if (ok) {
        toast('Versão restaurada.');
        load.reload();
      }
    });
  return (
    <Card
      title="Versões publicadas"
      sub="A versão em uso fica no topo. As outras, da mais nova para a mais antiga, permitem voltar atrás."
    >
      <Async load={load}>
        {(d) => {
          const cols: Col<Release>[] = [
            {
              key: 'v',
              label: 'Versão',
              cell: (r) => <span class="ad-mono">{short(r.version)}</span>,
            },
            {
              key: 'at',
              label: 'Publicada',
              cell: (r) => (
                <span class="ad-cell2" title={fmtDateTime(r.publishedAt)}>
                  <span>{fmtDateTime(r.publishedAt)}</span>
                  <span class="xs">{fmtAgo(r.publishedAt)}</span>
                </span>
              ),
            },
            { key: 'by', label: 'Por', cell: (r) => email(r.publishedBy) ?? r.publishedBy },
            { key: 'n', label: 'Notas', cell: (r) => r.notes ?? '—' },
            {
              key: 'f',
              label: 'Arquivos',
              cell: (r) =>
                [
                  plural(r.manifest.files.episodes.length, 'episódio', 'episódios'),
                  plural(r.manifest.files.ebooks.length, 'e-book', 'e-books'),
                  plural(r.manifest.files.extras.length, 'Extra', 'Extras'),
                ].join(' · '),
              desktopOnly: true,
            },
            {
              key: 'a',
              label: 'Ações',
              cls: 'shrink',
              cell: (r) =>
                r.version === d.current ? (
                  <Pill label="Em uso pelos alunos" tone="gr" icon="check" />
                ) : (
                  <Button label="Voltar para esta" icon="history" kind="light" onClick={() => rollback(r)} />
                ),
            },
          ];
          // The version learners get now stays on top; the rest keep their order (newest first).
          const rows = [
            ...d.items.filter((r) => r.version === d.current),
            ...d.items.filter((r) => r.version !== d.current),
          ];
          return d.items.length ? (
            <Table
              rows={rows}
              cols={cols}
              rowKey={(r) => r.id}
              hi={(r) => r.version === d.current}
              caption="Versões publicadas"
            />
          ) : (
            <Empty
              icon="rocket"
              title="Nenhuma versão publicada ainda."
              body="Cada publicação fica guardada aqui, e dá para voltar a qualquer uma delas."
            />
          );
        }}
      </Async>
    </Card>
  );
}

export function Releases(_: ScreenProps) {
  const [tick, setTick] = useState(0);
  return (
    <Page title="Publicações" kicker="Conteúdo">
      {can('content.publish') ? <PreviewCard onPublished={() => setTick((t) => t + 1)} /> : null}
      {can('releases.manage') ? (
        <History tick={tick} />
      ) : (
        <div class="ad-note bl">
          <Icon name="lock" size={18} /> O histórico de versões e a volta a uma versão anterior são de admins.
        </div>
      )}
    </Page>
  );
}
