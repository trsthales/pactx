import yaml from 'yaml';
import crypto from 'node:crypto';
import { RawUpdatePayload } from './types';

const ADR_ID_REGEX = /^(auto|DEC-\d{3,4})$/i;

const SUSPICIOUS_PATTERNS = [
    /ignore\s+(previous|all)\s+instructions/i,
    /system\s+prompt\s+override/i,
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
        // Tenta também se o payload for fornecido como YAML direto sem fences
        try {
            const parsed = yaml.parse(content);
            if (parsed && typeof parsed === 'object' && parsed.version) {
                return content;
            }
        } catch {
            // Ignora erro e lança exceção padronizada abaixo
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

    // Validação de Segurança dos Identificadores de ADR (Path Traversal Jail)
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

    // Scanner Heurístico Anti-Poisoning
    const checkText = (val: string, location: string) => {
        if (typeof val !== 'string') return;
        for (const pattern of SUSPICIOUS_PATTERNS) {
            if (pattern.test(val)) {
                warnings.push(`Conteúdo suspeito detectado em [${location}]: padrão "${pattern.source}" encontrado.`);
            }
        }
    };

    if (parsed.state) {
        if (parsed.state.rejected_hypotheses) {
            parsed.state.rejected_hypotheses.forEach((h: string) => checkText(h, 'state.rejected_hypotheses'));
        }
        if (parsed.state.new_facts) {
            parsed.state.new_facts.forEach((f: string) => checkText(f, 'state.new_facts'));
        }
    }

    const canonicalHash = computeCanonicalHash(parsed);

    return {
        payload: parsed as RawUpdatePayload,
        canonicalHash,
        warnings,
    };
}