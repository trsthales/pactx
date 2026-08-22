import yaml from 'yaml';
import crypto from 'node:crypto';
import { RawUpdatePayload } from './types';

const ADR_ID_REGEX = /^(auto|DEC-\d{3,4})$/i;
const MAX_INPUT_SIZE = 512 * 1024; // 512KB

const VALID_STATUSES = ['IN_PROGRESS', 'BLOCKED', 'COMPLETED'] as const;
const VALID_MODELS = ['Medium', 'High'] as const;

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
        throw new Error('Nenhum bloco ```pactx-update``` válido foi encontrado no conteúdo fornecido.');
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
        throw new Error(`Tamanho do input (${(inputBytes / 1024).toFixed(1)}KB) excede o limite máximo permitido de ${MAX_INPUT_SIZE / 1024}KB.`);
    }

    const yamlText = extractPactxBlock(rawContent);
    let parsed: any;

    try {
        parsed = yaml.parse(yamlText);
    } catch (err: any) {
        throw new Error(`Falha de sintaxe no YAML do pactx-update: ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('O bloco pactx-update deve conter um objeto YAML estruturado.');
    }

    const parsedVersion = String(parsed.version ?? '').trim();
    if (parsedVersion !== '1.0' && parsedVersion !== '1') {
        throw new Error(`Versão de schema não suportada: "${parsed.version}". Esperado: "1.0".`);
    }
    parsed.version = '1.0';

    const warnings: string[] = [];

    // Proteção de Tipagem Defensiva para Coleções e Enums de Estado
    if (parsed.state && typeof parsed.state === 'object') {
        if (parsed.state.completed_items !== undefined) {
            parsed.state.completed_items = ensureStringArray(parsed.state.completed_items);
        }
        if (parsed.state.new_facts !== undefined) {
            parsed.state.new_facts = ensureStringArray(parsed.state.new_facts);
        }
        if (parsed.state.rejected_hypotheses !== undefined) {
            parsed.state.rejected_hypotheses = ensureStringArray(parsed.state.rejected_hypotheses);
        }

        // Validação de Enum para status
        if (parsed.state.status !== undefined && parsed.state.status !== null) {
            const statusStr = String(parsed.state.status).trim();
            if (!VALID_STATUSES.includes(statusStr as any)) {
                warnings.push(`Status inválido: "${parsed.state.status}". Usando "IN_PROGRESS".`);
                parsed.state.status = 'IN_PROGRESS';
            } else {
                parsed.state.status = statusStr;
            }
        }

        // Validação de Enum para recommended_model
        if (parsed.state.recommended_model !== undefined && parsed.state.recommended_model !== null) {
            const modelStr = String(parsed.state.recommended_model).trim();
            if (!VALID_MODELS.includes(modelStr as any)) {
                warnings.push(`recommended_model inválido: "${parsed.state.recommended_model}". Usando "Medium".`);
                parsed.state.recommended_model = 'Medium';
            } else {
                parsed.state.recommended_model = modelStr;
            }
        }
    }

    // 1. Validação de Segurança dos Identificadores de ADR (Path Traversal Jail)
    if (parsed.new_decisions && Array.isArray(parsed.new_decisions)) {
        for (const d of parsed.new_decisions) {
            if (d && typeof d === 'object' && d.id !== undefined && d.id !== null) {
                const idStr = String(d.id).trim();
                if (!ADR_ID_REGEX.test(idStr)) {
                    throw new Error(`Identificador de decisão inválido: "${d.id}". Deve casar com /^(auto|DEC-\\d{3,4})$/i.`);
                }
                d.id = idStr;
            }
        }
    }

    if (parsed.superseded_decisions && Array.isArray(parsed.superseded_decisions)) {
        for (const d of parsed.superseded_decisions) {
            if (!d || typeof d !== 'object' || !d.id) {
                throw new Error(`Identificador de decisão substituída inválido: "${d?.id}". Deve casar com /^(auto|DEC-\\d{3,4})$/i.`);
            }
            const idStr = String(d.id).trim();
            if (!ADR_ID_REGEX.test(idStr)) {
                throw new Error(`Identificador de decisão substituída inválido: "${d.id}". Deve casar com /^(auto|DEC-\\d{3,4})$/i.`);
            }
            d.id = idStr;

            if (d.by !== undefined && d.by !== null) {
                const byStr = String(d.by).trim();
                if (!ADR_ID_REGEX.test(byStr)) {
                    throw new Error(`Identificador em "by" inválido: "${d.by}". Deve casar com /^(auto|DEC-\\d{3,4})$/i.`);
                }
                d.by = byStr;
            }
        }
    }

    // 2. Scanner Heurístico Universal Recursivo com Normalização Anti-Evasão
    const scanRecursively = (node: any, currentPath: string = '') => {
        if (typeof node === 'string') {
            const variants = normalizeForScanning(node);
            for (const pattern of SUSPICIOUS_PATTERNS) {
                if (variants.some(v => pattern.test(v))) {
                    warnings.push(`Padrão suspeito detectado em [${currentPath}]: "${node.substring(0, 60)}..."`);
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