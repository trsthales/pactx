import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { RawUpdatePayload, MutationPlan, HistoryLedger } from './types';
import { getCurrentContextRevision } from '../composer';
import { ensureStorageLayout } from './migration';

export function getNextAdrId(decisionsDir: string): string {
    if (!fs.existsSync(decisionsDir)) return 'DEC-001';
    const files = (fs.readdirSync(decisionsDir) as string[]).filter(f => f.endsWith('.md'));
    let maxNum = 0;
    for (const f of files) {
        const match = f.match(/^DEC-(\d+)\.md$/i);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    const next = maxNum + 1;
    if (next > 9999) {
        throw new Error('ADR ID limit reached (DEC-9999).');
    }
    return `DEC-${next.toString().padStart(3, '0')}`;
}

export function getExistingRequirementIds(requirementsPath: string): Set<string> {
    const ids = new Set<string>();
    if (!fs.existsSync(requirementsPath)) return ids;
    try {
        const raw = fs.readFileSync(requirementsPath, 'utf-8');
        const matches = raw.matchAll(/REQ-(\d+)/gi);
        for (const match of matches) {
            ids.add(`REQ-${match[1].padStart(3, '0').toUpperCase()}`);
        }
    } catch {}
    return ids;
}

export function getNextReqId(requirementsPath: string, allocatedIds: Set<string> = new Set()): string {
    let maxNum = 0;
    const existing = getExistingRequirementIds(requirementsPath);
    for (const id of existing) {
        const match = id.match(/^REQ-(\d+)$/i);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    for (const id of allocatedIds) {
        const match = id.match(/^REQ-(\d+)$/i);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    const next = maxNum + 1;
    if (next > 9999) {
        throw new Error('Requirement ID limit reached (REQ-9999).');
    }
    return `REQ-${next.toString().padStart(3, '0')}`;
}

function assertInsideDirectory(parentDir: string, targetPath: string, entityName: string): void {
    const resolvedParent = path.resolve(parentDir);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedParent, resolvedTarget);

    if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
        throw new Error(`Security violation (Path Traversal): Attempted access outside ${parentDir} for ${entityName}`);
    }

    // Validação de realpath contra symlinks em diretórios pai (Task 4)
    try {
        if (fs.existsSync(resolvedParent)) {
            const realParent = fs.realpathSync.native ? fs.realpathSync.native(resolvedParent) : fs.realpathSync(resolvedParent);
            const targetParent = path.dirname(resolvedTarget);
            if (fs.existsSync(targetParent)) {
                const realTargetParent = fs.realpathSync.native ? fs.realpathSync.native(targetParent) : fs.realpathSync(targetParent);
                const relReal = path.relative(realParent, realTargetParent);
                if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
                    throw new Error(`Security violation (Symlink Jail): ${entityName} escapes the canonical directory.`);
                }
            }
        }
    } catch (err: any) {
        if (err.message.includes('Security violation')) throw err;
    }
}

export function buildMutationPlan(
    cwd: string,
    payload: RawUpdatePayload,
    canonicalHash: string,
    initialWarnings: string[] = []
): MutationPlan {
    const contextDir = path.join(cwd, '.ai-context');
    const decisionsDir = path.join(contextDir, 'decisions');
    const requirementsPath = path.join(contextDir, 'requirements.md');

    if (!fs.existsSync(contextDir)) {
        throw new Error('.ai-context folder not found in project.');
    }

    ensureStorageLayout(contextDir);
    const historyFile = path.join(contextDir, '.pactx', 'ledger.json');

    const warnings = [...initialWarnings];

    // 1. Validação de Concorrência Otimista (base_revision vs current_revision)
    if (payload.base_revision) {
        const currentRev = getCurrentContextRevision(contextDir);
        if (payload.base_revision !== currentRev) {
            warnings.push(`Stale Context: The update was based on revision "${payload.base_revision}", but the current repository is at revision "${currentRev}".`);
        }
    }

    // 2. Verificação de Idempotência no Ledger (Fail-Closed se corrompido)
    let isAlreadyApplied = false;
    if (fs.existsSync(historyFile)) {
        try {
            const ledger: HistoryLedger = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
            if (ledger.applied_updates && ledger.applied_updates.some(entry => entry.hash === canonicalHash)) {
                isAlreadyApplied = true;
            }
        } catch (err: any) {
            throw new Error(`Integrity failure: The history ledger .pactx/ledger.json is corrupted or contains invalid JSON (${err.message}). Operation aborted.`);
        }
    }

    const plan: MutationPlan = {
        schemaVersion: payload.version,
        baseRevision: payload.base_revision,
        canonicalHash,
        isAlreadyApplied,
        warnings,
        source: payload.source ? {
            type: payload.source.type || 'conversation',
            model: payload.source.model,
            sessionTopic: payload.source.session_topic,
        } : undefined,
        operations: {
            createdRequirements: [],
            updatedRequirements: [],
            createdAdrs: [],
            supersededAdrs: [],
            appendedGlossaryTerms: [],
        },
    };

    const today = new Date().toISOString().split('T')[0];

    // 3. Planejamento de Requisitos (new_requirements) & Detecção de Colisão
    const allocatedReqIds = new Set<string>();
    const existingReqIds = getExistingRequirementIds(requirementsPath);
    let currentNextReqNum = 0;

    if (payload.new_requirements && Array.isArray(payload.new_requirements)) {
        for (const r of payload.new_requirements) {
            let reqId = r.id ? String(r.id).trim() : '';
            const isAuto = !reqId || reqId.toLowerCase() === 'auto';
            if (isAuto) {
                if (currentNextReqNum === 0) {
                    const nextStr = getNextReqId(requirementsPath, allocatedReqIds);
                    currentNextReqNum = parseInt(nextStr.replace('REQ-', ''), 10);
                } else {
                    currentNextReqNum++;
                }
                while (
                    allocatedReqIds.has(`REQ-${currentNextReqNum.toString().padStart(3, '0')}`) ||
                    existingReqIds.has(`REQ-${currentNextReqNum.toString().padStart(3, '0')}`)
                ) {
                    currentNextReqNum++;
                }
                if (currentNextReqNum > 9999) {
                    throw new Error('Requirement ID limit reached (REQ-9999).');
                }
                reqId = `REQ-${currentNextReqNum.toString().padStart(3, '0')}`;
            } else {
                reqId = reqId.toUpperCase();
                if (allocatedReqIds.has(reqId)) {
                    throw new Error(`Conflict: Requirement ${reqId} was declared more than once in the same batch.`);
                }
                if (existingReqIds.has(reqId)) {
                    throw new Error(`Conflict: Requirement ${reqId} already exists in the repository.`);
                }
            }

            allocatedReqIds.add(reqId);

            plan.operations.createdRequirements.push({
                id: reqId,
                status: 'active',
                type: r.type || 'functional',
                title: r.title || 'Untitled Requirement',
                statement: r.statement || '',
                satisfied_by: [],
            });
        }
    }

    // 4. Planejamento de Novos ADRs, Detecção de Colisão & Vínculo satisfies
    const allocatedIds = new Set<string>();
    let currentNextNum = 0;
    if (payload.new_decisions && Array.isArray(payload.new_decisions)) {
        for (const d of payload.new_decisions) {
            let adrId = d.id ? String(d.id).trim() : '';
            const isAuto = !adrId || adrId.toLowerCase() === 'auto';
            if (isAuto) {
                if (currentNextNum === 0) {
                    const nextStr = getNextAdrId(decisionsDir);
                    currentNextNum = parseInt(nextStr.replace('DEC-', ''), 10);
                } else {
                    currentNextNum++;
                }
                while (
                    allocatedIds.has(`DEC-${currentNextNum.toString().padStart(3, '0')}`) ||
                    fs.existsSync(path.resolve(decisionsDir, `DEC-${currentNextNum.toString().padStart(3, '0')}.md`))
                ) {
                    currentNextNum++;
                }
                if (currentNextNum > 9999) {
                    throw new Error('ADR ID limit reached (DEC-9999).');
                }
                adrId = `DEC-${currentNextNum.toString().padStart(3, '0')}`;
            } else {
                if (allocatedIds.has(adrId)) {
                    throw new Error(`Conflict: Decision ${adrId} was declared more than once in the same batch.`);
                }
                // ID explícito: verifica se já existe para evitar sobrescrita acidental
                const existingPath = path.resolve(decisionsDir, `${adrId}.md`);
                if (fs.existsSync(existingPath)) {
                    throw new Error(`Conflict: Decision ${adrId} already exists in the repository.`);
                }
            }

            allocatedIds.add(adrId);
            const targetPath = path.resolve(decisionsDir, `${adrId}.md`);
            assertInsideDirectory(decisionsDir, targetPath, `ADR ${adrId}`);

            const rawSatisfiesList = d.satisfies && Array.isArray(d.satisfies) ? d.satisfies : [];
            const satisfiesList: string[] = [];
            for (const satId of rawSatisfiesList) {
                const canonicalSatId = String(satId).trim().toUpperCase();
                // [P1-12] Fail-Closed em requisitos inexistentes
                if (!existingReqIds.has(canonicalSatId) && !allocatedReqIds.has(canonicalSatId)) {
                    throw new Error(
                        `Validation Error: Requirement "${canonicalSatId}" referenced in 'satisfies' does not exist in repository or current batch.`
                    );
                }
                satisfiesList.push(canonicalSatId);
                const existingOp = plan.operations.updatedRequirements.find(u => u.id === canonicalSatId);
                if (existingOp) {
                    if (!existingOp.satisfiedByAdd) existingOp.satisfiedByAdd = [];
                    if (!existingOp.satisfiedByAdd.includes(adrId)) existingOp.satisfiedByAdd.push(adrId);
                } else {
                    plan.operations.updatedRequirements.push({
                        id: canonicalSatId,
                        satisfiedByAdd: [adrId],
                    });
                }
            }

            plan.operations.createdAdrs.push({
                id: adrId,
                targetPath,
                title: d.title || 'Untitled Decision',
                reason: d.reason || '',
                decision: d.decision || '',
                date: today,
                isAuto,
                satisfies: satisfiesList.length > 0 ? satisfiesList : undefined,
            });
        }
    }

    // 4. Planejamento de ADRs Substituídos & Validação Semântica
    if (payload.superseded_decisions && Array.isArray(payload.superseded_decisions)) {
        for (const s of payload.superseded_decisions) {
            // Conflito Intra-Lote: Impede que um ADR seja criado e substituído no mesmo lote (P2-07)
            if (allocatedIds.has(s.id)) {
                throw new Error(`Logical conflict: ${s.id} is being created and marked as superseded simultaneously in the same batch.`);
            }

            const targetPath = path.resolve(decisionsDir, `${s.id}.md`);
            assertInsideDirectory(decisionsDir, targetPath, `ADR ${s.id}`);

            // Validação Semântica: O ADR a ser substituído PRECISA existir
            if (!fs.existsSync(targetPath)) {
                throw new Error(`Decision to supersede not found in repository: ${s.id}`);
            }

            let supersededBy = s.by || 'auto';
            if (supersededBy.toLowerCase() === 'auto') {
                if (plan.operations.createdAdrs.length === 1) {
                    supersededBy = plan.operations.createdAdrs[0].id;
                } else if (plan.operations.createdAdrs.length > 1) {
                    throw new Error(`Ambiguity in superseded_decisions: 'by: auto' cannot be resolved because ${plan.operations.createdAdrs.length} new ADRs were created in this batch. Specify the ID explicitly.`);
                } else {
                    throw new Error(`superseded_decisions specified 'by: auto', but no new ADR was created in this batch.`);
                }
            }

            // [P1-11] Inspeciona quais requisitos o ADR substituído satisfazia para atualizar requirements.md
            let targetSatisfies: string[] = [];
            try {
                const targetContent = fs.readFileSync(targetPath, 'utf-8');
                const fmMatch = targetContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (fmMatch) {
                    const parsedFm = yaml.parse(fmMatch[1]);
                    if (parsedFm && Array.isArray(parsedFm.satisfies)) {
                        targetSatisfies = parsedFm.satisfies.map((id: any) => String(id).trim().toUpperCase());
                    }
                }
            } catch {}

            // Também verifica se requirements.md lista s.id em satisfied_by
            if (fs.existsSync(requirementsPath)) {
                try {
                    const reqContent = fs.readFileSync(requirementsPath, 'utf-8');
                    const fmMatch = reqContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                    if (fmMatch) {
                        const parsedFm = yaml.parse(fmMatch[1]);
                        if (parsedFm && Array.isArray(parsedFm.requirements)) {
                            for (const r of parsedFm.requirements) {
                                if (r && Array.isArray(r.satisfied_by)) {
                                    if (r.satisfied_by.some((d: any) => String(d).trim().toUpperCase() === s.id.toUpperCase())) {
                                        const rId = String(r.id).trim().toUpperCase();
                                        if (!targetSatisfies.includes(rId)) {
                                            targetSatisfies.push(rId);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch {}
            }

            // Sincronização bidirecional estrita no supersede de ADRs (P1-11)
            for (const reqId of targetSatisfies) {
                const existingOp = plan.operations.updatedRequirements.find(u => u.id === reqId);
                if (existingOp) {
                    if (!existingOp.satisfiedByRemove) existingOp.satisfiedByRemove = [];
                    if (!existingOp.satisfiedByRemove.includes(s.id.toUpperCase())) {
                        existingOp.satisfiedByRemove.push(s.id.toUpperCase());
                    }
                    if (!existingOp.satisfiedByAdd) existingOp.satisfiedByAdd = [];
                    if (supersededBy && !existingOp.satisfiedByAdd.includes(supersededBy)) {
                        existingOp.satisfiedByAdd.push(supersededBy);
                    }
                } else {
                    plan.operations.updatedRequirements.push({
                        id: reqId,
                        satisfiedByRemove: [s.id.toUpperCase()],
                        satisfiedByAdd: supersededBy ? [supersededBy] : [],
                    });
                }

                // Se o superseding ADR foi criado neste lote, garante que ele herda o vínculo satisfies
                const newAdr = plan.operations.createdAdrs.find(a => a.id === supersededBy);
                if (newAdr) {
                    if (!newAdr.satisfies) newAdr.satisfies = [];
                    if (!newAdr.satisfies.includes(reqId)) {
                        newAdr.satisfies.push(reqId);
                    }
                }
            }

            plan.operations.supersededAdrs.push({
                id: s.id,
                targetPath,
                supersededBy,
                reason: s.reason || '',
                date: today,
            });
        }
    }

    // 5. Planejamento do state.md (Semântica de PATCH: campos opcionais preservados se não enviados)
    if (payload.state) {
        plan.operations.stateUpdate = {
            targetPath: path.join(contextDir, 'state.md'),
            activeTask: payload.state.active_task !== undefined ? payload.state.active_task : undefined,
            status: payload.state.status !== undefined ? payload.state.status : undefined,
            recommendedModel: payload.state.recommended_model !== undefined ? payload.state.recommended_model : undefined,
            newCompletedItems: payload.state.completed_items || [],
            newFacts: payload.state.new_facts || [],
            newRejectedHypotheses: payload.state.rejected_hypotheses || [],
            nextAction: payload.state.next_action !== undefined ? payload.state.next_action : undefined,
        };
    }

    // 6. Planejamento do glossary.md
    if (payload.new_glossary_terms && Array.isArray(payload.new_glossary_terms)) {
        for (const g of payload.new_glossary_terms) {
            if (g.term && g.definition) {
                plan.operations.appendedGlossaryTerms.push({
                    term: g.term.trim(),
                    definition: g.definition.trim(),
                });
            }
        }
    }

    return plan;
}