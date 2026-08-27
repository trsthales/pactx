# Arquitetura & Especificação Técnica do pactx 🏛️

🌐 **Idioma / Language:** [Português (Brasil)](./ARCHITECTURE.pt-BR.md) | [English](./ARCHITECTURE.md)

Este documento fornece a especificação técnica e arquitetural aprofundada do `pactx`, detalhando seu motor de estado em loop fechado, pipeline de segurança *Zero-Trust*, primitivas de concorrência e garantias de persistência transacional.

---

## 1. Tese Fundamental

No desenvolvimento de software assistido por inteligência artificial, ferramentas e fluxos de trabalho frequentemente falham devido a um descasamento semântico fundamental de estado:

1. **Modelos de Linguagem (LLMs) são Motores Computacionais sem Estado (Stateless):**
   Janelas de contexto são efêmeras, sujeitas a degradação, perda de atenção, alucinações e saturação de tokens.
2. **Bases de Código são Máquinas de Estado Persistentes e Evolutivas:**
   Regras arquiteturais, contratos invariantes, registros de decisões arquiteturais (ADRs) e estados de sprints exigem persistência absoluta e rastreabilidade determinística.

O `pactx` resolve essa discrepância transformando o **repositório Git na única fonte canônica da verdade** e implementando um protocolo de sincronização bidirecional e com *Human-in-the-Loop* entre desenvolvedores, repositórios e modelos de IA.

---

## 2. Arquitetura do Motor de Estado em Loop Fechado

O `pactx` opera através de dois fluxos principais: **Egresso** (Empacotamento de Contexto) e **Ingresso** (Ingestão de Contexto e Mutação de Estado).

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          REPOSITÓRIO LOCAL                             │
│                                                                        │
│   .ai-context/                                                         │
│   ├── project.md         (Arquitetura Estática e Regras Invioláveis)   │
│   ├── requirements.md    (Requisitos Canônicos e Regras de Negócio)    │
│   ├── state.md           (Sprint Ativa, Tarefas, Fatos, Hipóteses)     │
│   ├── glossary.md        (Contratos de Domínio e Termos Invariantes)   │
│   ├── decisions/DEC-*.md (Micro-ADRs com Vínculos satisfies)           │
│   └── .pactx/                                                          │
│       ├── ledger.json    (Ledger de Auditoria e Hashes Aplicados)      │
│       ├── .pactx.lock    (Lock Atômico de Concorrência)                │
│       └── transactions/  (Manifestos WAL TX-*.json)                    │
│                                                                        │
│   Estado de Runtime do Git (Branch, Commits Recentes, Diff Local)      │
└──────────────────┬──────────────────────────────────▲──────────────────┘
                   │                                  │
      1. npx @trsthales/pactx │ [EGRESSO] 3. npx @trsthales/pactx │ update [INGRESSO]
     (composer.ts) │                        (TransactionEngine)│ (Pipeline Zero-Trust)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  Pacote Markdown Otimizado   │   │  Revisão Human-in-the-Loop      │
    │  em Tokens (Clipboard)       │   │  (Diff Literal e Verificação)   │
    │  + Root Discovery (findRoot) │   │  + pactx diff Dry-Run           │
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   │                           [PLANNER & PARSER]
                   │                           • Anti-Symlink / Hardlink
                   │                           • Sanitização de Seções
                   │                           • Jail de Path Traversal
                   │                           • Write-Ahead Logging (WAL)
                   │                           • Lock Atômico (.pactx.lock)
                   │                                  │
                   ▼                                  │ 2. /handoff
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │          QUALQUER IA (ChatGPT / Claude / Gemini / Cursor)          │
    │                   Emite bloco ```pactx-update                      │
    └────────────────────────────────────────────────────────────────────┘
```

### O Fluxo do Pipeline de Ingresso
Quando uma IA emite um bloco `pactx-update`, o pipeline de ingestão executa em cinco etapas estritas e *Fail-Closed*:

```text
Entrada Não Confiável (Clipboard / Arquivo / Stdin)
   │
   ▼
[1. PARSER (src/update/parser.ts)]
   ├── Extração do bloco de código ```pactx-update```
   ├── Parsing seguro de YAML (sem prototype pollution)
   ├── Validação de schema (v1.0 & v1.1) e enums estritos
   ├── Scanner heurístico anti-evasão (normalização NFKD e remoção de zero-width)
   ├── Contenção de limites (max arrays: 100, max string: 2000, max ADRs: 20)
   └── Cálculo determinístico do hash canônico SHA-256
   │
   ▼
[2. PLANNER (src/update/planner.ts)]
   ├── Verificação do jail de diretórios (assertInsideDirectory via fs.realpathSync.native)
   ├── Verificação de idempotência via .pactx/ledger.json (fail-closed em JSON corrompido)
   ├── Alocação provisória de IDs de ADR e Requisitos (resolução de auto -> DEC-%03d / REQ-%03d)
   ├── Validação semântica de referências (by: auto vs IDs explícitos em supersedes)
   └── Detecção de concorrência otimista (base_revision vs current_revision)
   │
   ▼
[3. INTERFACE DE REVISÃO (src/cli.ts)]
   └── Exibição do plano literal em texto integral (fatos, decisões, requisitos, tarefas)
   │
   ▼
[4. MOTOR TRANSACIONAL & WAL (src/update/transaction.ts)]
   ├── Obtenção de ContextLock exclusivo (.pactx/.pactx.lock via fs.openSync com flag 'wx')
   ├── Auto-Recovery transparente no boot de manifestos PREPARED/APPLYING órfãos
   ├── Alocação definitiva de IDs sequenciais sob lock (eliminação de TOCTOU)
   ├── Gravação do Manifesto WAL TX-<hash>.json com snapshots SHA-256 (PREPARED -> APPLYING)
   ├── Aplicação com semântica de patch em state.md e requirements.md
   ├── Escrita atômica (safeAtomicWriteFileSync: escrita temporária + rename atômico)
   ├── Transição do Manifesto WAL para COMMITTED
   ├── Gravação do registro no .pactx/ledger.json
   └── Liberação do ContextLock e poda de transações (>50 / >30d)
```

---

## 3. Modelo de Dados e Entidades Canônicas

Todo o estado canônico reside em `.ai-context/` estruturado em arquivos Markdown legíveis por humanos e frontmatter YAML estrito.

### 3.1 `project.md` (Especificação Estática do Sistema)
Contém as fundações arquiteturais imutáveis, stack técnica e regras não negociáveis da equipe.

### 3.2 `requirements.md` (Requisitos Canônicos e Regras de Negócio)
Registra requisitos funcionais, de segurança, performance e conformidade com semântica de patch:
```markdown
---
spec_version: "1.0"
requirements:
  - id: "REQ-001"
    type: "security"
    title: "Proteção de Rotas com Autenticação Forte"
    status: "active"
    satisfied_by: ["DEC-002"]
---
# Requisitos do Sistema

## REQ-001: Proteção de Rotas com Autenticação Forte
Todas as rotas da API devem exigir tokens criptograficamente validados.
```

### 3.3 `state.md` (Estado Volátil de Tarefas & Semântica de Patch)
Acompanha o progresso do desenvolvimento ativo. O `pactx` processa atualizações de estado com **Semântica de Patch Incremental**: campos omitidos são preservados integralmente sem sobrescrita destrutiva.

### 3.4 `decisions/DEC-%03d.md` (Micro-ADRs & Vínculos Bidirecionais)
Decisões arquiteturais são versionadas sequencialmente e declaram os requisitos que satisfazem:
```markdown
---
spec_version: "1.0"
id: "DEC-002"
title: "Autenticação via PIN com PBKDF2"
status: "active"
date: "2026-08-26"
satisfies: ["REQ-001"]
---
# Decisão
...
```

### 3.5 `.pactx/ledger.json` (Ledger de Auditoria)
Mantém o histórico imutável das mutações aplicadas, registrando hashes, revisões, timestamps e auditoria.

---

## 4. Concorrência, WAL & Garantias de Rollback

### 4.1 Máquina de Estados do Write-Ahead Logging (WAL)
O `TransactionEngine` executa mutações de estado através de fases estritas:
- `PREPARED`: Snapshots capturados, checksums SHA-256 gravados.
- `APPLYING`: Operações atômicas em disco em andamento.
- `COMMITTED`: Todos os arquivos gravados e ledger de auditoria atualizado.
- `ROLLED_BACK`: Estado revertido de forma limpa via restauração de snapshot.
- `FAILED`: Estado irrecuperável exigindo intervenção manual (proteção anti-loop após 3 tentativas).

### 4.2 Reversão Graph-Safe (`pactx rollback`)
Rollbacks validam a árvore de dependências. Se transações mais recentes dependerem de entidades criadas na transação alvo, o rollback é bloqueado a menos que `--force-cascade` seja passado para reverter toda a cadeia em ordem LIFO.

### 4.3 Motor Diagnóstico (`pactx doctor`)
Executa 8 regras automatizadas de integridade: Frontmatters YAML, Security Jail, Linhagem de ADRs, Mapeamento de Requisitos, Paridade Bidirecional, Saúde do Ledger, Integridade de Transações e Saúde do Lockfile com auto-repair `--fix`.

---

## 5. Decisões Arquiteturais e Trade-offs

| Decisão | Abordagem Escolhida | Alternativa Considerada | Racional |
|---|---|---|---|
| **Armazenamento** | Arquivos Markdown + YAML no Git | Bancos Vetoriais / RAG / Embeddings | Rastreamento nativo no Git oferece zero dependências de infraestrutura, execução 100% offline, histórico determinístico e facilidade de code review em PRs. |
| **Motor Transacional** | Manifestos WAL em arquivo (`TX-*.json`) | Escrita direta no arquivo final | Fornece resiliência contra quedas abruptas (`SIGKILL`) ou falta de energia sem necessidade de daemon. |
| **Controle de Concorrência** | File Locking (`wx`) + Hash OCC de 16 caracteres | Locks de Banco / Servidor Central | Opera localmente em qualquer terminal e sistema operacional sem necessidade de daemons ou rede. |
| **Semântica de Mutação** | Merge Incremental de Patch | Sobrescrita Destrutiva de Snapshot | Impede que respostas parciais de IA apaguem inadvertidamente anotações, objetivos ou seções customizadas do desenvolvedor. |

---

## 6. A Arquitetura em 4 Camadas (v0.4.0)

O PactX v0.4.0 organiza a continuidade de contexto em 4 camadas complementares:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   PACTX CONTINUIDADE DE CONTEXTO v0.4.0                │
│                                                                        │
│  Camada 1: PASSIVA (Sempre Ativa)                                      │
│  ├── Protocolo de Micro-Âncoras no prompt do Context Pack              │
│  └── Estimador de Tokens Ponderado Local (Código /3, Prosa /4, +15%)   │
│                                                                        │
│  Camada 2: ATIVA (Orientada a Limiares)                                │
│  ├── Motor de Saúde de Contexto & Zonas de Saturação (SAFE/WATCH/...)  │
│  └── Dashboard Visual ANSI via pactx status --telemetry                │
│                                                                        │
│  Camada 3: EXTRAÇÃO (Out-of-Band)                                      │
│  ├── pactx extract (Parsers Multi-Formato: Claude, ChatGPT, Cursor)   │
│  └── Pipeline Híbrido: Baseline Determinístico + LLM Semântica         │
│                                                                        │
│  Camada 4: REALTIME (Agentes de IDE via MCP)                           │
│  ├── Servidor stdio MCP (pactx serve --mcp)                            │
│  ├── Resources: pactx://context, pactx://health, pactx://status        │
│  └── Segurança por Proposta Desacoplada: pactx_propose_mutation        │
└────────────────────────────────────────────────────────────────────────┘
```

