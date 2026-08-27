import fs from 'node:fs';
import path from 'node:path';
import { AnchorType, MicroAnchorEntry } from './types';
import { sanitizeBodyField } from '../update/applier';
import { getSessionsDir } from './sessionStore';

const HTML_COMMENT_REGEX = /<!--\s*pactx:v1\s+(dec|fact|rej|req|task)\s+([\s\S]*?)\s*-->/gi;
const USER_DIRECTIVE_REGEX = /^\s*(?:\/remember|\/pin|@pactx)\s*(decision|dec|rejected|reject|rej|requirement|req|fact|task)?(?:\s*[:\-])?\s*(.+)$/gim;

function normalizeDirectiveType(rawType?: string): AnchorType {
  if (!rawType) return 'fact';
  const t = rawType.toLowerCase().trim();
  if (t === 'dec' || t === 'decision') return 'dec';
  if (t === 'rej' || t === 'reject' || t === 'rejected') return 'rej';
  if (t === 'req' || t === 'requirement') return 'req';
  if (t === 'task') return 'task';
  return 'fact';
}

export function parseMicroAnchors(text: string): MicroAnchorEntry[] {
  if (!text || typeof text !== 'string') return [];
  const entries: MicroAnchorEntry[] = [];

  // 1. Extrai comentários <!-- pactx:v1 type payload -->
  let htmlMatch: RegExpExecArray | null;
  const htmlRegex = new RegExp(HTML_COMMENT_REGEX.source, 'gi');
  while ((htmlMatch = htmlRegex.exec(text)) !== null) {
    const rawType = htmlMatch[1].toLowerCase().trim() as AnchorType;
    const rawPayload = htmlMatch[2].trim();
    let payload: any;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      payload = sanitizeBodyField(rawPayload);
    }

    entries.push({
      type: rawType,
      payload,
      rawText: htmlMatch[0],
      source: 'ai_comment',
      capturedAt: new Date().toISOString(),
    });
  }

  // 2. Extrai diretivas do usuário (/remember, /pin, @pactx)
  let userMatch: RegExpExecArray | null;
  const userRegex = new RegExp(USER_DIRECTIVE_REGEX.source, 'gim');
  while ((userMatch = userRegex.exec(text)) !== null) {
    const type = normalizeDirectiveType(userMatch[1]);
    const rawContent = userMatch[2].trim();
    let payload: any;
    try {
      payload = JSON.parse(rawContent);
    } catch {
      payload = sanitizeBodyField(rawContent);
    }

    entries.push({
      type,
      payload,
      rawText: userMatch[0].trim(),
      source: 'user_remember',
      capturedAt: new Date().toISOString(),
    });
  }

  return entries;
}

export function appendSessionAnchor(contextDir: string, anchor: MicroAnchorEntry): void {
  const sessionsDir = getSessionsDir(contextDir);
  const anchorsFile = path.join(sessionsDir, 'anchors.jsonl');
  fs.appendFileSync(anchorsFile, JSON.stringify(anchor) + '\n', 'utf-8');
}

export function getSessionAnchors(contextDir: string): MicroAnchorEntry[] {
  const anchorsFile = path.join(contextDir, '.pactx', 'sessions', 'anchors.jsonl');
  if (!fs.existsSync(anchorsFile)) return [];
  try {
    const content = fs.readFileSync(anchorsFile, 'utf-8');
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const anchors: MicroAnchorEntry[] = [];
    for (const line of lines) {
      try {
        anchors.push(JSON.parse(line));
      } catch {}
    }
    return anchors;
  } catch {
    return [];
  }
}

export function clearSessionAnchors(contextDir: string): void {
  const anchorsFile = path.join(contextDir, '.pactx', 'sessions', 'anchors.jsonl');
  if (fs.existsSync(anchorsFile)) {
    try {
      fs.unlinkSync(anchorsFile);
    } catch {}
  }
}
