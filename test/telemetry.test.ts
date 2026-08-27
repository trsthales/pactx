import { test } from 'node:test';
import assert from 'node:assert';
import {
  estimateTokens,
  estimateTurnCost,
  calculateContextHealth,
  DEFAULT_MODEL_WINDOWS,
  DEFAULT_FALLBACK_WINDOW,
  DEFAULT_RESERVED_OUTPUT,
} from '../src';

test('tokenEstimator: string vazia ou espaços em branco retornam 0', () => {
  assert.strictEqual(estimateTokens(''), 0);
  assert.strictEqual(estimateTokens('   '), 0);
  assert.strictEqual(estimateTokens('\n\t  \r\n'), 0);
  // @ts-expect-error testing invalid type input resilience
  assert.strictEqual(estimateTokens(null), 0);
  // @ts-expect-error testing invalid type input resilience
  assert.strictEqual(estimateTokens(undefined), 0);
  // @ts-expect-error testing invalid type input resilience
  assert.strictEqual(estimateTokens(123), 0);
});

test('tokenEstimator: prosa pura calcula Math.ceil((length / 4) * 1.15)', () => {
  const prose = 'The quick brown fox jumps over the lazy dog.';
  // length = 44
  // proseTokens = Math.ceil(44 / 4) = 11
  // total = Math.ceil(11 * 1.15) = Math.ceil(12.65) = 13
  const expected = Math.ceil(Math.ceil(prose.length / 4) * 1.15);
  assert.strictEqual(estimateTokens(prose), expected);
});

test('tokenEstimator: código em cercas triplas calcula Math.ceil((length / 3) * 1.15)', () => {
  const code = '```typescript\nconst x = 1;\nconsole.log(x);\n```';
  const expected = Math.ceil(Math.ceil(code.length / 3) * 1.15);
  assert.strictEqual(estimateTokens(code), expected);
});

test('tokenEstimator: código inline em crases calcula Math.ceil((length / 3) * 1.15)', () => {
  const inlineCode = '`const result = fn(a, b)`';
  const expected = Math.ceil(Math.ceil(inlineCode.length / 3) * 1.15);
  assert.strictEqual(estimateTokens(inlineCode), expected);
});

test('tokenEstimator: texto misto pondera prosa e código com 15% de margem', () => {
  const mixed = 'Use the function `calculate()` to compute:\n```js\nconst res = calculate();\n```\nDone.';
  const codeBlockRegex = /```[\s\S]*?```|`[^`\r\n]+`/g;
  const codeBlocks = mixed.match(codeBlockRegex) || [];
  const codeText = codeBlocks.join('');
  const proseText = mixed.replace(codeBlockRegex, '');

  const expectedCodeTokens = Math.ceil(codeText.length / 3);
  const expectedProseTokens = Math.ceil(proseText.length / 4);
  const expectedTotal = Math.ceil((expectedCodeTokens + expectedProseTokens) * 1.15);

  assert.strictEqual(estimateTokens(mixed), expectedTotal);
});

test('tokenEstimator: estimateTurnCost soma as estimativas de usuário e assistente', () => {
  const user = 'How do I sort an array?';
  const assistant = 'Use `arr.sort((a, b) => a - b)`.';
  const expected = estimateTokens(user) + estimateTokens(assistant);

  assert.strictEqual(estimateTurnCost(user, assistant), expected);
});

test('contextHealth: mapeamento de modelos conhecidos e fallback para desconhecidos', () => {
  // Modelo conhecido (case-insensitive e com trim)
  const reportClaude = calculateContextHealth({
    modelName: ' Claude-3-7-Sonnet ',
    estimatedTokensUsed: 10_000,
  });
  assert.strictEqual(reportClaude.model.maxTokens, 200_000);
  assert.strictEqual(reportClaude.model.name, ' Claude-3-7-Sonnet ');

  const reportGemini = calculateContextHealth({
    modelName: 'gemini-2.5-pro',
    estimatedTokensUsed: 10_000,
  });
  assert.strictEqual(reportGemini.model.maxTokens, 1_000_000);

  // Modelo desconhecido usa fallback
  const reportUnknown = calculateContextHealth({
    modelName: 'some-custom-model',
    estimatedTokensUsed: 10_000,
  });
  assert.strictEqual(reportUnknown.model.maxTokens, DEFAULT_FALLBACK_WINDOW);

  // Override explícito de modelMaxTokens tem precedência
  const reportCustom = calculateContextHealth({
    modelName: 'gpt-4o',
    modelMaxTokens: 64_000,
    estimatedTokensUsed: 10_000,
  });
  assert.strictEqual(reportCustom.model.maxTokens, 64_000);
});

test('contextHealth: cálculo correto de usableTokens e remainingTokens', () => {
  const maxTokens = 100_000;
  const reservedOutputTokens = 10_000;
  const usableTokens = 90_000; // 100k - 10k
  const used = 45_000;

  const report = calculateContextHealth({
    modelMaxTokens: maxTokens,
    reservedOutputTokens,
    estimatedTokensUsed: used,
    turnsCount: 12,
    confidence: 'exact',
  });

  assert.strictEqual(report.model.usableTokens, usableTokens);
  assert.strictEqual(report.consumption.remainingTokens, usableTokens - used);
  assert.strictEqual(report.consumption.turnsCount, 12);
  assert.strictEqual(report.health.confidence, 'exact');
  assert.strictEqual(report.consumption.saturationPercent, 50);
  assert.strictEqual(report.health.score, 50);
});

test('contextHealth: transições de faixas de risco (SAFE, WATCH, CAUTION, WARNING, CRITICAL)', () => {
  const usableTokens = 100_000;
  const inputBase = {
    modelMaxTokens: usableTokens + DEFAULT_RESERVED_OUTPUT,
    reservedOutputTokens: DEFAULT_RESERVED_OUTPUT,
  };

  // 1. SAFE (< 50%)
  const safe = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 40_000 });
  assert.strictEqual(safe.health.grade, 'SAFE');
  assert.strictEqual(safe.recommendation.action, 'CONTINUE');
  assert.strictEqual(safe.recommendation.message, 'Session is healthy. Full model attention.');

  // 2. WATCH (50% - 70%)
  const watch50 = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 50_000 });
  assert.strictEqual(watch50.health.grade, 'WATCH');
  assert.strictEqual(watch50.recommendation.action, 'WATCH');
  assert.strictEqual(watch50.recommendation.message, 'Productive zone. Capture in-flight micro-anchors.');

  const watch69 = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 69_000 });
  assert.strictEqual(watch69.health.grade, 'WATCH');

  // 3. CAUTION (70% - 85%)
  const caution70 = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 70_000 });
  assert.strictEqual(caution70.health.grade, 'CAUTION');
  assert.strictEqual(caution70.recommendation.action, 'CHECKPOINT');
  assert.strictEqual(caution70.recommendation.message, 'Attention degradation zone. Consider creating a checkpoint.');

  const caution84 = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 84_900 });
  assert.strictEqual(caution84.health.grade, 'CAUTION');

  // 4. WARNING (85% - 95%)
  const warning85 = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 85_000 });
  assert.strictEqual(warning85.health.grade, 'WARNING');
  assert.strictEqual(warning85.recommendation.action, 'HANDOFF');
  assert.strictEqual(warning85.recommendation.message, 'High saturation. Recommend running /handoff immediately.');

  const warning94 = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 94_000 });
  assert.strictEqual(warning94.health.grade, 'WARNING');

  // 5. CRITICAL (>= 95%)
  const critical95 = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 95_000 });
  assert.strictEqual(critical95.health.grade, 'CRITICAL');
  assert.strictEqual(critical95.recommendation.action, 'CRITICAL_RESET');
  assert.strictEqual(critical95.recommendation.message, 'Context limit exceeded. High risk of amnesia and hallucinations.');

  const critical150 = calculateContextHealth({ ...inputBase, estimatedTokensUsed: 150_000 });
  assert.strictEqual(critical150.health.grade, 'CRITICAL');
  assert.strictEqual(critical150.consumption.saturationPercent, 100);
  assert.strictEqual(critical150.health.score, 0);
  assert.strictEqual(critical150.consumption.remainingTokens, 0);
});

test('contextHealth: proteção contra valores negativos e limites de borda', () => {
  const report = calculateContextHealth({
    estimatedTokensUsed: -500,
    turnsCount: -5,
    reservedOutputTokens: -100, // Should fallback to default
  });

  assert.strictEqual(report.consumption.estimatedTokens, 0);
  assert.strictEqual(report.consumption.turnsCount, 0);
  assert.strictEqual(report.consumption.saturationPercent, 0);
  assert.strictEqual(report.health.score, 100);
  assert.strictEqual(report.health.grade, 'SAFE');
  assert.strictEqual(report.model.reservedOutputTokens, DEFAULT_RESERVED_OUTPUT);
});
