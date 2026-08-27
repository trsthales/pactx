import fs from 'node:fs';
import path from 'node:path';
import { ProposalRecord } from './types';
import { safeAtomicWriteFileSync } from '../update/applier';

export function getProposalsDir(contextDir: string): string {
  const dir = path.join(contextDir, '.pactx', 'sessions', 'proposals');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function normalizeProposalId(rawId: string): string {
  const trimmed = rawId.trim();
  if (trimmed.toUpperCase().startsWith('PROP-')) {
    return trimmed.toUpperCase();
  }
  return `PROP-${trimmed.toUpperCase()}`;
}

export function saveProposal(contextDir: string, proposal: ProposalRecord): void {
  const dir = getProposalsDir(contextDir);
  const normalizedId = normalizeProposalId(proposal.proposalId);
  const targetFile = path.join(dir, `${normalizedId}.json`);
  safeAtomicWriteFileSync(targetFile, JSON.stringify(proposal, null, 2), 'utf-8');
}

export function getProposal(contextDir: string, proposalId: string): ProposalRecord | null {
  const dir = getProposalsDir(contextDir);
  const normalizedId = normalizeProposalId(proposalId);
  const targetFile = path.join(dir, `${normalizedId}.json`);
  if (!fs.existsSync(targetFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
  } catch {
    return null;
  }
}

export function removeProposal(contextDir: string, proposalId: string): boolean {
  const dir = getProposalsDir(contextDir);
  const normalizedId = normalizeProposalId(proposalId);
  const targetFile = path.join(dir, `${normalizedId}.json`);
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
      records.push(record);
    } catch {}
  }
  return records;
}
