import { describe, expect, it } from 'vitest';
import { doneCta } from '../src/screens/concluido/cta';

const eps = [
  { num: 1, status: 'published' },
  { num: 2, status: 'published' },
  { num: 3, status: 'title_only' },
];

describe('doneCta (spec 05 "Concluído: the button always says something")', () => {
  it('keeps the text and route set in the admin', () => {
    expect(doneCta({ cta: 'Voltar ao início', go: 'inicio' }, 5, eps)).toEqual({
      label: 'Voltar ao início',
      go: 'inicio',
    });
    expect(doneCta({ cta: 'Assinar e continuar', go: '' }, 4, eps)).toEqual({
      label: 'Assinar e continuar',
      go: 'inicio',
    });
  });

  it('without a text, opens the next published episode', () => {
    expect(doneCta({ cta: '', go: '' }, 1, eps)).toEqual({ label: 'Começar o Episódio 2', go: 'episodio/2' });
    expect(doneCta({ cta: ' ', go: 'episodio/7' }, 6, eps)).toEqual({
      label: 'Começar o Episódio 7',
      go: 'episodio/7',
    });
    expect(doneCta({ cta: '', go: 'extra' }, 1, eps)).toEqual({ label: 'Continuar', go: 'extra' });
  });

  it('with no text, no route and no next episode, there is no button', () => {
    expect(doneCta({ cta: '', go: '' }, 2, eps)).toBeNull();
    expect(doneCta({ cta: '', go: '' }, 1, undefined)).toBeNull();
  });
});
