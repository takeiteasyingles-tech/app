import { describe, expect, it } from 'vitest';
import { misreadingsOf } from '../src/demo/misreadings';

describe('misreadingsOf (spec 05 "Take the Mic: how it sounded")', () => {
  it('th: t or f, or d in the voiced function words; final th as t or f', () => {
    expect(misreadingsOf('thanks')).toEqual(['tanks', 'fanks']);
    expect(misreadingsOf('think')).toEqual(['tink', 'fink']);
    expect(misreadingsOf('this')).toEqual(['dis']);
    expect(misreadingsOf('the')).toEqual(['de']);
    expect(misreadingsOf('with')).toEqual(['wit', 'wif']);
  });

  it('s + consonant gets an e before it; a final stop gets an i after it', () => {
    expect(misreadingsOf('school')).toEqual(['eschool']);
    expect(misreadingsOf('speak')).toEqual(['espeak', 'speaki']);
    expect(misreadingsOf('good')).toEqual(['goodi']);
    expect(misreadingsOf('night')).toEqual(['nighti']);
  });

  it('words with no typical misreading', () => {
    for (const w of ['fine', 'i', 'am', 'hello', 'you', 'morning', '']) expect(misreadingsOf(w), w).toEqual([]);
  });
});
