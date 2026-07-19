import type { FileAnalysis } from '../types';
import { parseSummaryTemplate } from './extractors';

export function templateSummary(analysis: FileAnalysis): string {
  return parseSummaryTemplate(analysis);
}
