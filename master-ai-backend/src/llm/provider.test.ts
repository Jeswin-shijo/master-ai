import { describe, expect, it } from 'vitest';
import { llmProviderFor } from '../config';

const base = { LLM_OFFLINE: 'auto', LLM_PROVIDER: 'auto' } as const;

describe('which model provider the gateway uses', () => {
  it('uses the offline rules when no key is set', () => {
    expect(llmProviderFor(base)).toBe('offline');
  });

  it('uses Claude when its key is set, even when a Gemini key is set too', () => {
    expect(llmProviderFor({ ...base, ANTHROPIC_API_KEY: 'sk-ant' })).toBe('anthropic');
    expect(llmProviderFor({ ...base, ANTHROPIC_API_KEY: 'sk-ant', GEMINI_API_KEY: 'g' })).toBe('anthropic');
  });

  it('uses Gemini when only its key is set, or when LLM_PROVIDER says so', () => {
    expect(llmProviderFor({ ...base, GEMINI_API_KEY: 'g' })).toBe('google');
    expect(llmProviderFor({ ...base, LLM_PROVIDER: 'google', ANTHROPIC_API_KEY: 'sk-ant', GEMINI_API_KEY: 'g' })).toBe('google');
  });

  it('refuses to start when Gemini is asked for without its key', () => {
    expect(() => llmProviderFor({ ...base, LLM_PROVIDER: 'google' })).toThrow('LLM_PROVIDER=google needs GEMINI_API_KEY');
  });

  it('stays offline when LLM_OFFLINE=always, whatever keys are set', () => {
    expect(llmProviderFor({ ...base, LLM_OFFLINE: 'always', ANTHROPIC_API_KEY: 'sk-ant', GEMINI_API_KEY: 'g' })).toBe('offline');
  });

  it('keeps LLM_OFFLINE=never meaning Claude, as before', () => {
    expect(llmProviderFor({ ...base, LLM_OFFLINE: 'never' })).toBe('anthropic');
  });
});
