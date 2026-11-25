import { expect, it } from 'vitest';
import { micSpeaker } from '../src/domain/micSpeaker';

// Episode 1 (Meet the Woods): its Take It In lines and cast.
const cast = ['Zach', 'Margaret', 'Robert', 'Becky', 'Barbara'];
const dialog = [
  { who: 'Zach', en: 'OK. Ready? Hi! My name is Zach. Zach Woods.' },
  { who: 'Zach', en: 'Mom! Say hello!' },
  { who: 'Margaret', en: 'Hello! I’m Margaret. Good morning, everybody.' },
  { who: 'Zach', en: 'Dad, you’re next.' },
  { who: 'Robert', en: 'Good morning. My name is Robert Woods. It’s nice to meet you.' },
  { who: '', en: '(the doorbell rings)', stage: true },
  { who: 'Barbara', en: 'Good morning, honey. How are you?' },
  { who: 'Margaret', en: 'I’m fine, thanks. And you?' },
  { who: 'All', en: 'Bye!' },
];

it('reads each Take the Mic phrase in the voice of the character who says it', () => {
  const who = (en: string, set?: string | null) => micSpeaker(en, dialog, cast, set);
  expect(who('Hi! My name is Zach.')).toBe('Zach');
  expect(who('Hello! I’m Margaret.')).toBe('Margaret');
  expect(who('Good morning.')).toBe('Margaret');
  expect(who('How are you?')).toBe('Barbara');
  expect(who('I’m fine, thanks. And you?')).toBe('Margaret');
  expect(who('Nice to meet you.')).toBe('Robert');
  // Nobody says it (and "All" is no one voice): the narration.
  expect(who('Bye! See you.')).toBeNull();
  // "Quem fala" set in the admin wins; whole words only ("Hi" is not inside "this").
  expect(who('Good morning.', 'Robert')).toBe('Robert');
  expect(micSpeaker('Hi!', [{ who: 'Zach', en: 'Is this it?' }], cast)).toBeNull();
});
