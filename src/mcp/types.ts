import { MutationPlan, RawUpdatePayload } from '../update/types';

export interface ProposalRecord {
  proposalId: string; // e.g. "PROP-a3f2d1b8"
  canonicalHash: string;
  proposedAt: string; // ISO 8601
  plan: MutationPlan;
  payload: RawUpdatePayload;
  rawInput: string;
  warnings: string[];
}
