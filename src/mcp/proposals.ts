import fs from 'node:fs';
import path from 'node:path';
import { ProposalRecord } from './types';
import { safeAtomicWriteFileSync } from '../update/applier';
import { assertInsideDirectory } from '../update/planner';
import { computeCanonicalHash } from '../update/parser';

const PROPOSAL_ID_REGEX = /^PROP-[A-F0-9]{8,64}$/i;

export function getProposalsDir(contextDir: string): string {
  const dir = path.join(contextDir, '.pactx', 'sessions', 'proposals');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function normalizeProposalId(rawId: string): string {
  if (typeof rawId !== 'string') {
    throw new Error(`Invalid proposal ID: "${rawId}". Expected format: PROP-<hex>.`);
  }
  const trimmed = rawId.trim().toUpperCase();
  const normalized = trimmed.startsWith('PROP-') ? trimmed : `PROP-${trimmed}`;
  if (!PROPOSAL_ID_REGEX.test(normalized)) {
    throw new Error(`Invalid proposal ID: "${rawId}". Expected format: PROP-<hex>.`);
  }
  return normalized;
}

export function saveProposal(contextDir: string, proposal: ProposalRecord): void {
  const dir = getProposalsDir(contextDir);
  const normalizedId = normalizeProposalId(proposal.proposalId);
  const targetFile = path.join(dir, `${normalizedId}.json`);
  assertInsideDirectory(dir, targetFile, `Proposal ${normalizedId}`);
  safeAtomicWriteFileSync(targetFile, JSON.stringify(proposal, null, 2), 'utf-8');
}

export function getProposal(contextDir: string, proposalId: string): ProposalRecord | null {
  const dir = getProposalsDir(contextDir);
  const normalizedId = normalizeProposalId(proposalId);
  const targetFile = path.join(dir, `${normalizedId}.json`);
  assertInsideDirectory(dir, targetFile, `Proposal ${normalizedId}`);
  if (!fs.existsSync(targetFile)) return null;

  let record: ProposalRecord;
  try {
    record = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
  } catch {
    return null;
  }

  // Revalidação Criptográfica de Propostas (P1-02)
  if (record && record.payload && record.canonicalHash) {
    const computedHash = computeCanonicalHash(record.payload);
    if (computedHash !== record.canonicalHash) {
      throw new Error('Proposal integrity check failed: payload does not match canonical hash.');
    }
  }

  return record;
}

export function removeProposal(contextDir: string, proposalId: string): boolean {
  const dir = getProposalsDir(contextDir);
  const normalizedId = normalizeProposalId(proposalId);
  const targetFile = path.join(dir, `${normalizedId}.json`);
  assertInsideDirectory(dir, targetFile, `Proposal ${normalizedId}`);
  if (fs.existsSync(targetFile)) {
    try {
      fs.unlinkSync(targetFile);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function listProposals(contextDir: string): ProposalRecord[] {
  const dir = getProposalsDir(contextDir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const records: ProposalRecord[] = [];
  for (const f of files) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      if (record && record.payload && record.canonicalHash) {
        const computedHash = computeCanonicalHash(record.payload);
        if (computedHash !== record.canonicalHash) {
          continue; // Skip corrupted proposals
        }
      }
      records.push(record);
    } catch {}
  }
  return records;
}
