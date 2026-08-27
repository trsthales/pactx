export type TelemetryConfidence = 'exact' | 'estimated' | 'unknown';

export type ContextHealthGrade = 'SAFE' | 'WATCH' | 'CAUTION' | 'WARNING' | 'CRITICAL';

export type AnchorType = 'dec' | 'fact' | 'rej' | 'req' | 'task';

export interface MicroAnchorEntry {
  type: AnchorType;
  payload: any; // objeto parseado ou string
  rawText: string;
  source: 'ai_comment' | 'user_remember';
  capturedAt: string; // ISO 8601
}

export interface ContextHealthInput {
  modelName?: string;
  modelMaxTokens?: number;
  reservedOutputTokens?: number;
  estimatedTokensUsed: number;
  turnsCount?: number;
  confidence?: TelemetryConfidence;
}

export interface ContextHealthReport {
  model: {
    name: string;
    maxTokens: number;
    reservedOutputTokens: number;
    usableTokens: number;
  };
  consumption: {
    estimatedTokens: number;
    saturationPercent: number;
    turnsCount: number;
    remainingTokens: number;
  };
  health: {
    grade: ContextHealthGrade;
    confidence: TelemetryConfidence;
    score: number; // 0-100 (100 = 0% saturação)
  };
  recommendation: {
    action: 'CONTINUE' | 'WATCH' | 'CHECKPOINT' | 'HANDOFF' | 'CRITICAL_RESET';
    message: string;
  };
}
