import { NormalizedTranscript, TranscriptAdapter, TranscriptTurn } from '../types';

export class CursorLogAdapter implements TranscriptAdapter {
  detect(input: string | Record<string, any>): boolean {
    if (typeof input === 'object' && input !== null) {
      if (Array.isArray((input as any).bubbles)) return true;
      if ((input as any).tabId || (input as any).bubbleId) return true;
      return false;
    }

    if (typeof input === 'string') {
      const trimmed = input.trim();
      const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        let validJsonlCount = 0;
        for (const line of lines.slice(0, 10)) {
          try {
            const parsed = JSON.parse(line);
            if (
              parsed.tabId ||
              parsed.bubbleId ||
              parsed.type === 'ai' ||
              parsed.type === 'user' ||
              parsed.bot ||
              (parsed.role && parsed.message)
            ) {
              validJsonlCount++;
            }
          } catch {
            break;
          }
        }
        if (validJsonlCount > 0 && validJsonlCount >= Math.min(lines.length, 3)) {
          return true;
        }
      }
    }

    return false;
  }

  normalize(input: string | Record<string, any>): NormalizedTranscript {
    const rawText = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const turns: TranscriptTurn[] = [];
    let sessionId: string | undefined;

    if (typeof input === 'object' && input !== null) {
      sessionId = (input as any).tabId || (input as any).id;
      const bubbles = Array.isArray((input as any).bubbles) ? (input as any).bubbles : [];
      let index = 0;
      for (const b of bubbles) {
        const role = b.type === 'user' || b.role === 'user' ? 'user' : 'assistant';
        const content = b.text || b.message || b.content || '';
        turns.push({
          index: index++,
          role,
          content,
          timestamp: b.timestamp || b.createdAt,
        });
      }
    } else if (typeof input === 'string') {
      const lines = input.trim().split('\n').map(l => l.trim()).filter(Boolean);
      let index = 0;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          sessionId = sessionId || parsed.tabId;
          if (parsed.user && parsed.bot) {
            turns.push({
              index: index++,
              role: 'user',
              content: parsed.user,
            });
            turns.push({
              index: index++,
              role: 'assistant',
              content: parsed.bot,
            });
          } else {
            const rawRole = (parsed.role || parsed.type || 'user').toLowerCase();
            const role = rawRole === 'ai' || rawRole === 'assistant' || rawRole === 'bot' ? 'assistant' : 'user';
            const content = parsed.text || parsed.message || parsed.content || '';
            turns.push({
              index: index++,
              role,
              content,
              timestamp: parsed.timestamp || parsed.createdAt,
            });
          }
        } catch {}
      }
    }

    return {
      source: 'cursor',
      sessionId,
      modelName: 'cursor-agent',
      turns,
      rawText,
    };
  }
}
