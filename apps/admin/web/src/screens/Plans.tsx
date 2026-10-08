// Planos: sem cobrança; cada plano define os minutos de IA por mês e os recursos (premium_extras, hd).
// Um plano é o padrão (quem não tem plano atribuído usa ele). Desativar exige ninguém nele.
import { PLAN_FEATURES } from '@tie/shared/constants';
import {
  adminPlansApi,
  type PlanInput,
  PlanInput as PlanInputSchema,
  type PlanRow as PlanRowSchema,
} from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import type { z } from 'zod';
import { call, errorMessage, issuesOf } from '../api';
import { fmtDate, fmtInt } from '../format';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Async, Button, Empty, Field, Page, Pill, Switch, TextIn } from '../ui/kit';
import { confirmAction, Modal } from '../ui/modal';
import { type Col, Table } from '../ui/table';
import { toast } from '../ui/toast';
import { issuesToErrors, zodErrors } from '../ui/validate';
import type { ScreenProps } from './registry';

type PlanRow = z.infer<typeof PlanRowSchema>;

const FEATURE_LABEL: Record<string, string> = {
  [PLAN_FEATURES.premiumExtras]: 'Extras premium',
  [PLAN_FEATURES.hd]: 'Voz HD',
};

function Features({ f }: { f: Record<string, unknown> }) {
  const on = Object.entries(f).filter(([, v]) => v);
  if (!on.length) return <span class="xs">—</span>;
  return (
    <span class="ad-pills">
      {on.map(([k, v]) => (
        <Pill key={k} label={`${FEATURE_LABEL[k] ?? k}${v === true ? '' : `: ${String(v)}`}`} tone="bl" />
      ))}
    </span>
  );
}

const blankPlan = (): PlanInput => ({ slug: '', name: '', aiMinutesMonth: 60, features: {}, isDefault: false, active: true });

function PlanModal({ plan, onClose, onSaved }: { plan: PlanRow | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<PlanInput>(
    plan
      ? {
          slug: plan.slug,
          name: plan.name,
          aiMinutesMonth: plan.aiMinutesMonth,
          features: plan.features as PlanInput['features'],
          isDefault: plan.isDefault,
          active: plan.active,
        }
      : blankPlan(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [extraKey, setExtraKey] = useState('');
  const set = <K extends keyof PlanInput>(k: K, val: PlanInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const setFeature = (k: string, val: boolean | number | string | null) =>
    setV((p) => {
      const f = { ...p.features };
      if (val === null || val === false) delete f[k];
      else f[k] = val;
      return { ...p, features: f };
    });
  const save = async (e: Event) => {
    e.preventDefault();
    const errs = zodErrors(PlanInputSchema, v);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (plan) await call(adminPlansApi.update, { params: { id: plan.id }, body: v });
      else await call(adminPlansApi.create, { body: v });
      toast(plan ? 'Plano salvo.' : 'Plano criado.');
      onSaved();
    } catch (ex) {
      const iss = issuesOf(ex);
      if (iss.length) setErrors(issuesToErrors(iss));
      toast(errorMessage(ex), 'err');
    } finally {
      setBusy(false);
    }
  };
  const known = Object.values(PLAN_FEATURES) as string[];
  const custom = Object.keys(v.features).filter((k) => !known.includes(k));
  return (
    <Modal
      title={plan ? `Editar ${plan.name}` : 'Novo plano'}
      onClose={onClose}
      locked={busy}
      foot={
        <>
          <Button label="Cancelar" kind="light" onClick={onClose} />
          <Button label="Salvar" icon="check" type="submit" form="plan-form" busy={busy} />
        </>
      }
    >
      <form id="plan-form" class="ad-grid" onSubmit={save} noValidate>
        <Field id="pl-name" label="Nome" err={errors.name}>
          <TextIn id="pl-name" value={v.name} onValue={(s) => set('name', s)} err={errors.name} data-autofocus maxLength={80} />
        </Field>
        <Field id="pl-slug" label="Slug" hint="Minúsculas, números e hífen." err={errors.slug}>
          <TextIn id="pl-slug" class="ad-mono" value={v.slug} onValue={(s) => set('slug', s.toLowerCase())} err={errors.slug} maxLength={40} />
        </Field>
        <Field id="pl-min" label="Minutos de IA por mês" err={errors.aiMinutesMonth} hint="Conversa, pronúncia e voz somam no mesmo limite.">
          <TextIn
            id="pl-min"
            type="number"
            min={0}
            max={100000}
            value={String(v.aiMinutesMonth)}
            onValue={(s) => set('aiMinutesMonth', Number.parseInt(s || '0', 10))}
            err={errors.aiMinutesMonth}
          />
        </Field>
        <div class="stack" style={{ '--gap': '10px' }}>
          <div class="ad-bool">
            <Switch id="pl-def" on={!!v.isDefault} label="Plano padrão" onChange={(on) => set('isDefault', on)} />
            <label for="pl-def" class="grow">
              <span class="ad-bool-l">Plano padrão</span>
              <small class="xs">Quem não tem plano atribuído usa este.</small>
            </label>
          </div>
          <div class="ad-bool">
            <Switch id="pl-act" on={!!v.active} label="Ativo" onChange={(on) => set('active', on)} />
            <label for="pl-act" class="grow">
              <span class="ad-bool-l">Ativo</span>
              <small class="xs">Inativo não pode ser atribuído.</small>
            </label>
          </div>
        </div>
        <fieldset class="ad-span ad-obj">
          <legend class="ad-flabel">Recursos</legend>
          <div class="stack" style={{ '--gap': '10px' }}>
            {known.map((k) => (
              <div key={k} class="ad-bool">
                <Switch id={`pl-f-${k}`} on={!!v.features[k]} label={FEATURE_LABEL[k] ?? k} onChange={(on) => setFeature(k, on)} />
                <label for={`pl-f-${k}`} class="grow">
                  <span class="ad-bool-l">{FEATURE_LABEL[k] ?? k}</span>
                  <small class="xs ad-mono">{k}</small>
                </label>
              </div>
            ))}
            {custom.map((k) => (
              <div key={k} class="row" style={{ '--gap': '8px' }}>
                <span class="pill bl ad-mono">{k}</span>
                <span class="grow xs">{String(v.features[k])}</span>
                <button type="button" class="ad-ib danger" aria-label={`Remover o recurso ${k}`} onClick={() => setFeature(k, null)}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
            <div class="row" style={{ '--gap': '8px' }}>
              <TextIn id="pl-fk" class="ad-mono" value={extraKey} onValue={setExtraKey} placeholder="outro_recurso" aria-label="Chave de um recurso novo" />
              <Button
                label="Adicionar"
                icon="plus"
                kind="light"
                disabled={!/^[a-z][a-z0-9_]{1,39}$/.test(extraKey)}
                onClick={() => {
                  setFeature(extraKey, true);
                  setExtraKey('');
                }}
              />
            </div>
          </div>
        </fieldset>
        {errors[''] ? <div class="fb err ad-span">{errors['']}</div> : null}
      </form>
    </Modal>
  );
}

export function Plans(_: ScreenProps) {
  const load = useLoad((signal) => call(adminPlansApi.list, { signal }), []);
  const [editing, setEditing] = useState<PlanRow | null | 'new'>(null);
  const deactivate = (p: PlanRow) =>
    void confirmAction({
      title: `Desativar ${p.name}?`,
      body: 'Ninguém pode estar neste plano. Ele some das opções de atribuição, mas fica no histórico.',
      confirm: 'Desativar',
      danger: true,
      run: () => call(adminPlansApi.remove, { params: { id: p.id } }),
    }).then((ok) => {
      if (ok) {
        toast('Plano desativado.');
        load.reload();
      }
    });
  const cols: Col<PlanRow>[] = [
    {
      key: 'name',
      label: 'Plano',
      cell: (p) => (
        <span class="ad-cell2">
          <button type="button" class="ad-rowlink" style={{ textAlign: 'left' }} onClick={() => setEditing(p)}>
            {p.name}
          </button>
          <span class="xs ad-mono">{p.slug}</span>
        </span>
      ),
    },
    { key: 'min', label: 'Minutos/mês', cls: 'num', cell: (p) => fmtInt(p.aiMinutesMonth) },
    { key: 'feat', label: 'Recursos', cell: (p) => <Features f={p.features} /> },
    { key: 'users', label: 'Pessoas', cls: 'num', cell: (p) => (p.users ? <a class="ad-linkbtn" href={`#/usuarios?plan=${encodeURIComponent(p.slug)}`}>{fmtInt(p.users)}</a> : '0') },
    {
      key: 'state',
      label: 'Situação',
      cell: (p) => (
        <span class="ad-pills">
          {p.isDefault ? <Pill label="Padrão" tone="navy" /> : null}
          <Pill label={p.active ? 'Ativo' : 'Inativo'} tone={p.active ? 'gr' : ''} />
        </span>
      ),
    },
    { key: 'upd', label: 'Atualizado', cell: (p) => fmtDate(p.updatedAt), desktopOnly: true },
    {
      key: 'act',
      label: 'Ações',
      cls: 'shrink',
      cell: (p) => (
        <span class="row" style={{ '--gap': '4px' }}>
          <Button label="Editar" icon="pen" kind="light" onClick={() => setEditing(p)} />
          {p.active && !p.isDefault ? <Button ariaLabel={`Desativar ${p.name}`} icon="lock" kind="light" onClick={() => deactivate(p)} /> : null}
        </span>
      ),
    },
  ];
  return (
    <Page title="Planos" kicker="Pessoas" actions={<Button label="Novo plano" icon="plus" onClick={() => setEditing('new')} />}>
      <div class="ad-note bl">
        <Icon name="bulb" size={18} /> Sem cobrança: o plano só define minutos de IA e recursos. Atribua pela página de cada usuário.
      </div>
      <Async load={load}>
        {(d) =>
          d.items.length ? (
            <Table rows={d.items} cols={cols} rowKey={(p) => p.id} caption="Planos" hi={(p) => p.isDefault} />
          ) : (
            <Empty icon="coin" title="Nenhum plano ainda." action={<Button label="Criar o primeiro" icon="plus" onClick={() => setEditing('new')} />} />
          )
        }
      </Async>
      {editing ? (
        <PlanModal
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load.reload();
          }}
        />
      ) : null}
    </Page>
  );
}
