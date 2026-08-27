import { DeterministicExtractionResult, NormalizedTranscript } from './types';
import { MicroAnchorEntry } from '../telemetry/types';
import { parseMicroAnchors } from '../telemetry/anchorScanner';
import { getGitState } from '../git';
import { findProjectRoot } from '../utils/contextFinder';

const CODE_ANNOTATION_REGEX = /(?:\/\/|#|\/\*)\s*(DECISION|REJECTED|INVARIANT):\s*([^\n\r*]+?)(?:\*\/)?$/gim;

export function extractDeterministicData(
  transcript: NormalizedTranscript,
  cwd: string = process.cwd()
): DeterministicExtractionResult {
  const allAnchors: MicroAnchorEntry[] = [];
  const inlineCodeAnnotations: Array<{
    type: 'DECISION' | 'REJECTED' | 'INVARIANT';
    content: string;
  }> = [];

  // 1. Extração de micro-âncoras em todos os turnos
  for (const turn of transcript.turns) {
    if (!turn.content) continue;
    const turnAnchors = parseMicroAnchors(turn.content);
    allAnchors.push(...turnAnchors);

    // 2. Extração de anotações de código (// DECISION:, // REJECTED:, etc.)
    let match: RegExpExecArray | null;
    const regex = new RegExp(CODE_ANNOTATION_REGEX.source, 'gim');
    while ((match = regex.exec(turn.content)) !== null) {
      const type = match[1].toUpperCase() as 'DECISION' | 'REJECTED' | 'INVARIANT';
      const content = match[2].trim();
      if (content) {
        inlineCodeAnnotations.push({ type, content });
      }
    }
  }

  // 3. Inspeciona sinais do Git
  let projectRoot = cwd;
  try {
    projectRoot = findProjectRoot(cwd) || cwd;
  } catch {
    projectRoot = cwd;
  }
  const gitState = getGitState(projectRoot);

  // 4. Monta o candidato de atualização inicial
  const factsSet = new Set<string>();
  const rejectedSet = new Set<string>();
  const decisionsMap = new Map<string, any>();
  const requirementsMap = new Map<string, any>();

  for (const anchor of allAnchors) {
    if (anchor.type === 'fact') {
      const factText = typeof anchor.payload === 'string' ? anchor.payload : anchor.payload?.title || JSON.stringify(anchor.payload);
      if (factText) factsSet.add(factText.trim());
    } else if (anchor.type === 'rej') {
      const rejText = typeof anchor.payload === 'string' ? anchor.payload : anchor.payload?.title || JSON.stringify(anchor.payload);
      if (rejText) rejectedSet.add(rejText.trim());
    } else if (anchor.type === 'dec') {
      if (typeof anchor.payload === 'object' && anchor.payload !== null) {
        const title = anchor.payload.title || anchor.payload.decision || 'Decision';
        decisionsMap.set(title, {
          id: 'auto',
          title,
          reason: anchor.payload.reason || 'Extracted from in-flight micro-anchor',
          decision: anchor.payload.decision || anchor.payload.title || '',
          satisfies: Array.isArray(anchor.payload.satisfies) ? anchor.payload.satisfies : [],
        });
      } else if (typeof anchor.payload === 'string' && anchor.payload.trim()) {
        const title = anchor.payload.trim();
        decisionsMap.set(title, {
          id: 'auto',
          title,
          reason: 'Extracted from in-flight micro-anchor',
          decision: title,
          satisfies: [],
        });
      }
    } else if (anchor.type === 'req') {
      if (typeof anchor.payload === 'object' && anchor.payload !== null) {
        const title = anchor.payload.title || 'Requirement';
        requirementsMap.set(title, {
          id: 'auto',
          title,
          statement: anchor.payload.statement || anchor.payload.title || '',
          type: anchor.payload.type || 'functional',
        });
      } else if (typeof anchor.payload === 'string' && anchor.payload.trim()) {
        const title = anchor.payload.trim();
        requirementsMap.set(title, {
          id: 'auto',
          title,
          statement: title,
          type: 'functional',
        });
      }
    }
  }

  // Incorpora anotações de código no candidateUpdate
  for (const ann of inlineCodeAnnotations) {
    if (ann.type === 'REJECTED') {
      rejectedSet.add(ann.content);
    } else if (ann.type === 'DECISION') {
      if (!decisionsMap.has(ann.content)) {
        decisionsMap.set(ann.content, {
          id: 'auto',
          title: ann.content,
          reason: 'Extracted from inline code annotation',
          decision: ann.content,
          satisfies: [],
        });
      }
    }
  }

  const candidateUpdate = {
    version: '1.1',
    state: {
      new_facts: Array.from(factsSet),
      rejected_hypotheses: Array.from(rejectedSet),
    },
    new_decisions: Array.from(decisionsMap.values()),
    new_requirements: Array.from(requirementsMap.values()),
  };

  return {
    anchors: allAnchors,
    candidateUpdate,
    gitSignals: {
      modifiedFiles: gitState.modifiedFiles || [],
      recentCommits: gitState.recentCommits || [],
    },
    inlineCodeAnnotations,
    totalTurns: transcript.turns.length,
    anchorsCount: allAnchors.length,
  };
}
