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

function parseIfJson(rawInput: string | Record<string, any>): { parsed: any; isJson: boolean } {
  if (typeof rawInput === 'object' && rawInput !== null) {
    return { parsed: rawInput, isJson: true };
  }
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return { parsed: JSON.parse(trimmed), isJson: true };
      } catch {
        return { parsed: rawInput, isJson: false };
      }
    }
  }
  return { parsed: rawInput, isJson: false };
}

export function detectTranscriptFormat(rawInput: string | Record<string, any>): string {
  const { parsed, isJson } = parseIfJson(rawInput);

  if (isJson) {
    if (ADAPTERS.claude.detect(parsed)) return 'claude';
    if (ADAPTERS.chatgpt.detect(parsed)) return 'chatgpt';
    if (ADAPTERS.cursor.detect(parsed)) return 'cursor';
  } else if (typeof rawInput === 'string') {
    if (ADAPTERS.cursor.detect(rawInput)) return 'cursor';
  }

  return 'raw';
}

export function detectAndNormalizeTranscript(rawInput: string | Record<string, any>): NormalizedTranscript {
  const { parsed, isJson } = parseIfJson(rawInput);
  const format = isJson
    ? (ADAPTERS.claude.detect(parsed) ? 'claude' : ADAPTERS.chatgpt.detect(parsed) ? 'chatgpt' : ADAPTERS.cursor.detect(parsed) ? 'cursor' : 'raw')
    : (typeof rawInput === 'string' && ADAPTERS.cursor.detect(rawInput) ? 'cursor' : 'raw');

  const adapter = ADAPTERS[format] || ADAPTERS.raw;
  const inputToUse = isJson ? parsed : rawInput;

  if (adapter.detect(inputToUse)) {
    return adapter.normalize(inputToUse);
  }

  return ADAPTERS.raw.normalize(rawInput);
}
