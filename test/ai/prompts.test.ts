import { describe, it, expect } from 'vitest';
import {
  buildSummarizationPrompt,
  parseAIResponse,
  capExcerpt,
  SYSTEM_PROMPT,
} from '../../src/ai/prompts';
import { baseRequest } from './helpers';

describe('buildSummarizationPrompt', () => {
  it('includes structure, excerpt, and the undocumented-functions ask when present', () => {
    const { system, user } = buildSummarizationPrompt(
      baseRequest({ undocumentedFunctions: ['loginUser'] })
    );
    expect(system).toBe(SYSTEM_PROMPT);
    expect(system).toMatch(/never speculate/i);
    expect(user).toContain('src/api/auth.ts');
    expect(user).toContain('loginUser');
    expect(user).toMatch(/currently have no documentation/);
  });

  it('omits the functions ask when there are no undocumented functions', () => {
    const { user } = buildSummarizationPrompt(
      baseRequest({ undocumentedFunctions: [] })
    );
    expect(user).not.toMatch(/currently have no documentation/);
    expect(user).toMatch(/Omit the "functions" key/);
  });
});

describe('capExcerpt', () => {
  it('returns short text unchanged', () => {
    expect(capExcerpt('short')).toBe('short');
  });

  it('truncates long text keeping head and tail', () => {
    const long = 'A'.repeat(4000) + 'MIDDLE' + 'B'.repeat(4000);
    const capped = capExcerpt(long, 1000);
    expect(capped.length).toBeLessThan(long.length);
    expect(capped.startsWith('A')).toBe(true);
    expect(capped.endsWith('B'.repeat(10))).toBe(true);
    expect(capped).not.toContain('MIDDLE');
  });
});

describe('parseAIResponse', () => {
  it('parses clean JSON', () => {
    const result = parseAIResponse(
      '{"summary":"Handles login.","functions":{"foo":"Does the thing."}}',
      ['foo']
    );
    expect(result.summary).toBe('Handles login.');
    expect(result.functionDocs).toEqual({ foo: 'Does the thing.' });
  });

  it('strips markdown fences before parsing', () => {
    const result = parseAIResponse(
      '```json\n{"summary":"Handles login."}\n```',
      []
    );
    expect(result.summary).toBe('Handles login.');
    expect(result.functionDocs).toBeUndefined();
  });

  it('strips fences without a json language tag', () => {
    const result = parseAIResponse('```\n{"summary":"Handles login."}\n```', []);
    expect(result.summary).toBe('Handles login.');
  });

  it('tolerates a missing functions key', () => {
    const result = parseAIResponse('{"summary":"Handles login."}', ['foo']);
    expect(result.summary).toBe('Handles login.');
    expect(result.functionDocs).toBeUndefined();
  });

  it('filters function entries down to the allowed undocumented list', () => {
    const result = parseAIResponse(
      '{"summary":"X.","functions":{"foo":"Doc.","notAllowed":"Doc2."}}',
      ['foo']
    );
    expect(result.functionDocs).toEqual({ foo: 'Doc.' });
  });

  it('falls back to raw text trimmed to two sentences on unparseable garbage', () => {
    const result = parseAIResponse(
      'This module handles authentication. It exposes login and refresh. It also does more things not relevant here.',
      []
    );
    expect(result.summary).toBe(
      'This module handles authentication. It exposes login and refresh.'
    );
    expect(result.functionDocs).toBeUndefined();
  });

  it('never throws on completely empty input', () => {
    expect(() => parseAIResponse('', [])).not.toThrow();
    expect(parseAIResponse('', []).summary).toBe('');
  });

  it('recovers the summary text from JSON truncated mid-response', () => {
    const result = parseAIResponse(
      '{"summary": "This module implements the CLI entry point and wires up',
      []
    );
    expect(result.summary).toBe(
      'This module implements the CLI entry point and wires up'
    );
    expect(result.functionDocs).toBeUndefined();
  });

  it('does not fabricate function docs when truncated before a summary field appears', () => {
    const result = parseAIResponse(
      '{"functions":{"foo":"partial doc that never clo',
      ['foo']
    );
    expect(result.functionDocs).toBeUndefined();
  });
});
