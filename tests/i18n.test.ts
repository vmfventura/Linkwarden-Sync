import { describe, expect, it } from 'vitest';
import { AppError } from '../src/core/errors';
import { detectLocale, en, pt, errorEn, errorPt, messageError } from '../src/ui/i18n';

describe('UI catalogues', () => {
  it('has identical message and error keys with non-empty translations', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(errorPt).sort()).toEqual(Object.keys(errorEn).sort());
    for (const catalogue of [en, pt, errorEn, errorPt]) for (const value of Object.values(catalogue)) expect(value.trim().length).toBeGreaterThan(0);
  });
  it('detects Portuguese preferences and otherwise defaults to English', () => {
    expect(detectLocale(['pt-PT', 'en'])).toBe('pt-PT');
    expect(detectLocale(['pt-BR'])).toBe('pt-PT');
    expect(detectLocale(['en-US', 'pt-PT'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
  it('localizes typed errors and safely replaces unknown remote details', () => {
    expect(messageError(new AppError('locked'), 'pt-PT')).toBe(errorPt.locked);
    expect(messageError({ code: 'authentication' }, 'en')).toBe(errorEn.authentication);
    expect(messageError(new Error('secret token'), 'en')).toBe(errorEn.invalid_request);
    expect(messageError({ code: 'constructor' }, 'pt-PT')).toBe(errorPt.invalid_request);
  });
});
