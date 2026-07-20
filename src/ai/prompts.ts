import type {
  ExportInfo,
  ImportInfo,
  SignatureInfo,
  TypeInfo,
  FileType,
  Language,
  ParamInfo,
} from '../types';
import { stripComments } from '../utils/stripComments';

export interface SummarizationParams {
  path: string;
  type: FileType;
  language: Language;
  exports: ExportInfo[];
  signatures: SignatureInfo[];
  types: TypeInfo[];
  imports: ImportInfo[];
  sourceText: string;
  undocumentedFunctions: string[];
}

export const SYSTEM_PROMPT = [
  'You are a precise code summarization assistant embedded in a static-analysis tool.',
  'You are given the extracted structure and a source excerpt of exactly one file — nothing else.',
  'Describe only what is directly evidenced by the structure and excerpt shown to you.',
  'Never speculate about behavior, callers, runtime configuration, or intent that is not visible in the provided code.',
  'Respond with strict JSON only: no markdown code fences, no commentary before or after the JSON.',
].join(' ');

const MAX_EXCERPT_CHARS = 6000;

export const MAX_UNDOCUMENTED_FUNCTIONS_PER_REQUEST = 30;

export function capExcerpt(text: string, max = MAX_EXCERPT_CHARS): string {
  if (text.length <= max) return text;
  const headLen = Math.ceil(max * 0.6);
  const tailLen = max - headLen;
  return `${text.slice(0, headLen)}\n\n… (truncated) …\n\n${text.slice(-tailLen)}`;
}

function renderParam(p: ParamInfo): string {
  let out = p.rest && !p.name.startsWith('*') ? `...${p.name}` : p.name;
  if (p.type) out += `: ${p.type}`;
  if (p.optional && p.default === undefined) out += '?';
  if (p.default !== undefined) out += ` = ${p.default}`;
  return out;
}

export function renderSignatureForPrompt(
  sig: SignatureInfo,
  language: Language
): string {
  const paramsStr = sig.params.map(renderParam).join(', ');
  const asyncPrefix = sig.isAsync ? 'async ' : '';
  const genStar = sig.isGenerator ? '*' : '';
  const arrow = language === 'python' ? '->' : '=>';
  const ret = sig.returnType ? ` ${arrow} ${sig.returnType}` : '';
  if (sig.kind === 'constructor')
    return `${asyncPrefix}constructor(${paramsStr})`;
  const kindPrefix =
    sig.kind === 'getter' ? 'get ' : sig.kind === 'setter' ? 'set ' : '';
  return `${kindPrefix}${asyncPrefix}${genStar}${sig.name}(${paramsStr})${ret}`;
}

function renderStructure(params: SummarizationParams): string {
  const exportNames = params.exports.map((e) => e.name);
  const importSources = [...new Set(params.imports.map((i) => i.source))];

  const signatureLines = params.signatures
    .slice(0, 40)
    .map((s) => `- ${renderSignatureForPrompt(s, params.language)}`)
    .join('\n');

  const typeLines = params.types
    .filter((t) => t.isExported)
    .slice(0, 30)
    .map((t) => `- ${t.name}: ${t.definition}`)
    .join('\n');

  return [
    `Path: ${params.path}`,
    `File type: ${params.type}`,
    `Language: ${params.language}`,
    `Exports: ${exportNames.join(', ') || '(none)'}`,
    `Imports: ${importSources.join(', ') || '(none)'}`,
    '',
    'Signatures:',
    signatureLines || '(none)',
    '',
    'Exported types:',
    typeLines || '(none)',
  ].join('\n');
}

export function buildSummarizationPrompt(params: SummarizationParams): {
  system: string;
  user: string;
} {
  const structure = renderStructure(params);
  const excerpt = capExcerpt(stripComments(params.sourceText));

  const functionsAsk = params.undocumentedFunctions.length
    ? [
        '',
        'These functions/methods currently have no documentation. If (and only if) their purpose is clear from the code shown, describe each in one line:',
        params.undocumentedFunctions.map((n) => `- ${n}`).join('\n'),
      ].join('\n')
    : '';

  const user = [
    'Summarize this file for a codebase context map used by AI coding agents.',
    '',
    structure,
    '',
    'Source excerpt (comments stripped, may be truncated):',
    '```',
    excerpt,
    '```',
    functionsAsk,
    '',
    'Respond with exactly this JSON shape (no markdown fences, no extra text):',
    '{"summary": "<exactly one concise sentence, ideally under 100 characters, concrete, mentions the file\'s role — no fluff like \'This file contains\'>", "functions": {"<name>": "<one-line description>"}}',
    params.undocumentedFunctions.length
      ? 'The "functions" object must contain only the names listed above, and only entries you are confident about.'
      : 'Omit the "functions" key (or leave it empty) since there are no undocumented functions to describe.',
  ].join('\n');

  return { system: SYSTEM_PROMPT, user };
}

export interface ParsedAIResponse {
  summary: string;
  functionDocs?: Record<string, string>;
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function firstTwoSentences(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  const sentences = oneLine.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 2).join(' ').trim();
}

function extractSummaryFromTruncatedJson(cleaned: string): string | null {
  const match = cleaned.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match) return null;
  const value = match[1].replace(/\\(.)/g, '$1').trim();
  return value || null;
}

export function parseAIResponse(
  raw: string,
  undocumentedFunctions: string[] = []
): ParsedAIResponse {
  const cleaned = stripFences(raw);
  const allowed = new Set(undocumentedFunctions);

  try {
    const parsed = JSON.parse(cleaned) as any;
    if (parsed && typeof parsed === 'object') {
      const summary =
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : firstTwoSentences(cleaned);

      let functionDocs: Record<string, string> | undefined;
      if (parsed.functions && typeof parsed.functions === 'object') {
        const filtered: [string, string][] = [];
        for (const [name, doc] of Object.entries(parsed.functions)) {
          if (typeof doc !== 'string' || !doc.trim()) continue;
          if (allowed.size > 0 && !allowed.has(name)) continue;
          filtered.push([name, doc.trim()]);
        }
        if (filtered.length) functionDocs = Object.fromEntries(filtered);
      }

      return functionDocs ? { summary, functionDocs } : { summary };
    }
  } catch {
    /* fall through to recovery below — likely a truncated JSON response */
  }

  const recovered = extractSummaryFromTruncatedJson(cleaned);
  if (recovered) return { summary: recovered };

  return { summary: firstTwoSentences(raw) || raw.trim() };
}
