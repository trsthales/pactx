import { NormalizedTranscript, TranscriptAdapter } from './types';
import { ClaudeExportAdapter } from './adapters/claude';
import { ChatGPTExportAdapter } from './adapters/chatgpt';
import { CursorLogAdapter } from './adapters/cursor';
import { RawTranscriptAdapter } from './adapters/raw';

export const ADAPTERS: Record<string, TranscriptAdapter> = {
  claude: new ClaudeExportAdapter(),
  chatgpt: new ChatGPTExportAdapter(),
  cursor: new CursorLogAdapter(),
  raw: new RawTranscriptAdapter(),
};

export function detectTranscriptFormat(rawInput: string | Record<string, any>): string {
  let parsed: any = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      parsed = rawInput;
    }
  }

  if (ADAPTERS.claude.detect(parsed)) return 'claude';
  if (ADAPTERS.chatgpt.detect(parsed)) return 'chatgpt';
  if (ADAPTERS.cursor.detect(parsed)) return 'cursor';
  if (typeof rawInput === 'string' && ADAPTERS.cursor.detect(rawInput)) return 'cursor';
  return 'raw';
}

export function detectAndNormalizeTranscript(rawInput: string | Record<string, any>): NormalizedTranscript {
  const format = detectTranscriptFormat(rawInput);
  const adapter = ADAPTERS[format] || ADAPTERS.raw;

  let inputToNormalize = rawInput;
  if (typeof rawInput === 'string') {
    try {
      inputToNormalize = JSON.parse(rawInput);
    } catch {
      inputToNormalize = rawInput;
    }
  }

  if (adapter.detect(inputToNormalize)) {
    return adapter.normalize(inputToNormalize);
  }

  return ADAPTERS.raw.normalize(rawInput);
}
