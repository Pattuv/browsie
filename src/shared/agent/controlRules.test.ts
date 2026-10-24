import { describe, expect, it } from 'vitest';
import { matchControl, parseYesNo } from './controlRules';

describe('matchControl', () => {
  it('catches the control words, politely or not', () => {
    expect(matchControl('Stop')).toBe('stop');
    expect(matchControl('stop, please!')).toBe('stop');
    expect(matchControl('OK never mind')).toBe('stop');
    expect(matchControl('Say that again?')).toBe('repeat');
    expect(matchControl('a bit louder please')).toBe('louder');
    expect(matchControl('slow down')).toBe('slower');
  });

  it('leaves requests alone, even ones containing a control word', () => {
    expect(matchControl('stop the video')).toBeUndefined();
    expect(matchControl('repeat my last order on Amazon')).toBeUndefined();
    expect(matchControl('open a new tab')).toBeUndefined();
    expect(matchControl('')).toBeUndefined();
  });
});

describe('parseYesNo', () => {
  it('reads yes and no', () => {
    expect(parseYesNo('Yes.')).toBe('yes');
    expect(parseYesNo('yeah go ahead')).toBe('yes');
    expect(parseYesNo('No.')).toBe('no');
    expect(parseYesNo("don't do that")).toBe('no');
  });

  it('takes any no as no', () => {
    expect(parseYesNo('yes, actually no')).toBe('no');
    expect(parseYesNo('I am not sure')).toBe('no');
  });

  it('never guesses yes', () => {
    expect(parseYesNo('what was the total?')).toBeUndefined();
    expect(parseYesNo('')).toBeUndefined();
  });
});
