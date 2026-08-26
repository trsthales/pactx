# RFC-002: Observability, Diagnostics, Transaction Engine (WAL) & Knowledge Model Expansion

* **RFC Number:** 002
* **Version:** 1.2 (Enterprise-Hardened, WAL-Protected & Graph-Safe)
* **Status:** FINAL / ACCEPTED
* **Target Release:** `pactx v0.3.0`
* **Predecessor:** RFC-001 (Closed-Loop Mutation Protocol)
* **Authors:** pactx core team
* **Date:** 2026-08-25

---

## 1. Contexto e Motivação

A versão `v0.2.x` consolidou o motor de mutação em loop fechado (*Egress -> Ingress*) com garantias de segurança Zero-Trust (Anti-Symlink, Anti-Hardlink, Escritas Atômicas, Sanitização de Injeção e Anti-TOCTOU sob Lock).

A RFC-002 eleva o PactX de uma ferramenta utilitária para um **Motor de Conhecimento e Estado Transacional de Nível Industrial**:

1. **Write-Ahead Logging (WAL) & Crash Resilience:** Elimina a vulnerabilidade de corrupção por `SIGKILL` (`kill -9`) ou queda de energia, tornando o rollback durável e persistido em disco com auto-recovery transparente sob lock.
2. **Separação Canônica entre Problema e Solução:** Introduz a entidade de primeira classe `Requirement` (`requirements.md`), desacoplando a necessidade de negócio da decisão arquitetural que a satisfaz.
3. **Cadeia de Custódia e Proveniência:** Rastreabilidade estrita de qual modelo, sessão ou documento gerou cada decisão e mutação.
4. **Suíte de Governança e Observabilidade:** Comandos de inspeção (`status`), diagnóstico com autocorreção (`doctor`), pré-visualização (`diff`) e reversão transacional segura (`rollback`).

---

## 2. Nova Estrutura de Armazenamento e Migração Transparente

### 2.1 Higiene do Diretório Canônico (`.ai-context/`)
Todo o runtime de máquina é segregado dentro da pasta oculta `.ai-context/.pactx/`, deixando a raiz de `.ai-context/` exclusiva para documentos legíveis por humanos:

```text
.ai-context/
├── project.md            # Identidade, stack e regras invariantes (Humano)
├── state.md              # Tarefa ativa, fatos e hipóteses descartadas (Humano)
├── requirements.md       # Regras de negócio e requisitos com frontmatter YAML (Humano) [NOVO]
├── glossary.md           # Contratos invariantes e termos do domínio (Humano)
├── decisions/            # Micro-ADRs DEC-%03d.md com linhagem estrutural (Humano)
│   ├── DEC-001.md
│   └── DEC-002.md
│
└── .pactx/               # 🔒 STORAGE INTERNO DO ENGINE (Ignorado no diff humano)
    ├── .pactx.lock       # Trava atômica exclusiva (PID + Timestamp)
    ├── ledger.json       # Histórico cronológico de mutações e hashes aplicados
    └── transactions/     # Diários de transações duráveis (WAL)
        ├── TX-1f4e6c23.json
        └── TX-84d509ab.json
```

### 2.2 Migração Transparente da v0.2.x (Zero-Friction Upgrade)
No boot da v0.3.0, o engine verifica a presença do layout legado:
1. Se `.ai-context/.pactx-history.json` existir e `.ai-context/.pactx/ledger.json` não existir:
   - Cria o diretório `.ai-context/.pactx/transactions/`.
   - Move `.ai-context/.pactx-history.json` para `.ai-context/.pactx/ledger.json`.
   - Remove `.ai-context/.pactx.lock` legado (se existir).
2. **Resolução de Conflito de Layout Duplo:** Se ambos existirem (ex: downgrade seguido de upgrade), realiza a união (*union*) deduplicada por `hash`, ordena cronologicamente por `applied_at`, salva em `.pactx/ledger.json` e remove o arquivo legado.
3. Atualiza o `ContextLock` para operar exclusivamente em `.ai-context/.pactx/.pactx.lock`.

---

## 3. O `TransactionEngine` (WAL, Auto-Recovery e Poda)

```text
                  ┌──────────────────────┐
                  │      1. PREPARED     │
                  │ (Cria TX-xxx.json    │
                  │  atomicamente com    │
                  │  plano e snapshots)  │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │      2. APPLYING     │
                  │ (Gravando mutações   │
                  │  atômicas no disco)  │
                  └──────────┬───────────┘
                             │
             ┌───────────────┴───────────────┐
             │ (Sucesso)                     │ (Crash / Falha)
             ▼                               ▼
  ┌──────────────────────┐        ┌──────────────────────┐
  │     3. COMMITTED     │        │    4. ROLLED_BACK    │
  │ (Mutações concluídas │        │ (Auto-recovery lê o  │
  │  e ledger atualizado)│        │  snapshot e restaura)│
  └──────────────────────┘        └──────────────────────┘
```

### 3.1 Interface do Manifesto de Transação (`TX-<hash>.json`)

```typescript
export interface TransactionManifest {
  txHash: string;
  status: 'PREPARED' | 'APPLYING' | 'COMMITTED' | 'ROLLED_BACK' | 'FAILED';
  recoveryAttempts: number;
  createdAt: string;
  source?: {
    type: 'conversation' | 'agent' | 'manual' | 'document';
    model?: string;
    sessionTopic?: string;
  };
  baseRevision: string;
  snapshot: Array<{
    path: string;
    contentHash: string; // SHA-256 do conteúdo original para integridade
    content: string;     // Conteúdo integral para restauração
  }>;
  createdFiles: string[]; // Arquivos novos a serem excluídos em caso de rollback
  plan: MutationPlan;
}
```

### 3.2 Escrita Atômica do Manifesto & Auto-Recovery Anti-Loop
1. **Escrita Atômica do Manifesto:** Todas as transições de status (`PREPARED`, `APPLYING`, `COMMITTED`, `ROLLED_BACK`) usam `safeAtomicWriteFileSync` no arquivo `TX-<hash>.json`.
2. **Auto-Recovery sob `ContextLock`:**
   - Ao inicializar qualquer comando (`pack`, `status`, `doctor`, `update`, `diff`), o motor adquire o `ContextLock`.
   - Inspeciona `.pactx/transactions/`. Se encontrar um manifesto `APPLYING` ou `PREPARED`:
     - Se o JSON estiver corrompido ou incompleto durante `PREPARED`, exclui o manifesto órfão (nenhuma mutação física ocorreu).
     - Se estiver em `APPLYING`, incrementa `recoveryAttempts`.
     - Se `recoveryAttempts > 3`, marca como `FAILED` e emite alerta crítico no `doctor` exigindo intervenção manual (previne loops infinitos).
     - Se válido, valida `SHA-256(content) === contentHash` de cada arquivo do snapshot, restaura o disco com `safeAtomicWriteFileSync`, remove `createdFiles`, marca como `ROLLED_BACK` e emite aviso no terminal.
   - Libera o `ContextLock`.

### 3.3 Política de Retenção e Poda (`Pruning`)
* O `.pactx/ledger.json` mantém até 500 entradas.
* O diretório `.pactx/transactions/` mantém os últimos **50 manifestos finalizados** (`COMMITTED` ou `ROLLED_BACK`).
* Manifestos antigos com mais de 30 dias são podados pelo comando `pactx doctor --fix`. Se o usuário tentar `pactx rollback <hash>` para uma transação já podada, o CLI emite erro explicativo orientando a usar o rollback padrão LIFO.

---

## 4. O Modelo de Conhecimento: Entidade `Requirement`

$$\text{Requirement (O quê)} \xrightarrow{\text{satisfies}} \text{Decision / ADR (Como)} \xrightarrow{\text{implements}} \text{Task (Execução)} \xrightarrow{\text{discovers}} \text{Facts / Hypotheses}$$

### 4.1 Formato Canônico de `.ai-context/requirements.md` (YAML Frontmatter + Markdown)

```markdown
---
spec_version: "1.0"
requirements:
  - id: "REQ-001"
    status: active # active | draft | deprecated
    type: security # functional | security | performance | compliance
    title: "Multi-tenant Data Isolation"
    satisfied_by: ["DEC-002"]
  - id: "REQ-002"
    status: active
    type: functional
    title: "Student Simplified Authentication"
    satisfied_by: ["DEC-003"]
---
# Requirements & Business Rules

### [REQ-001] Multi-tenant Data Isolation
O sistema deve isolar dados de alunos estritamente por escola para conformidade com a LGPD.

### [REQ-002] Student Simplified Authentication
Alunos do ensino fundamental devem conseguir se autenticar usando apenas Turma e PIN numérico de 4 dígitos sem exigir e-mail.
```

### 4.2 Semântica de Patch para Requisitos
* O parser/applier faz merge do array `requirements` do frontmatter preservando itens preexistentes não mencionados no payload.
* As seções narrativas no corpo Markdown são preservadas e atualizadas pelo ID correspondente.

### 4.3 Vínculo Estrutural nos ADRs (`decisions/DEC-%03d.md`)
```yaml
---
spec_version: "1.0"
id: "DEC-002"
title: "Database Isolation per Tenant"
status: "active"
satisfies: ["REQ-001"]
date: "2026-08-22"
---
```

---

## 5. Rastreabilidade e Modelo de Proveniência (`source`)

```typescript
export interface ProvenanceMetadata {
  type: 'conversation' | 'agent' | 'manual' | 'document';
  model?: string;
  sessionTopic?: string;
  txHash: string;
  baseRevision: string;
  appliedAt: string;
}
```
* **Retrocompatibilidade:** Se um payload `version: "1.0"` for recebido sem `source.type`, o motor assume `type: 'conversation'` como valor default implícito.

---

## 6. A Suíte de Governança e CLI (O Quarteto de Ouro)

### 🌟 6.1. `pactx status`
Exibe o dashboard executivo no terminal ou JSON com `--json`.

### 🩺 6.2. `pactx doctor` (8 Regras de Integridade)
1. *YAML Frontmatters:* Validação de schema e integridade em todos os arquivos.
2. *Security Jail:* Ausência de links simbólicos ou hardlinks em `.ai-context/`.
3. *ADR Lineage:* Validação de `superseded_by` (sem loops circulares nem alvos órfãos).
4. *Requirement Mapping:* Validação de `satisfies` nos ADRs apontando para IDs reais.
5. *Bidirectional Parity:* Consistência simétrica entre ADRs (`satisfies: [REQ-X]`) e Requisitos (`satisfied_by: [DEC-Y]`).
6. *Ledger Health:* Integridade do JSON e histórico em `.pactx/ledger.json`.
7. *Transaction Integrity:* Detecção e recuperação de manifestos órfãos em `.pactx/transactions/`.
8. *Lockfile Health:* Identificação de `.pactx/.pactx.lock` abandonados (>30s) com remoção via `--fix`.

### 🔍 6.3. `pactx diff [input | hash]`
Exibe a pré-visualização colorida do plano de mutação sem tocar no disco.

### ⏪ 6.4. `pactx rollback` (Graph-Safe & WAL-Protected)
1. **LIFO Stack Undo (Padrão):** Reverte com segurança a transação mais recente do topo da pilha.
2. **Reversão com Dependência (`pactx rollback <hash>`):** 
   - Executa análise de grafo: se transações posteriores ativas dependerem de entidades da transação alvo (`satisfies`, `superseded_by`), o rollback é recusado com erro explicativo.
   - Com `--force-cascade`: desfaz todas as transações dependentes em ordem LIFO reversa como sub-transações WAL atômicas.
3. **Rollback é uma Transação WAL:** O rollback gera seu próprio manifesto `TX-rollback-<hash>.json` garantindo sobrevivência a crashes.

---

## 7. O Protocolo `pactx-update` v1.1

O parser aceita `version: "1.0"` e `version: "1.1"` retrocompatíveis:

````yaml
```pactx-update
version: "1.1"
base_revision: "84d509ab8775837c"

source:
  type: "conversation"
  model: "Claude 3.7 Sonnet"
  session_topic: "Implementação da v0.3.0"

state:
  active_task: "TASK-06 Finalização da RFC-002"
  status: "IN_PROGRESS"
  recommended_model: "High"
  completed_items:
    - "Especificação técnica aprovada"
  new_facts:
    - "Write-Ahead Logging em .pactx/transactions/ garante sobrevivência a SIGKILL"
  rejected_hypotheses:
    - "Rollback puro em memória é insuficiente contra SIGKILL"
  next_action: "Implementar src/update/transaction.ts"

new_requirements:
  - id: "auto" # Gera REQ-003
    type: "security"
    title: "Durable Transaction Journaling"
    statement: "Toda mutação de estado canônico deve ser registrada em log persistente antes da escrita em disco."

new_decisions:
  - id: "auto" # Gera DEC-004
    title: "Adoção de Write-Ahead Logging na v0.3.0"
    satisfies: ["REQ-003"]
    reason: "Garante integridade ACID e permite rollbacks determinísticos"
    decision: "Implementar TransactionEngine com estados PREPARED/APPLYING/COMMITTED em .ai-context/.pactx/transactions/"

superseded_decisions: []
new_glossary_terms: []
```
````

---

## 8. Resolução de Raiz em Subdiretórios (`findContextDir`)

Todos os comandos utilizam o resolvedor `findContextDir(startDir)` subindo pelas pastas-mãe até encontrar a raiz contendo `.ai-context/`.

---

## 9. Definition of Done & Quality Gates (v0.3.0)

- [ ] `TransactionEngine` com estados `PREPARED`, `APPLYING`, `COMMITTED`, `ROLLED_BACK`, `FAILED` e escrita atômica de manifestos.
- [ ] Auto-recovery no boot sob `ContextLock` com anti-loop (`recoveryAttempts <= 3`).
- [ ] Migração automática e resolução de layout duplo para `.pactx/ledger.json`.
- [ ] Poda de manifestos antigos (>50 transações ou >30 dias).
- [ ] Entidade `Requirement` e arquivo canônico `requirements.md` com YAML Frontmatter + Markdown.
- [ ] Comandos CLI implementados: `pactx status`, `pactx doctor` (8 regras + `--fix`), `pactx diff` e `pactx rollback` (LIFO / Graph-Safe / WAL-protected).
- [ ] Parser aceitando schemas `version: "1.0"` e `version: "1.1"` retrocompatíveis.
- [ ] Helper `findContextDir` para execução a partir de subdiretórios.
- [ ] 100% dos testes unitários e adversariais passando.
- [ ] Documentação (`README.md`, `README.pt-BR.md`, `TUTORIAL.md`, `ARCHITECTURE.md`) atualizada em Inglês e Português.
