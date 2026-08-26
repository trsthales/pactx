import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'yaml';
import { MutationPlan, HistoryLedger, RequirementItem, CreatedFileEntry } from './types';
import { ContextLock } from './lock';
import { getCurrentContextRevision } from '../composer';
import { getNextAdrId } from './planner';
import { ensureStorageLayout } from './migration';
import { TransactionEngine } from './transaction';

const MAX_HISTORY_ENTRIES = 500;

export function safeAtomicWriteFileSync(
    filePath: string,
    content: string,
    encoding: BufferEncoding = 'utf-8'
): void {
    // 1. Verificação de Segurança (Anti-Symlink & Anti-Hardlink)
    try {
        const stat = fs.lstatSync(filePath);
        if (stat.isSymbolicLink()) {
            throw new Error(`Security violation: "${filePath}" is a symbolic link. Write rejected.`);
        }
        if (stat.isFile() && stat.nlink > 1) {
            fs.unlinkSync(filePath);
        }
    } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
    }

    // 2. Escrita em Arquivo Temporário no MESMO diretório (garante mesmo mount/volume de FS)
    const dir = path.dirname(filePath);
    const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);

    try {
        fs.writeFileSync(tempPath, content, encoding);
        // 3. Rename Atômico (Substituição instantânea no nível do SO/POSIX/NTFS)
        fs.renameSync(tempPath, filePath);
    } catch (err) {
        // Limpeza de arquivo temporário órfão em caso de erro
        if (fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch {}
        }
        throw err;
    }
}

export const safeWriteFileSync = safeAtomicWriteFileSync;

export function sanitizeBodyField(val: string): string {
    if (typeof val !== 'string' || !val) return '';
    let sanitized = val
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => {
            const trimmed = line.trim();
            // Neutraliza cabeçalhos markdown (# a ######) transformando em citações
            if (/^#{1,6}\s/.test(trimmed)) {
                return line.replace(/^(\s*)#{1,6}\s*/, '$1> ');
            }
            // Remove réguas horizontais que possam quebrar a hierarquia do documento
            if (/^[-*_]{3,}\s*$/.test(trimmed)) {
                return '';
            }
            // Neutraliza cercas de código de bloco
            if (/^`{3,}/.test(trimmed)) {
                return line.replace(/`/g, "'");
            }
            return line;
        })
        .join('\n')
        .trim();

    // Neutraliza comentários e tags de sistema que possam manipular parsers de LLMs downstream (P0-01)
    sanitized = sanitized
        .replace(/<!--/g, '&lt;!--')
        .replace(/-->/g, '--&gt;')
        .replace(/<\/?(system|instruction|context|rules|prompt|pactx)[^>]*>/gi, '[tag-escaped]');

    return sanitized;
}

function normalizeLine(line: string): string {
    return line.replace(/^[-*•]\s*/, '').trim().normalize('NFC').toLowerCase();
}

export function applyMutationPlan(cwd: string, plan: MutationPlan): void {
    const contextDir = path.join(cwd, '.ai-context');
    const decisionsDir = path.join(contextDir, 'decisions');

    if (!fs.existsSync(decisionsDir)) {
        fs.mkdirSync(decisionsDir, { recursive: true });
    }

    ensureStorageLayout(contextDir);
    const historyFile = path.join(contextDir, '.pactx', 'ledger.json');

    const lock = new ContextLock(contextDir);
    lock.acquire();

    // [P1-03] Trava de segurança: impede novas mutações se houver transações que requerem recuperação
    const pendingRecovery = TransactionEngine.hasPendingRecovery(contextDir);
    if (pendingRecovery) {
        lock.release();
        throw new Error(`Repository blocked: Transaction TX-${pendingRecovery.txHash} requires recovery (Status: ${pendingRecovery.status}). Run 'pactx doctor --fix' or resolve manually before mutating.`);
    }

    // Revalidação Obrigatória de Concorrência Otimista (Final OCC Check) sob Lock
    const currentRev = getCurrentContextRevision(contextDir);
    if (plan.baseRevision && plan.baseRevision !== currentRev) {
        if (!plan.isForced) {
            lock.release();
            throw new Error(
                `Conflict: Stale context detected under lock. Repository revision changed from "${plan.baseRevision}" to "${currentRev}". Use --force to override.`
            );
        }
    }
    plan.appliedRevision = currentRev;

    // Snapshot em Memória para Rollback Transacional
    const snapshot = new Map<string, string | null>(); // path -> content (null se arquivo não existia)
    const createdFiles: CreatedFileEntry[] = [];

    const recordSnapshot = (filePath: string) => {
        if (!snapshot.has(filePath)) {
            snapshot.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null);
        }
    };

    const rollback = () => {
        for (const [filePath, origContent] of snapshot.entries()) {
            try {
                if (origContent === null) {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } else {
                    safeAtomicWriteFileSync(filePath, origContent, 'utf-8');
                }
            } catch {}
        }
    };

    let isApplying = true;
    const handleSignal = () => {
        if (isApplying) {
            rollback();
            try {
                TransactionEngine.markRolledBack(contextDir, plan.canonicalHash);
            } catch {}
            lock.release();
            process.exit(130);
        }
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    process.on('SIGHUP', handleSignal);

    try {
        // 0. Resolução definitiva de IDs de ADRs automáticos sob ContextLock (Anti-TOCTOU)
        const allocatedUnderLock = new Set<string>();
        const idMapping = new Map<string, string>();

        // Registra IDs explícitos primeiro para evitar que auto ocupe um ID explícito do mesmo lote
        for (const adr of plan.operations.createdAdrs) {
            if (!adr.isAuto) {
                const targetPath = path.resolve(decisionsDir, `${adr.id}.md`);
                if (fs.existsSync(targetPath)) {
                    throw new Error(`Conflict: Decision ${adr.id} already exists in the repository.`);
                }
                allocatedUnderLock.add(adr.id);
            }
        }

        let currentNextNum = 0;
        for (const adr of plan.operations.createdAdrs) {
            if (adr.isAuto) {
                if (currentNextNum === 0) {
                    const nextStr = getNextAdrId(decisionsDir);
                    currentNextNum = parseInt(nextStr.replace('DEC-', ''), 10);
                } else {
                    currentNextNum++;
                }
                while (
                    allocatedUnderLock.has(`DEC-${currentNextNum.toString().padStart(3, '0')}`) ||
                    fs.existsSync(path.resolve(decisionsDir, `DEC-${currentNextNum.toString().padStart(3, '0')}.md`))
                ) {
                    currentNextNum++;
                }
                if (currentNextNum > 9999) {
                    throw new Error('ADR ID limit reached (DEC-9999).');
                }
                const newId = `DEC-${currentNextNum.toString().padStart(3, '0')}`;
                const oldId = adr.id;
                if (oldId !== newId) {
                    idMapping.set(oldId, newId);
                }
                adr.id = newId;
                adr.targetPath = path.resolve(decisionsDir, `${newId}.md`);
                allocatedUnderLock.add(newId);
            }
        }

        if (idMapping.size > 0) {
            for (const s of plan.operations.supersededAdrs) {
                if (idMapping.has(s.supersededBy)) {
                    s.supersededBy = idMapping.get(s.supersededBy)!;
                }
            }
            for (const upd of plan.operations.updatedRequirements) {
                if (upd.satisfiedByAdd) {
                    upd.satisfiedByAdd = upd.satisfiedByAdd.map(id => idMapping.get(id) || id);
                }
                if (upd.satisfiedByRemove) {
                    upd.satisfiedByRemove = upd.satisfiedByRemove.map(id => idMapping.get(id) || id);
                }
            }
        }

        const requirementsPath = path.join(contextDir, 'requirements.md');

        // Pré-gravação de Snapshot Completo para WAL e cálculo de afterHash para createdFiles (P1-04)
        for (const adr of plan.operations.createdAdrs || []) {
            recordSnapshot(adr.targetPath);
            if (snapshot.get(adr.targetPath) === null) {
                const frontmatter: any = {
                    spec_version: '1.0',
                    id: adr.id,
                    title: sanitizeBodyField(adr.title),
                    status: 'active',
                };
                if (adr.satisfies && adr.satisfies.length > 0) {
                    frontmatter.satisfies = adr.satisfies;
                }
                frontmatter.date = adr.date;
                const frontmatterYaml = yaml.stringify(frontmatter).trim();
                const sanitizedDecision = sanitizeBodyField(adr.decision);
                const sanitizedReason = sanitizeBodyField(adr.reason);
                const body = `# Decision\n${sanitizedDecision}\n\n# Reason\n${sanitizedReason}\n`;
                const fullContent = `---\n${frontmatterYaml}\n---\n\n${body}`;
                const afterHash = crypto.createHash('sha256').update(fullContent).digest('hex');
                createdFiles.push({
                    relativePath: path.relative(contextDir, adr.targetPath).replace(/\\/g, '/'),
                    afterHash,
                });
            }
        }
        for (const adr of plan.operations.supersededAdrs || []) {
            recordSnapshot(adr.targetPath);
        }
        if ((plan.operations.createdRequirements?.length ?? 0) > 0 || (plan.operations.updatedRequirements?.length ?? 0) > 0 || fs.existsSync(requirementsPath)) {
            recordSnapshot(requirementsPath);
            if (snapshot.get(requirementsPath) === null) {
                createdFiles.push({
                    relativePath: path.relative(contextDir, requirementsPath).replace(/\\/g, '/'),
                    afterHash: '',
                });
            }
        }
        if (plan.operations.stateUpdate) {
            recordSnapshot(plan.operations.stateUpdate.targetPath);
        }
        if ((plan.operations.appendedGlossaryTerms?.length ?? 0) > 0) {
            recordSnapshot(path.join(contextDir, 'glossary.md'));
        }
        recordSnapshot(historyFile);

        // WAL: 1. PREPARED -> 2. APPLYING
        const baseRevision = plan.appliedRevision || getCurrentContextRevision(contextDir);
        TransactionEngine.createTransaction(contextDir, plan, snapshot, createdFiles, baseRevision);
        TransactionEngine.markApplying(contextDir, plan.canonicalHash);

        // 1. Criar Novos ADRs com Serialização Segura & Sanitização de Body
        for (const adr of plan.operations.createdAdrs || []) {
            const frontmatter: any = {
                spec_version: '1.0',
                id: adr.id,
                title: sanitizeBodyField(adr.title),
                status: 'active',
            };
            if (adr.satisfies && adr.satisfies.length > 0) {
                frontmatter.satisfies = adr.satisfies;
            }
            frontmatter.date = adr.date;

            const frontmatterYaml = yaml.stringify(frontmatter).trim();
            const sanitizedDecision = sanitizeBodyField(adr.decision);
            const sanitizedReason = sanitizeBodyField(adr.reason);
            const body = `# Decision\n${sanitizedDecision}\n\n# Reason\n${sanitizedReason}\n`;
            const fullContent = `---\n${frontmatterYaml}\n---\n\n${body}`;

            safeAtomicWriteFileSync(adr.targetPath, fullContent, 'utf-8');
        }

        // 2. Atualizar ADRs Substituídos
        for (const adr of plan.operations.supersededAdrs || []) {
            if (fs.existsSync(adr.targetPath)) {
                recordSnapshot(adr.targetPath);
                const original = fs.readFileSync(adr.targetPath, 'utf-8');

                // Parse seguro do frontmatter existente com suporte a CRLF
                const match = original.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
                if (match) {
                    const data = yaml.parse(match[1]) || {};
                    data.status = 'superseded';
                    data.superseded_by = adr.supersededBy;
                    data.superseded_date = adr.date;
                    if (adr.reason) {
                        data.superseded_reason = sanitizeBodyField(adr.reason);
                    }

                    const newFrontmatter = yaml.stringify(data).trim();
                    const newContent = `---\n${newFrontmatter}\n---\n${match[2]}`;
                    safeAtomicWriteFileSync(adr.targetPath, newContent, 'utf-8');
                } else {
                    throw new Error(`Invalid or corrupted frontmatter structure in ADR: ${adr.targetPath}`);
                }
            }
        }

        // 2.5. Atualizar requirements.md (Semântica de PATCH: preserva requisitos existentes)
        if ((plan.operations.createdRequirements?.length ?? 0) > 0 || (plan.operations.updatedRequirements?.length ?? 0) > 0) {
            let existingReqs: RequirementItem[] = [];
            const existingBodyStatements = new Map<string, string>();
            let existingSpecVersion = '1.0';

            if (fs.existsSync(requirementsPath)) {
                const raw = fs.readFileSync(requirementsPath, 'utf-8');
                const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (fmMatch) {
                    try {
                        const parsedFm = yaml.parse(fmMatch[1]);
                        if (parsedFm) {
                            if (parsedFm.spec_version) existingSpecVersion = String(parsedFm.spec_version);
                            if (Array.isArray(parsedFm.requirements)) existingReqs = parsedFm.requirements;
                        }
                    } catch {}
                }
                const bodyText = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
                const sections = bodyText.split(/(?=^###\s*\[REQ-\d+\])/m);
                for (const sec of sections) {
                    const headerMatch = sec.match(/^###\s*\[(REQ-\d+)\][^\r\n]*/i);
                    if (headerMatch) {
                        const reqId = headerMatch[1].toUpperCase();
                        const statementText = sec.replace(/^###\s*\[REQ-\d+\][^\r\n]*\r?\n?/, '').trim();
                        existingBodyStatements.set(reqId, statementText);
                    }
                }
            }

            // Merge created requirements
            for (const req of plan.operations.createdRequirements || []) {
                const existingIdx = existingReqs.findIndex(r => r.id.toUpperCase() === req.id.toUpperCase());
                if (existingIdx >= 0) {
                    existingReqs[existingIdx] = {
                        ...existingReqs[existingIdx],
                        type: req.type,
                        title: req.title,
                        status: req.status,
                    };
                } else {
                    existingReqs.push({ ...req });
                }
                existingBodyStatements.set(req.id.toUpperCase(), sanitizeBodyField(req.statement));
            }

            // Merge updated requirements (e.g. satisfied_by from ADRs)
            for (const upd of plan.operations.updatedRequirements || []) {
                const existingReq = existingReqs.find(r => r.id.toUpperCase() === upd.id.toUpperCase());
                if (existingReq) {
                    if (upd.satisfiedByRemove && upd.satisfiedByRemove.length > 0) {
                        if (existingReq.satisfied_by) {
                            const removeSet = new Set(upd.satisfiedByRemove.map(id => id.toUpperCase()));
                            existingReq.satisfied_by = existingReq.satisfied_by.filter(id => !removeSet.has(id.toUpperCase()));
                        }
                    }
                    if (upd.satisfiedByAdd && upd.satisfiedByAdd.length > 0) {
                        if (!existingReq.satisfied_by) existingReq.satisfied_by = [];
                        for (const adrId of upd.satisfiedByAdd) {
                            if (!existingReq.satisfied_by.includes(adrId)) {
                                existingReq.satisfied_by.push(adrId);
                            }
                        }
                    }
                    if (upd.status) {
                        existingReq.status = upd.status;
                    }
                }
            }

            const reqFrontmatter = {
                spec_version: existingSpecVersion,
                requirements: existingReqs.map(r => {
                    const obj: any = {
                        id: r.id,
                        status: r.status || 'active',
                        type: r.type || 'functional',
                        title: sanitizeBodyField(r.title),
                    };
                    if (r.satisfied_by && r.satisfied_by.length > 0) {
                        obj.satisfied_by = r.satisfied_by;
                    }
                    return obj;
                }),
            };

            const fmYaml = yaml.stringify(reqFrontmatter).trim();
            let reqBody = `# Requirements & Business Rules\n\n`;
            for (const r of existingReqs) {
                const statement = existingBodyStatements.get(r.id.toUpperCase()) || '';
                reqBody += `### [${r.id}] ${sanitizeBodyField(r.title)}\n`;
                if (statement) {
                    reqBody += `${statement}\n\n`;
                } else {
                    reqBody += `\n`;
                }
            }

            safeAtomicWriteFileSync(requirementsPath, `---\n${fmYaml}\n---\n\n${reqBody.trim()}\n`, 'utf-8');
        }

        // 3. Atualizar state.md (Semântica de PATCH: preserva campos não fornecidos)
        let finalActiveTask = '';
        if (plan.operations.stateUpdate) {
            const statePath = plan.operations.stateUpdate.targetPath;
            recordSnapshot(statePath);

            let existingCompleted: string[] = [];
            let existingHypotheses: string[] = [];
            let existingFacts: string[] = [];
            let existingSprint = 'SPRINT_CURRENT';
            let existingStatus: 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' = 'IN_PROGRESS';
            let existingModel: 'Medium' | 'High' = 'Medium';
            let existingActiveTaskFm = '';
            const existingActiveTaskBody: string[] = [];
            const existingNextActionBody: string[] = [];
            const customSections: Array<{ header: string; lines: string[] }> = [];

            const isPlaceholder = (s: string) => /^\([^)]+\)$/.test(s.trim());

            if (fs.existsSync(statePath)) {
                const raw = fs.readFileSync(statePath, 'utf-8');

                // Preserva sprint, status, model e active_task se presentes no frontmatter
                const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (fmMatch) {
                    try {
                        const existingFm = yaml.parse(fmMatch[1]);
                        if (existingFm) {
                            if (existingFm.sprint) existingSprint = String(existingFm.sprint);
                            if (existingFm.status) existingStatus = existingFm.status;
                            if (existingFm.recommended_model) existingModel = existingFm.recommended_model;
                            if (existingFm.active_task) existingActiveTaskFm = String(existingFm.active_task);
                        }
                    } catch {}
                }

                // Remove frontmatter para parsear o corpo do state.md
                const bodyText = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
                const lines = bodyText.split(/\r?\n/);
                let currentSection = '';

                for (const line of lines) {
                    const isHeading = /^#+\s/.test(line.trim());
                    if (isHeading) {
                        const sectionLine = line.replace(/^#+\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
                        if (sectionLine.startsWith('current goal') || sectionLine.startsWith('objetivo atual') || sectionLine.startsWith('goal') || sectionLine.startsWith('objetivo')) {
                            currentSection = 'objective';
                        } else if (sectionLine.startsWith('recently completed') || sectionLine.startsWith('o que foi feito') || sectionLine.startsWith('completed')) {
                            currentSection = 'completed';
                        } else if (sectionLine.startsWith('rejected hypotheses') || sectionLine.startsWith('hipóteses descartadas') || sectionLine.startsWith('hipoteses descartadas') || sectionLine.startsWith('hypotheses')) {
                            currentSection = 'hypotheses';
                        } else if (sectionLine.startsWith('facts') || sectionLine.startsWith('fatos')) {
                            currentSection = 'facts';
                        } else if (sectionLine.startsWith('immediate next action') || sectionLine.startsWith('next action') || sectionLine.startsWith('próxima ação imediata') || sectionLine.startsWith('proxima acao imediata') || sectionLine.startsWith('proxima acao')) {
                            currentSection = 'next_action';
                        } else {
                            // Seção customizada do usuário (P1-01)
                            currentSection = 'custom';
                            customSections.push({ header: line, lines: [] });
                        }
                    } else if (currentSection === 'custom') {
                        if (customSections.length > 0) {
                            customSections[customSections.length - 1].lines.push(line);
                        }
                    } else if (currentSection === 'objective') {
                        if (line.trim() && !isPlaceholder(line)) {
                            existingActiveTaskBody.push(line.trim());
                        }
                    } else if (currentSection === 'next_action') {
                        if (line.trim() && !isPlaceholder(line)) {
                            existingNextActionBody.push(line.trim());
                        }
                    } else if (line.trim().startsWith('-')) {
                        const clean = line.replace(/^-\s*(\[[ x]\])?\s*/, '').trim();
                        if (clean && !isPlaceholder(clean)) {
                            if (currentSection === 'completed') existingCompleted.push(clean);
                            if (currentSection === 'hypotheses') existingHypotheses.push(clean);
                            if (currentSection === 'facts') existingFacts.push(clean);
                        }
                    } else if (/^(\s{2,}|\t)/.test(line) && line.trim()) {
                        // Suporte a itens multi-linha indentados (P2-02)
                        const trimmedLine = line.trim();
                        if (currentSection === 'completed' && existingCompleted.length > 0) {
                            existingCompleted[existingCompleted.length - 1] += '\n  ' + trimmedLine;
                        } else if (currentSection === 'hypotheses' && existingHypotheses.length > 0) {
                            existingHypotheses[existingHypotheses.length - 1] += '\n  ' + trimmedLine;
                        } else if (currentSection === 'facts' && existingFacts.length > 0) {
                            existingFacts[existingFacts.length - 1] += '\n  ' + trimmedLine;
                        }
                    }
                }
            }

            // Merge semântico deduplicado
            const mergeUnique = (existing: string[], incoming: string[]) => {
                const result = [...existing];
                for (const item of incoming) {
                    const sanitized = sanitizeBodyField(item);
                    if (!sanitized) continue;
                    const norm = normalizeLine(sanitized);
                    if (!result.some(e => normalizeLine(e) === norm)) {
                        result.push(sanitized);
                    }
                }
                return result;
            };

            const finalCompleted = mergeUnique(existingCompleted, plan.operations.stateUpdate.newCompletedItems);
            const finalHypotheses = mergeUnique(existingHypotheses, plan.operations.stateUpdate.newRejectedHypotheses);
            const finalFacts = mergeUnique(existingFacts, plan.operations.stateUpdate.newFacts);

            const existingActiveTask = existingActiveTaskFm || existingActiveTaskBody.join('\n');
            const existingNextAction = existingNextActionBody.join('\n');

            finalActiveTask = plan.operations.stateUpdate.activeTask !== undefined
                ? sanitizeBodyField(plan.operations.stateUpdate.activeTask)
                : sanitizeBodyField(existingActiveTask);

            const finalStatus = plan.operations.stateUpdate.status !== undefined
                ? plan.operations.stateUpdate.status
                : existingStatus;

            const finalModel = plan.operations.stateUpdate.recommendedModel !== undefined
                ? plan.operations.stateUpdate.recommendedModel
                : existingModel;

            const finalNextAction = plan.operations.stateUpdate.nextAction !== undefined
                ? sanitizeBodyField(plan.operations.stateUpdate.nextAction)
                : sanitizeBodyField(existingNextAction);

            const frontmatter = {
                spec_version: '1.0',
                sprint: existingSprint,
                active_task: finalActiveTask,
                recommended_model: finalModel,
                status: finalStatus,
            };

            const stateFrontmatter = yaml.stringify(frontmatter).trim();

            let stateBody = `# Current Goal\n${finalActiveTask || '(Define goal)'}\n\n`;

            stateBody += `# Recently Completed\n`;
            stateBody += finalCompleted.length > 0 ? finalCompleted.map(c => `- [x] ${c}`).join('\n') + '\n\n' : `- (No items)\n\n`;

            if (finalFacts.length > 0) {
                stateBody += `# Facts & Discoveries\n`;
                stateBody += finalFacts.map(f => `- ${f}`).join('\n') + '\n\n';
            }

            stateBody += `# Rejected Hypotheses / Known Errors (DO NOT RETRY)\n`;
            stateBody += finalHypotheses.length > 0 ? finalHypotheses.map(h => `- ${h}`).join('\n') + '\n\n' : `- (None)\n\n`;

            stateBody += `# Immediate Next Action\n${finalNextAction || '(Define next action)'}\n`;

            // Re-anexa seções customizadas do usuário (P1-01)
            for (const custom of customSections) {
                const content = custom.lines.join('\n').trim();
                stateBody += `\n${custom.header}\n` + (content ? `${content}\n` : '\n');
            }

            safeAtomicWriteFileSync(statePath, `---\n${stateFrontmatter}\n---\n\n${stateBody}`, 'utf-8');
        }

        // 4. Append ao glossary.md
        if (plan.operations.appendedGlossaryTerms.length > 0) {
            const glossaryPath = path.join(contextDir, 'glossary.md');
            recordSnapshot(glossaryPath);

            let content = fs.existsSync(glossaryPath) ? fs.readFileSync(glossaryPath, 'utf-8').trim() : '# Glossary & Contracts';
            for (const term of plan.operations.appendedGlossaryTerms) {
                const cleanTermName = term.term.replace(/[\r\n]+/g, ' ').trim();
                const normalizedTerm = sanitizeBodyField(cleanTermName);
                const sanitizedDefinition = sanitizeBodyField(term.definition.trim());
                if (!content.toLowerCase().includes(`**${normalizedTerm.toLowerCase()}**`)) {
                    content += `\n- **${normalizedTerm}**: ${sanitizedDefinition}`;
                }
            }
            safeAtomicWriteFileSync(glossaryPath, content + '\n', 'utf-8');
        }

        // 5. Atualizar o Ledger de Histórico com Limite de Entradas (Fail-Closed)
        recordSnapshot(historyFile);
        let ledger: HistoryLedger = { version: '1.0', applied_updates: [] };
        if (fs.existsSync(historyFile)) {
            try {
                ledger = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            } catch (err: any) {
                throw new Error(`Integrity failure: The history ledger .pactx/ledger.json is corrupted (${err.message}). Operation aborted.`);
            }
        }

        const appliedRev = plan.appliedRevision || getCurrentContextRevision(contextDir);

        ledger.applied_updates.push({
            hash: plan.canonicalHash,
            applied_at: new Date().toISOString(),
            forced: plan.isForced || false,
            base_revision: plan.baseRevision,
            applied_revision: appliedRev,
            task: finalActiveTask || plan.operations.stateUpdate?.activeTask,
            created_adrs: plan.operations.createdAdrs.map(a => a.id),
            superseded_adrs: plan.operations.supersededAdrs.map(a => a.id),
        });

        // Limita o histórico às últimas MAX_HISTORY_ENTRIES entradas
        if (ledger.applied_updates.length > MAX_HISTORY_ENTRIES) {
            ledger.applied_updates = ledger.applied_updates.slice(-MAX_HISTORY_ENTRIES);
        }

        safeAtomicWriteFileSync(historyFile, JSON.stringify(ledger, null, 2), 'utf-8');

        // WAL: 3. COMMITTED
        TransactionEngine.markCommitted(contextDir, plan.canonicalHash);
        TransactionEngine.pruneTransactions(contextDir, 50, 30, true);

    } catch (error: any) {
        // FAIL-CLOSED: Rollback Transacional Instantâneo
        rollback();
        try {
            TransactionEngine.markRolledBack(contextDir, plan.canonicalHash);
        } catch {}
        throw new Error(`Transactional failure during write. Rollback executed successfully. Cause: ${error.message}`);
    } finally {
        isApplying = false;
        process.removeListener('SIGINT', handleSignal);
        process.removeListener('SIGTERM', handleSignal);
        process.removeListener('SIGHUP', handleSignal);
        lock.release();
    }
}