import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeAtomicWriteFileSync } from '../update/applier';

export interface ActiveSessionData {
  sessionId: string;
  sessionStartedAt: string; // ISO 8601
  baseRevision: string;
  packTokenEstimate: number;
  modelName?: string;
  currentTurn?: number;
}

export function getSessionsDir(contextDir: string): string {
  const dir = path.join(contextDir, '.pactx', 'sessions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function startSession(
  contextDir: string,
  baseRevision: string,
  packTokens: number,
  modelName?: string
): ActiveSessionData {
  const sessionsDir = getSessionsDir(contextDir);
  const sessionFile = path.join(sessionsDir, 'current.json');
  const data: ActiveSessionData = {
    sessionId: crypto.randomUUID(),
    sessionStartedAt: new Date().toISOString(),
    baseRevision,
    packTokenEstimate: packTokens,
    modelName: modelName || 'claude-3-7-sonnet',
    currentTurn: 0,
  };
  safeAtomicWriteFileSync(sessionFile, JSON.stringify(data, null, 2), 'utf-8');
  return data;
}

export function getActiveSession(contextDir: string): ActiveSessionData | null {
  const sessionFile = path.join(contextDir, '.pactx', 'sessions', 'current.json');
  if (!fs.existsSync(sessionFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
  } catch {
    return null;
  }
}

export function clearActiveSession(contextDir: string): void {
  const sessionsDir = path.join(contextDir, '.pactx', 'sessions');
  const sessionFile = path.join(sessionsDir, 'current.json');
  const anchorsFile = path.join(sessionsDir, 'anchors.jsonl');
  if (fs.existsSync(sessionFile)) {
    try {
      fs.unlinkSync(sessionFile);
    } catch {}
  }
  if (fs.existsSync(anchorsFile)) {
    try {
      fs.unlinkSync(anchorsFile);
    } catch {}
  }
}
