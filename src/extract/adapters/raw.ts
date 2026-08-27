import { NormalizedTranscript, TranscriptAdapter, TranscriptTurn } from '../types';

export class RawTranscriptAdapter implements TranscriptAdapter {
  detect(_input: string | Record<string, any>): boolean {
    return true; // Fallback universal
  }

  normalize(input: string | Record<string, any>): NormalizedTranscript {
    const rawText = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const turns: TranscriptTurn[] = [];

    const lines = rawText.split(/\r?\n/);
    let currentRole: 'user' | 'assistant' | null = null;
    let currentContentLines: string[] = [];
    let index = 0;

    const flushCurrent = () => {
      if (currentRole !== null && currentContentLines.length > 0) {
        const content = currentContentLines.join('\n').trim();
        if (content) {
          turns.push({
            index: index++,
            role: currentRole,
            content,
          });
        }
        currentContentLines = [];
      }
    };

    const userPrefixRegex = /^(?:#{1,6}\s*)?(?:\[?(?:User|Human|Developer|Client|Me)\]?)\s*:\s*(.*)$/i;
    const assistantPrefixRegex = /^(?:#{1,6}\s*)?(?:\[?(?:Assistant|AI|Claude|ChatGPT|Bot)\]?)\s*:\s*(.*)$/i;

    for (const line of lines) {
      const userMatch = line.match(userPrefixRegex);
      const assistantMatch = line.match(assistantPrefixRegex);

      if (userMatch) {
        flushCurrent();
        currentRole = 'user';
        if (userMatch[1]?.trim()) {
          currentContentLines.push(userMatch[1].trim());
        }
      } else if (assistantMatch) {
        flushCurrent();
        currentRole = 'assistant';
        if (assistantMatch[1]?.trim()) {
          currentContentLines.push(assistantMatch[1].trim());
        }
      } else {
        if (currentRole !== null) {
          currentContentLines.push(line);
        } else {
          // Lines before any marker
          currentContentLines.push(line);
        }
      }
    }
    flushCurrent();

    // Se nenhum marcador explícito foi detectado, divide em turnos básicos ou mantém como bloco único
    if (turns.length === 0) {
      turns.push({
        index: 0,
        role: rawText.includes('```pactx-update') || rawText.includes('<!-- pactx:v1') ? 'assistant' : 'user',
        content: rawText.trim(),
      });
    }

    return {
      source: 'raw',
      turns,
      rawText,
    };
  }
}
