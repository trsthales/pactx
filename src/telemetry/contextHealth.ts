import {
  ContextHealthGrade,
  ContextHealthInput,
  ContextHealthReport,
  TelemetryConfidence,
} from './types';

export const DEFAULT_MODEL_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-5': 200_000,
  'claude-3-7-sonnet': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-opus-4': 200_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-1.5-pro': 1_000_000,
  'gemini-1.5-flash': 1_000_000,
  'llama-3.1-405b': 128_000,
  'llama-3.3-70b': 128_000,
};

export const DEFAULT_FALLBACK_WINDOW = 128_000;
export const DEFAULT_RESERVED_OUTPUT = 8_192;

export function resolveModelMaxTokens(modelName?: string, explicitMax?: number): number {
  if (typeof explicitMax === 'number' && explicitMax > 0) {
    return explicitMax;
  }
  if (modelName) {
    const normalized = modelName.toLowerCase().trim();
    if (DEFAULT_MODEL_WINDOWS[normalized]) {
      return DEFAULT_MODEL_WINDOWS[normalized];
    }
  }
  return DEFAULT_FALLBACK_WINDOW;
}

export function calculateContextHealth(input: ContextHealthInput): ContextHealthReport {
  const modelName = input.modelName || 'unknown';
  const maxTokens = resolveModelMaxTokens(input.modelName, input.modelMaxTokens);
  const reservedOutputTokens =
    typeof input.reservedOutputTokens === 'number' && input.reservedOutputTokens >= 0
      ? input.reservedOutputTokens
      : DEFAULT_RESERVED_OUTPUT;

  const usableTokens = Math.max(1, maxTokens - reservedOutputTokens);
  const estimatedTokens = Math.max(0, input.estimatedTokensUsed || 0);
  const remainingTokens = Math.max(0, usableTokens - estimatedTokens);

  const rawSaturation = (estimatedTokens / usableTokens) * 100;
  const saturationPercent = Math.min(100, Math.max(0, rawSaturation));
  const score = Math.round(100 - saturationPercent);
  const turnsCount = Math.max(0, input.turnsCount ?? 0);
  const confidence: TelemetryConfidence = input.confidence ?? 'estimated';

  let grade: ContextHealthGrade;
  let action: ContextHealthReport['recommendation']['action'];
  let message: string;

  if (rawSaturation < 50) {
    grade = 'SAFE';
    action = 'CONTINUE';
    message = 'Session is healthy. Full model attention.';
  } else if (rawSaturation < 70) {
    grade = 'WATCH';
    action = 'WATCH';
    message = 'Productive zone. Capture in-flight micro-anchors.';
  } else if (rawSaturation < 85) {
    grade = 'CAUTION';
    action = 'CHECKPOINT';
    message = 'Attention degradation zone. Consider creating a checkpoint.';
  } else if (rawSaturation < 95) {
    grade = 'WARNING';
    action = 'HANDOFF';
    message = 'High saturation. Recommend running /handoff immediately.';
  } else {
    grade = 'CRITICAL';
    action = 'CRITICAL_RESET';
    message = 'Context limit exceeded. High risk of amnesia and hallucinations.';
  }

  return {
    model: {
      name: modelName,
      maxTokens,
      reservedOutputTokens,
      usableTokens,
    },
    consumption: {
      estimatedTokens,
      saturationPercent,
      turnsCount,
      remainingTokens,
    },
    health: {
      grade,
      confidence,
      score,
    },
    recommendation: {
      action,
      message,
    },
  };
}
