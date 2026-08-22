import yaml from 'yaml';
import crypto from 'node:crypto';
import { RawUpdatePayload } from './types';

const ADR_ID_REGEX = /^(auto|DEC-\d{3,4})$/i;

// Padrões mais flexíveis e resilientes para Prompt Injection Heuristics
const SUSPICIOUS_PATTERNS = [
    /(?:ignore|disregard|forget|bypass|override)\s+(?:all\s+)?(?:previous|prior|above|system)?\s*(?:instructions|prompts?|rules|directives)/i,
    /system\s+prompt\s+override/i,
    /(?:rm\s+-rf|curl\s+.*\|\s*sh|chmod\s+777|format\s+c:)/i,
    /###\s*SYSTEM/i,
];

export interface ParseResult {
    payload: RawUpdatePayload;
    canonicalHash: string;
    warnings: string[];
}

export function extractPactxBlock(content: string): string {
    const match = content.match(/```(?:pactx-update|yaml:pactx-update)\s*\n([\s\S]*?)\n```/i);
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

function computeCanonicalHash(obj: any): string {
    const sortObject = (o: any): any => {
        if (o === null || typeof o !== 'object') return o;
        if (Array.isArray(o)) return o.map(sortObject);
        return Object.keys(o)
            .sort()
            .reduce((acc: any, key: string) => {
                acc[key] = sortObject(o[key]);
                return acc;
            }, {});
    };
    const normalized = JSON.stringify(sortObject(obj));
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function parseAndValidateUpdate(rawContent: string): ParseResult {
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

    if (parsed.version !== '1.0') {
        throw new Error(`Versão de schema não suportada: "${parsed.version}". Esperado: "1.0".`);
    }

    const warnings: string[] = [];

    // 1. Validação de Segurança dos Identificadores de ADR (Path Traversal Jail)
    if (parsed.new_decisions && Array.isArray(parsed.new_decisions)) {
        for (const d of parsed.new_decisions) {
            if (d.id && !ADR_ID_REGEX.test(d.id.trim())) {
                throw new Error(`Identificador de decisão inválido: "${d.id}". Deve casar com /^(auto|DEC-\\d{3,4})$/i.`);
            }
        }
    }

    if (parsed.superseded_decisions && Array.isArray(parsed.superseded_decisions)) {
        for (const d of parsed.superseded_decisions) {
            if (!d.id || !ADR_ID_REGEX.test(d.id.trim())) {
                throw new Error(`Identificador de decisão substituída inválido: "${d.id}". Deve casar com /^(auto|DEC-\\d{3,4})$/i.`);
            }
            if (d.by && !ADR_ID_REGEX.test(d.by.trim())) {
                throw new Error(`Identificador em "by" inválido: "${d.by}". Deve casar com /^(auto|DEC-\\d{3,4})$/i.`);
            }
        }
    }

    // 2. Scanner Heurístico Universal Recursivo (Varre 100% dos campos de texto do payload)
    const scanRecursively = (node: any, currentPath: string = '') => {
        if (typeof node === 'string') {
            for (const pattern of SUSPICIOUS_PATTERNS) {
                if (pattern.test(node)) {
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