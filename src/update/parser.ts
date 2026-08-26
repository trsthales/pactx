import yaml from 'yaml';
import crypto from 'node:crypto';
import { RawUpdatePayload } from './types';

const ADR_ID_REGEX = /^(auto|DEC-(?!0+$)\d{3,4})$/i;
const REQ_ID_REGEX = /^(auto|REQ-(?!0+$)\d{3,4})$/i;
const MAX_INPUT_SIZE = 512 * 1024; // 512KB
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 2000;
const MAX_DECISIONS_PER_BATCH = 20;
const MAX_REQUIREMENTS_PER_BATCH = 20;
const MAX_GLOSSARY_TERMS_PER_BATCH = 50;

const VALID_STATUSES = ['IN_PROGRESS', 'BLOCKED', 'COMPLETED'] as const;
const VALID_MODELS = ['Medium', 'High'] as const;
const VALID_REQ_TYPES = ['functional', 'security', 'performance', 'compliance'] as const;
const VALID_SOURCE_TYPES = ['conversation', 'agent', 'manual', 'document'] as const;

const HOMOGLYPH_MAP: Record<string, string> = {
    '\u0430': 'a', '\u0410': 'A', // Cyrillic a
    '\u0435': 'e', '\u0415': 'E', // Cyrillic e
    '\u043E': 'o', '\u041E': 'O', // Cyrillic o
    '\u0440': 'p', '\u0420': 'P', // Cyrillic p
    '\u0441': 'c', '\u0421': 'C', // Cyrillic c
    '\u0445': 'x', '\u0425': 'X', // Cyrillic x
    '\u0443': 'y', '\u0423': 'Y', // Cyrillic y
    '\u0456': 'i', '\u0406': 'I', // Cyrillic i
    '\u0458': 'j', '\u0408': 'J', // Cyrillic j
};

// Padrões lineares resilientes a ReDoS para Prompt Injection Heuristics (Multilíngue)
const SUSPICIOUS_PATTERNS = [
    // Inglês
    /\b(?:ignore|disregard|forget|bypass|override)\s{1,5}(?:(?:all|previous|prior|above|system)\s{1,5}){0,3}(?:instructions?|prompts?|rules?|directives?)\b/i,
    /\bsystem\s+prompt\s+override\b/i,
    // Português
    /\b(?:ignore|desconsidere|esqueca|esqueça|bypasse|sobrescreva)\s{1,5}(?:(?:todas?|as|os|anteriores?|sistema|do\s+sistema)\s{1,5}){0,3}(?:instrucoes?|instruções?|regras?|diretivas?|prompts?)\b/i,
    // Espanhol
    /\b(?:ignora|desestima|olvida|omite|anula)\s{1,5}(?:(?:todas?|las|los|anteriores?|sistema|del\s+sistema)\s{1,5}){0,3}(?:instrucciones?|reglas?|directivas?|prompts?)\b/i,
    // Shell / Command execution
    /\b(?:rm\s+-rf|chmod\s+777|format\s+c:)\b/i,
    /curl\s+[^\n|]+\|\s*(?:sh|bash|zsh)/i,
    /###\s*SYSTEM\b/i,
];

export interface ParseResult {
    payload: RawUpdatePayload;
    canonicalHash: string;
    warnings: string[];
}

export function extractPactxBlock(content: string): string {
    const match = content.match(/```(?:pactx-update|yaml:pactx-update)\s*\r?\n([\s\S]*?)\r?\n```/i);
    if (!match) {
        try {
            const parsed = yaml.parse(content);
            if (parsed && typeof parsed === 'object' && parsed.version) {
                return content;
            }
        } catch {
            // continua para lançar erro padronizado
        }
        throw new Error(
            'No valid ```pactx-update``` block was found in the provided clipboard/content.\n\n' +
            '👉 Tip: Ask your AI in chat:\n' +
            '   "/handoff" (or "Generate the pactx-update block for this session")\n' +
            '   and copy its response before running \'pactx update\'.'
        );
    }
    return match[1].trim();
}

export function ensureStringArray(val: unknown): string[] {
    if (!val) return [];
    if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length > 0 ? [trimmed] : [];
    }
    if (Array.isArray(val)) {
        return val
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map(s => s.trim());
    }
    return [];
}

function ensureBoundedStringArray(
    val: unknown,
    fieldName: string,
    warnings: string[],
    maxItems = MAX_ARRAY_ITEMS,
    maxLength = MAX_STRING_LENGTH
): string[] {
    const arr = ensureStringArray(val);
    if (arr.length > maxItems) {
        warnings.push(`Limit exceeded: [${fieldName}] contained ${arr.length} items and was truncated to the first ${maxItems}.`);
    }
    return arr.slice(0, maxItems).map(item => {
        if (item.length > maxLength) {
            warnings.push(`Item in [${fieldName}] exceeded ${maxLength} characters and was truncated.`);
            return item.substring(0, maxLength);
        }
        return item;
    });
}

export function normalizeForScanning(text: string): string[] {
    if (!text) return [];
    const replaced = text.replace(/[\u0430\u0410\u0435\u0415\u043E\u041E\u0440\u0420\u0441\u0421\u0445\u0425\u0443\u0423\u0456\u0406\u0458\u0408]/g, char => HOMOGLYPH_MAP[char] || char);
    const invisibles = /[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E\u200E\u200F]/g;
    const formStripped = replaced.replace(invisibles, '').normalize('NFKD').replace(/\s+/g, ' ').trim();
    const formSpaced = replaced.replace(invisibles, ' ').normalize('NFKD').replace(/\s+/g, ' ').trim();
    return Array.from(new Set([text, formStripped, formSpaced]));
}

function safeSortAndNormalize(o: unknown): unknown {
    if (o === null || typeof o !== 'object') {
        if (typeof o === 'string') return o.replace(/\r\n/g, '\n').normalize('NFC').trim();
        return o;
    }
    if (Array.isArray(o)) return o.map(safeSortAndNormalize);

    return Object.keys(o)
        .filter(key => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = safeSortAndNormalize((o as Record<string, unknown>)[key]);
            return acc;
        }, Object.create(null));
}

export function computeCanonicalHash(obj: unknown): string {
    const normalized = JSON.stringify(safeSortAndNormalize(obj));
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function parseAndValidateUpdate(rawContent: string): ParseResult {
    // Validação de limite de tamanho de input (H-02)
    const inputBytes = Buffer.byteLength(rawContent, 'utf-8');
    if (inputBytes > MAX_INPUT_SIZE) {
        throw new Error(`Input size (${(inputBytes / 1024).toFixed(1)}KB) exceeds the maximum allowed limit of ${MAX_INPUT_SIZE / 1024}KB.`);
    }

    const yamlText = extractPactxBlock(rawContent);
    let parsed: any;

    try {
        parsed = yaml.parse(yamlText);
    } catch (err: any) {
        throw new Error(`YAML syntax failure in pactx-update block: ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('The pactx-update block must contain a structured YAML object.');
    }

    const parsedVersion = String(parsed.version ?? '').trim();
    if (parsedVersion !== '1.0' && parsedVersion !== '1' && parsedVersion !== '1.1') {
        throw new Error(`Unsupported schema version: "${parsed.version}". Expected: "1.0" or "1.1".`);
    }
    parsed.version = parsedVersion === '1.1' ? '1.1' : '1.0';

    const warnings: string[] = [];

    // Normalização de metadados de proveniência (source) com default 'conversation'
    if (parsed.source && typeof parsed.source === 'object') {
        if (parsed.source.type !== undefined && parsed.source.type !== null) {
            const typeStr = String(parsed.source.type).trim().toLowerCase();
            if (!VALID_SOURCE_TYPES.includes(typeStr as any)) {
                throw new Error(`Invalid source.type: "${parsed.source.type}". Allowed values: ${VALID_SOURCE_TYPES.join(', ')}.`);
            }
            parsed.source.type = typeStr;
        } else {
            parsed.source.type = 'conversation';
        }
    }

    // Proteção de Tipagem Defensiva e Contenção de Cardinalidade para Coleções de Estado
    if (parsed.state && typeof parsed.state === 'object') {
        if (parsed.state.completed_items !== undefined) {
            parsed.state.completed_items = ensureBoundedStringArray(parsed.state.completed_items, 'state.completed_items', warnings);
        }
        if (parsed.state.new_facts !== undefined) {
            parsed.state.new_facts = ensureBoundedStringArray(parsed.state.new_facts, 'state.new_facts', warnings);
        }
        if (parsed.state.rejected_hypotheses !== undefined) {
            parsed.state.rejected_hypotheses = ensureBoundedStringArray(parsed.state.rejected_hypotheses, 'state.rejected_hypotheses', warnings);
        }

        // Validação de Enum para status
        if (parsed.state.status !== undefined && parsed.state.status !== null) {
            const statusStr = String(parsed.state.status).trim();
            if (!VALID_STATUSES.includes(statusStr as any)) {
                throw new Error(`Invalid status: "${parsed.state.status}". Allowed values: ${VALID_STATUSES.join(', ')}.`);
            }
            parsed.state.status = statusStr;
        }

        // Validação de Enum para recommended_model
        if (parsed.state.recommended_model !== undefined && parsed.state.recommended_model !== null) {
            const modelStr = String(parsed.state.recommended_model).trim();
            if (!VALID_MODELS.includes(modelStr as any)) {
                throw new Error(`Invalid recommended_model: "${parsed.state.recommended_model}". Allowed values: ${VALID_MODELS.join(', ')}.`);
            }
            parsed.state.recommended_model = modelStr;
        }
    }

    // 1. Validação de Requisitos (new_requirements)
    if (parsed.new_requirements && Array.isArray(parsed.new_requirements)) {
        if (parsed.new_requirements.length > MAX_REQUIREMENTS_PER_BATCH) {
            warnings.push(`Limit exceeded: [new_requirements] contained ${parsed.new_requirements.length} items and was truncated to the first ${MAX_REQUIREMENTS_PER_BATCH}.`);
            parsed.new_requirements = parsed.new_requirements.slice(0, MAX_REQUIREMENTS_PER_BATCH);
        }
        for (const r of parsed.new_requirements) {
            if (r && typeof r === 'object') {
                if (r.id !== undefined && r.id !== null) {
                    const idStr = String(r.id).trim();
                    if (!REQ_ID_REGEX.test(idStr)) {
                        throw new Error(`Invalid requirement identifier: "${r.id}". Must match /^(auto|REQ-(?!0+$)\\d{3,4})$/i.`);
                    }
                    r.id = idStr.toLowerCase() === 'auto' ? 'auto' : idStr.toUpperCase();
                }
                if (r.type !== undefined && r.type !== null) {
                    const typeStr = String(r.type).trim().toLowerCase();
                    if (!VALID_REQ_TYPES.includes(typeStr as any)) {
                        throw new Error(`Invalid requirement type: "${r.type}". Allowed values: ${VALID_REQ_TYPES.join(', ')}.`);
                    }
                    r.type = typeStr;
                } else {
                    r.type = 'functional';
                }
                r.title = r.title ? String(r.title).trim() : 'Untitled Requirement';
                r.statement = r.statement ? String(r.statement).trim() : '';
            }
        }
    }

    // 2. Validação de Segurança dos Identificadores de ADR (Path Traversal Jail) e Cardinalidade
    if (parsed.new_decisions && Array.isArray(parsed.new_decisions)) {
        if (parsed.new_decisions.length > MAX_DECISIONS_PER_BATCH) {
            warnings.push(`Limit exceeded: [new_decisions] contained ${parsed.new_decisions.length} items and was truncated to the first ${MAX_DECISIONS_PER_BATCH}.`);
            parsed.new_decisions = parsed.new_decisions.slice(0, MAX_DECISIONS_PER_BATCH);
        }
        for (const d of parsed.new_decisions) {
            if (d && typeof d === 'object' && d.id !== undefined && d.id !== null) {
                const idStr = String(d.id).trim();
                if (!ADR_ID_REGEX.test(idStr)) {
                    throw new Error(`Invalid decision identifier: "${d.id}". Must match /^(auto|DEC-(?!0+$)\\d{3,4})$/i.`);
                }
                d.id = idStr.toLowerCase() === 'auto' ? 'auto' : idStr.toUpperCase();
            }
            if (d && typeof d === 'object' && d.satisfies !== undefined && d.satisfies !== null) {
                const satList = ensureStringArray(d.satisfies);
                for (const satId of satList) {
                    if (!REQ_ID_REGEX.test(satId) || satId.toLowerCase() === 'auto') {
                        throw new Error(`Invalid requirement identifier in satisfies: "${satId}". Must match /^REQ-(?!0+$)\\d{3,4}$/i.`);
                    }
                }
                d.satisfies = satList.map(s => s.toUpperCase());
            }
        }
    }

    if (parsed.superseded_decisions && Array.isArray(parsed.superseded_decisions)) {
        if (parsed.superseded_decisions.length > MAX_DECISIONS_PER_BATCH) {
            warnings.push(`Limit exceeded: [superseded_decisions] contained ${parsed.superseded_decisions.length} items and was truncated to the first ${MAX_DECISIONS_PER_BATCH}.`);
            parsed.superseded_decisions = parsed.superseded_decisions.slice(0, MAX_DECISIONS_PER_BATCH);
        }
        for (const d of parsed.superseded_decisions) {
            if (!d || typeof d !== 'object' || !d.id) {
                throw new Error(`Invalid superseded decision identifier: "${d?.id}". Must match /^(auto|DEC-(?!0+$)\\d{3,4})$/i.`);
            }
            const idStr = String(d.id).trim();
            if (!ADR_ID_REGEX.test(idStr)) {
                throw new Error(`Invalid superseded decision identifier: "${d.id}". Must match /^(auto|DEC-(?!0+$)\\d{3,4})$/i.`);
            }
            d.id = idStr.toUpperCase();

            if (d.by !== undefined && d.by !== null) {
                const byStr = String(d.by).trim();
                if (!ADR_ID_REGEX.test(byStr)) {
                    throw new Error(`Invalid identifier in "by": "${d.by}". Must match /^(auto|DEC-(?!0+$)\\d{3,4})$/i.`);
                }
                d.by = byStr.toLowerCase() === 'auto' ? 'auto' : byStr.toUpperCase();
            }
        }
    }

    if (parsed.new_glossary_terms && Array.isArray(parsed.new_glossary_terms)) {
        if (parsed.new_glossary_terms.length > MAX_GLOSSARY_TERMS_PER_BATCH) {
            warnings.push(`Limit exceeded: [new_glossary_terms] contained ${parsed.new_glossary_terms.length} items and was truncated to the first ${MAX_GLOSSARY_TERMS_PER_BATCH}.`);
            parsed.new_glossary_terms = parsed.new_glossary_terms.slice(0, MAX_GLOSSARY_TERMS_PER_BATCH);
        }
    }

    // 2. Scanner Heurístico Universal Recursivo com Normalização Anti-Evasão
    const scanRecursively = (node: any, currentPath: string = '') => {
        if (typeof node === 'string') {
            const variants = normalizeForScanning(node);
            for (const pattern of SUSPICIOUS_PATTERNS) {
                if (variants.some(v => pattern.test(v))) {
                    warnings.push(`Suspicious pattern detected in [${currentPath}]: "${node.substring(0, 60)}..."`);
                    break;
                }
            }
        } else if (Array.isArray(node)) {
            node.forEach((item, index) => scanRecursively(item, `${currentPath}[${index}]`));
        } else if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
                const nextPath = currentPath ? `${currentPath}.${key}` : key;
                scanRecursively(value, nextPath);
            }
        }
    };

    scanRecursively(parsed);

    const canonicalHash = computeCanonicalHash(parsed);

    return {
        payload: parsed as RawUpdatePayload,
        canonicalHash,
        warnings,
    };
}