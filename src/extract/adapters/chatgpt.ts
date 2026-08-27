import { NormalizedTranscript, TranscriptAdapter, TranscriptTurn } from '../types';

export class ChatGPTExportAdapter implements TranscriptAdapter {
  detect(input: string | Record<string, any>): boolean {
    const obj = typeof input === 'string' ? safeJsonParse(input) : input;
    if (!obj || typeof obj !== 'object') return false;

    const target = Array.isArray(obj) ? obj[0] : obj;
    if (!target || typeof target !== 'object') return false;

    if (target.mapping && typeof target.mapping === 'object') {
      const nodeValues = Object.values(target.mapping);
      return nodeValues.some((n: any) => n && n.message && n.message.author && n.message.author.role);
    }

    return false;
  }

  normalize(input: string | Record<string, any>): NormalizedTranscript {
    const obj = typeof input === 'string' ? safeJsonParse(input) : input;
    const rawText = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const target = Array.isArray(obj) ? obj[0] : obj;

    const turns: TranscriptTurn[] = [];
    if (target?.mapping && typeof target.mapping === 'object') {
      const nodes: any[] = Object.values(target.mapping).filter((n: any) => n && n.message);

      // Sort chronologically if create_time exists
      nodes.sort((a, b) => {
        const timeA = a.message?.create_time || 0;
        const timeB = b.message?.create_time || 0;
        return timeA - timeB;
      });

      let index = 0;
      for (const node of nodes) {
        const msg = node.message;
        const rawRole = (msg?.author?.role || 'user').toLowerCase();
        let role: 'user' | 'assistant' | 'system' = 'user';
        if (rawRole === 'assistant') role = 'assistant';
        else if (rawRole === 'system') role = 'system';
        else role = 'user';

        let content = '';
        if (Array.isArray(msg?.content?.parts)) {
          content = msg.content.parts
            .map((p: any) => (typeof p === 'string' ? p : JSON.stringify(p)))
            .filter(Boolean)
            .join('\n');
        } else if (typeof msg?.content === 'string') {
          content = msg.content;
        } else if (typeof msg?.content?.text === 'string') {
          content = msg.content.text;
        }

        if (!content.trim() && role === 'system') {
          // Skip empty system messages
          continue;
        }

        turns.push({
          index: index++,
          role,
          content,
          timestamp: msg?.create_time ? new Date(msg.create_time * 1000).toISOString() : undefined,
        });
      }
    }

    return {
      source: 'chatgpt',
      sessionId: target?.id || target?.conversation_id,
      modelName: target?.default_model_slug || 'gpt-4o',
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
