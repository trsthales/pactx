import { MicroAnchorEntry } from '../telemetry/types';
import { RawUpdatePayload } from '../update/types';

export type TranscriptSource = 'claude' | 'chatgpt' | 'cursor' | 'raw';

export interface TranscriptTurn {
  index: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface NormalizedTranscript {
  source: TranscriptSource;
  sessionId?: string;
  modelName?: string;
  turns: TranscriptTurn[];
  rawText: string;
}

export interface TranscriptAdapter {
  detect(input: string | Record<string, any>): boolean;
  normalize(input: string | Record<string, any>): NormalizedTranscript;
}

export interface DeterministicExtractionResult {
  anchors: MicroAnchorEntry[];
  candidateUpdate: Partial<RawUpdatePayload>;
  gitSignals: {
    modifiedFiles: string[];
    recentCommits: string[];
  };
  inlineCodeAnnotations: Array<{
    type: 'DECISION' | 'REJECTED' | 'INVARIANT';
    content: string;
  }>;
  totalTurns: number;
  anchorsCount: number;
}
