import { describe, expect, it } from 'vitest';
import { ids, itemIdFromV6, phraseIdFromV6, questionIdFromV6 } from '../src/transform/ids';
import { isExcluded, r2KeyFor } from '../src/transform/media';

describe('stable ids', () => {
  it('content ids follow the spec patterns', () => {
    expect(ids.micPhrase(1, 0)).toBe('e1-mic-0');
    expect(ids.exercise(1, 0)).toBe('e1-ex0');
    expect(ids.exerciseItem(1, 0, 3)).toBe('e1-ex0-i3');
    expect(ids.testQuestion(1, 14)).toBe('eb1-t14');
    expect(ids.lyric(2, 5)).toBe('e2-ly5');
    expect(ids.dialog(5, 0)).toBe('e5-dl0');
    expect(ids.visual(1, 7)).toBe('e1-vi7');
    expect(ids.track('season-one', 2)).toBe('season-one-t2');
    expect(ids.pron(3)).toBe('pron-3');
    expect(ids.plan('gratis')).toBe('plan-gratis');
  });

  it('media ids come from the asset path, keys from path + content hash', () => {
    expect(ids.media('img/gen/bg/home.webp')).toBe('m-img-gen-bg-home-webp');
    expect(ids.media('assets/video/mic/margaret-talk-happy.mp4')).toBe('m-video-mic-margaret-talk-happy-mp4');
    expect(r2KeyFor('img/gen/bg/home.webp', 'deadbeef00112233')).toBe('media/deadbeef/img/gen/bg/home.webp');
  });

  it('maps prototype v6 positional keys to v7 ids', () => {
    expect(phraseIdFromV6('1-3')).toBe('e1-mic-3');
    expect(itemIdFromV6('2-1-4')).toBe('e2-ex1-i4');
    expect(questionIdFromV6('14')).toBe('eb1-t14');
    expect(phraseIdFromV6('1-0-2')).toBeNull();
    expect(itemIdFromV6('1-2')).toBeNull();
    expect(questionIdFromV6('x')).toBeNull();
  });

  it('excludes temp/, personagens/, archives and dotfiles from media', () => {
    expect(isExcluded('temp/login.png')).toBe(true);
    expect(isExcluded('img/personagens/a.webp')).toBe(true);
    expect(isExcluded('prototipo.zip')).toBe(true);
    expect(isExcluded('img/.DS_Store')).toBe(true);
    expect(isExcluded('img/gen/bg/home.webp')).toBe(false);
  });
});
