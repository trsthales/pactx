/**
 * Estimativa ponderada de tokens:
 * - Código (dentro de ``` ou ` inline): ~3 chars / token
 * - Prosa (fora de código): ~4 chars / token
 * - Margem conservadora: +15%
 */
export function estimateTokens(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  const codeBlockRegex = /```[\s\S]*?```|`[^`\r\n]+`/g;
  const codeBlocks = text.match(codeBlockRegex) || [];
  const codeText = codeBlocks.join('');
  const proseText = text.replace(codeBlockRegex, '');

  const codeTokens = Math.ceil(codeText.length / 3);
  const proseTokens = Math.ceil(proseText.length / 4);

  return Math.ceil((codeTokens + proseTokens) * 1.15);
}

export function estimateTurnCost(userMessage: string, assistantResponse: string): number {
  return estimateTokens(userMessage) + estimateTokens(assistantResponse);
}
