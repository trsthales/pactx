import { NormalizedTranscript, TranscriptAdapter, TranscriptTurn } from '../types';

export class ClaudeExportAdapter implements TranscriptAdapter {
  detect(input: string | Record<string, any>): boolean {
    const obj = typeof input === 'string' ? safeJsonParse(input) : input;
    if (!obj || typeof obj !== 'object') return false;

    // Direct chat_messages array (Claude.ai export format)
    if (Array.isArray((obj as any).chat_messages)) {
      return true;
    }

    // Array of messages with sender human/assistant
    if (Array.isArray(obj)) {
      return obj.length > 0 && obj.some((m: any) => m && (m.sender === 'human' || m.sender === 'assistant'));
    }

    // Object with messages array containing sender human/assistant
    if ((obj as any).messages && Array.isArray((obj as any).messages)) {
      const msgs = (obj as any).messages;
      return msgs.some((m: any) => m && (m.sender === 'human' || m.sender === 'assistant'));
    }

    return false;
  }

  normalize(input: string | Record<string, any>): NormalizedTranscript {
    const obj = typeof input === 'string' ? safeJsonParse(input) : input;
    const rawText = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const turns: TranscriptTurn[] = [];

    const rawMessages: any[] = Array.isArray(obj)
      ? obj
      : Array.isArray((obj as any)?.chat_messages)
      ? (obj as any).chat_messages
      : Array.isArray((obj as any)?.messages)
      ? (obj as any).messages
      : [];

    let index = 0;
    for (const msg of rawMessages) {
      if (!msg) continue;
      let role: 'user' | 'assistant' | 'system' = 'user';
      const sender = (msg.sender || msg.role || '').toLowerCase();
      if (sender === 'human' || sender === 'user') {
        role = 'user';
      } else if (sender === 'assistant' || sender === 'claude' || sender === 'bot') {
        role = 'assistant';
      } else if (sender === 'system') {
        role = 'system';
      }

      let content = '';
      if (typeof msg.text === 'string') {
        content = msg.text;
      } else if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
          .filter(Boolean)
          .join('\n');
      }

      turns.push({
        index: index++,
        role,
        content,
        timestamp: msg.created_at || msg.timestamp,
      });
    }

    return {
      source: 'claude',
      sessionId: (obj as any)?.uuid || (obj as any)?.id,
      modelName: (obj as any)?.model || 'claude',
      turns,
      rawText,
    };
  }
}

function safeJsonParse(val: string): any {
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}
