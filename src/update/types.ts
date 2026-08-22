export interface RawUpdatePayload {
    version: string;
    base_revision?: string;
    source?: {
        model?: string;
        session_topic?: string;
    };
    state?: {
        active_task?: string;
        status?: 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';
        recommended_model?: 'Medium' | 'High';
        completed_items?: string[];
        new_facts?: string[];
        rejected_hypotheses?: string[];
        next_action?: string;
    };
    new_decisions?: Array<{
        id?: string;
        title: string;
        reason: string;
        decision: string;
    }>;
    superseded_decisions?: Array<{
        id: string;
        by?: string;
        reason: string;
    }>;
    new_glossary_terms?: Array<{
        term: string;
        definition: string;
    }>;
}

export interface StateUpdateOperation {
    targetPath: string;
    activeTask?: string;
    status?: 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';
    recommendedModel?: 'Medium' | 'High';
    newCompletedItems: string[];
    newFacts: string[];
    newRejectedHypotheses: string[];
    nextAction?: string;
}

export interface CreatedAdrOperation {
    id: string;
    targetPath: string;
    title: string;
    reason: string;
    decision: string;
    date: string;
}

export interface SupersededAdrOperation {
    id: string;
    targetPath: string;
    supersededBy: string;
    reason: string;
    date: string;
}

export interface GlossaryTermOperation {
    term: string;
    definition: string;
}

export interface MutationPlan {
    schemaVersion: string;
    baseRevision?: string;
    canonicalHash: string;
    isAlreadyApplied: boolean;
    isForced?: boolean;
    appliedRevision?: string;
    warnings: string[];
    source?: {
        model?: string;
        sessionTopic?: string;
    };
    operations: {
        stateUpdate?: StateUpdateOperation;
        createdAdrs: CreatedAdrOperation[];
        supersededAdrs: SupersededAdrOperation[];
        appendedGlossaryTerms: GlossaryTermOperation[];
    };
}

export interface HistoryEntry {
    hash: string;
    applied_at: string;
    forced?: boolean;
    base_revision?: string;
    applied_revision?: string;
    task?: string;
    created_adrs?: string[];
    superseded_adrs?: string[];
}

export interface HistoryLedger {
    version: string;
    applied_updates: HistoryEntry[];
}