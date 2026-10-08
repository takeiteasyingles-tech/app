// EXTRA title page (TIE.screens.extraDetail): hero, synopsis, why it was suggested, cast, and either
// the Friday premiere notice or watch / dub / talk about it plus the scene vocabulary.
// Desktop: the hero text lines up with the content column, which splits into story | vocabulary.
// The watch button lives with the other actions only (no second play button on the hero).
import { DEFAULT_ASSISTANT } from '@tie/shared/constants';
import { assistantThe, getAssistant } from '@tie/shared/domain/assist';
import { rankExtras } from '@tie/shared/domain/personalize';
import { ApiError } from '@tie/shared/errors';
import { activator, Btn, Icon, Topbar } from '@tie/ui';
import { useEffect, useMemo, useState } from 'preact/hooks';
import * as speech from '../../core/speech';
import { type ScreenProps, useChrome } from '../../frame';
import { replace } from '../../router';
import { showToast } from '../../store/award';
import { loadExtra, useContent } from '../../store/content';
import { state } from '../../store/state';
import { pts, useCatalog } from './data';
import { LoadFailed, OnNavy } from './parts';

export default function ExtraDetail({ params }: ScreenProps) {
  useChrome({ title: 'EXTRA' });
  const id = params.id ?? '';
  const { c, failed, retry } = useCatalog();
  const p = state.value.profile;
  const x = useMemo(() => (c && p ? (rankExtras(p, c).find((e) => e.id === id) ?? null) : null), [c, p, id]);
  const missing = !!c && !x;
  useEffect(() => {
    if (missing) replace('extra');
  }, [missing]);
  // Lines and vocab live in extra/{id}.json (locked titles have none to show).
  const full = useContent(() => (x && !x.locked ? loadExtra(x.id) : Promise.resolve(null)), [x?.id, x?.locked]);
  const [past, setPast] = useState(false);

  if (failed) {
    return (
      <OnNavy cls="x-det">
        <Topbar back="extra" />
        <div class="scroll">
          <LoadFailed onRetry={retry} />
        </div>
      </OnNavy>
    );
  }
  if (!c || !x) return <OnNavy cls="x-det" />;

  const planLocked = full.error instanceof ApiError && full.error.code === 'plan_required';
  const aThe = assistantThe(getAssistant(c.assistants, p?.assistant || DEFAULT_ASSISTANT));
  const vocab = full.data?.vocab ?? [];

  let side = null;
  let actions = null;
  if (x.locked) {
    side = (
      <div class="card">
        <div class="h3" style={{ color: '#fff' }}>
          Estreia sexta.
        </div>
        <div class="mt12">
          <Btn
            label="Me avise quando chegar"
            kind="light"
            icon="clock"
            onClick={() => showToast('Combinado. Você recebe um aviso na sexta.')}
          />
        </div>
      </div>
    );
  } else if (planLocked) {
    side = (
      <div class="card">
        <div class="h3" style={{ color: '#fff' }}>
          Este título faz parte de outro plano.
        </div>
        <p class="p mt8" style={{ color: 'var(--onNavy)' }}>
          Fale com quem cuida da sua conta para liberar.
        </p>
      </div>
    );
  } else {
    actions = (
      <div class="x-acts">
        <Btn
          label={`Assistir com legendas · +${pts(c, 'extra', 20)} pontos`}
          go={`extra/${x.id}/assistir`}
          icon="play"
          cls="block"
        />
        {x.dub ? (
          <Btn
            label={`Dublar o ${x.dub} · +${pts(c, 'dub', 10)} por fala`}
            kind="light"
            go={`extra/${x.id}/assistir?dub=1`}
            icon="mic"
            cls="block"
          />
        ) : null}
        <Btn
          label={`Conversar com ${aThe} sobre isto`}
          kind="ghost"
          go={`maggie?modo=extra&x=${x.id}`}
          icon="chat"
          cls="block"
        />
      </div>
    );
    side = (
      <div class="card x-vocab">
        <div class="lbl">Vocabulário da cena</div>
        <div class="stack mt8" style={{ '--gap': '0' }}>
          {vocab.map((v) => (
            <div key={v.en} class="listrow">
              <button
                type="button"
                class="en grow"
                style={{ textAlign: 'left', color: '#fff' }}
                aria-label={`Ouvir: ${v.en}`}
                onClick={activator(undefined, () => void speech.say(v.en))}
              >
                <span class="sayico">
                  <Icon name="speaker" size={16} />
                </span>
                {v.en}
              </button>
              <span style={{ color: 'var(--onNavy)' }}>{v.pt}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <OnNavy cls={`x-det${past ? ' x-past' : ''}`} w={1100}>
      {/* The prototype's bar. Over the hero it names where the back button goes (the hero has the big
          title); once the hero scrolls away it turns solid and shows kind · title. */}
      <Topbar back="extra" kicker={past ? x.kind : undefined} title={past ? x.title : 'EXTRA'} />
      <div
        class="scroll"
        onScroll={(ev) => {
          const on = (ev.currentTarget as HTMLElement).scrollTop > 200;
          if (on !== past) setPast(on);
        }}
      >
        <div class="hero-extra" style={{ borderRadius: '0' }}>
          <img src={x.scene ?? ''} alt="" />
          <div class="shade" />
          <div class="inner x-hero-in">
            <div class="stack" style={{ '--gap': '8px' }}>
              <div class="row wrapx" style={{ '--gap': '8px' }}>
                <span class="pill x-dark">{x.kind}</span>
                <span class="pill lvl">{x.level}</span>
                <span class="pill x-dark">
                  <Icon name="clock" size={13} /> {x.dur}
                </span>
              </div>
              <div class="h1" style={{ color: '#fff' }}>
                {x.title}
              </div>
              <div class="sm">{x.ep}</div>
            </div>
          </div>
        </div>
        <div class="wrap" style={{ '--wrap': '1100px' }}>
          <div class="x-det-body">
            <div class="x-det-main">
              <p class="p-read">{x.synopsis}</p>
              <div class="xs" style={{ color: '#FFB08F', fontWeight: '800' }}>
                {x.why}
              </div>
              {x.cast.length ? (
                <div class="stack x-castbox" style={{ '--gap': '10px' }}>
                  <div class="lbl">Elenco</div>
                  <div class="chips x-cast">
                    {x.cast.map((m) => (
                      <div key={m.name} class="pill m">
                        <span class="av" style={{ background: m.color }} aria-hidden="true">
                          {m.initials}
                        </span>
                        <span class="nm">{m.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {actions}
            </div>
            {side}
          </div>
        </div>
      </div>
    </OnNavy>
  );
}
