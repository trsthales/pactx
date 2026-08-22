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
│   ├── state.md           (Sprint Ativa, Tarefas, Fatos, Hipóteses)     │
│   ├── glossary.md        (Contratos de Domínio e Termos Invariantes)   │
│   ├── decisions/DEC-*.md (Micro-ADRs Ativas e Obsoletas)               │
│   └── .pactx-history.json (Ledger de Auditoria e Hashes SHA-256)       │
│                                                                        │
│   Estado de Runtime do Git (Branch, Commits Recentes, Diff Local)      │
└──────────────────┬──────────────────────────────────▲──────────────────┘
                   │                                  │
      1. npx pactx │ [EGRESSO]           3. npx pactx │ update [INGRESSO]
     (composer.ts) │                        (applier) │ (Pipeline Zero-Trust)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  Pacote Markdown Otimizado   │   │  Revisão Human-in-the-Loop      │
    │  em Tokens (Clipboard)       │   │  (Diff Literal e Verificação)   │
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   │                           [PLANNER & PARSER]
                   │                           • Anti-Symlink / Hardlink
                   │                           • Sanitização de Seções
                   │                           • Jail de Path Traversal
                   │                           • Contenção de Memória
                   │                           • Lock Atômico (.pactx.lock)
                   │                                  │
                   ▼                                  │ 2. /handoff
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │          QUALQUER IA (ChatGPT / Claude / Gemini / Cursor)          │
    │                   Emite bloco ```pactx-update                      │
    └────────────────────────────────────────────────────────────────────┘
```

### O Fluxo do Pipeline de Ingresso
Quando uma IA emite um bloco `pactx-update`, o pipeline de ingestão executa em quatro etapas estritas e *Fail-Closed*:

```text
Entrada Não Confiável (Clipboard / Arquivo / Stdin)
   │
   ▼
[1. PARSER (src/update/parser.ts)]
   ├── Extração do bloco de código ```pactx-update```
   ├── Parsing seguro de YAML (sem prototype pollution)
   ├── Validação de schema e enums estritos (status, recommended_model)
   ├── Scanner heurístico anti-evasão (normalização NFKD e remoção de zero-width)
   ├── Contenção de limites (max arrays: 100, max string: 2000, max ADRs: 20)
   └── Cálculo determinístico do hash canônico SHA-256
   │
   ▼
[2. PLANNER (src/update/planner.ts)]
   ├── Verificação do jail de diretórios (assertInsideDirectory via fs.realpathSync.native)
   ├── Verificação de idempotência via .pactx-history.json (fail-closed em JSON corrompido)
   ├── Alocação de IDs de ADR (resolução de auto -> DEC-002 sem colisão)
   ├── Validação semântica de referências (by: auto vs IDs explícitos em supersedes)
   └── Detecção de concorrência otimista (base_revision vs current_revision)
   │
   ▼
[3. INTERFACE DE REVISÃO (src/cli.ts)]
   └── Exibição do plano literal em texto integral para aprovação humana
   │
   ▼
[4. APPLIER (src/update/applier.ts)]
   ├── Obtenção de lock exclusivo (.pactx.lock via fs.openSync com flag 'wx')
   ├── Registro de traps para sinais (SIGINT, SIGTERM, SIGHUP) para abort limpo
   ├── Criação de snapshots em memória dos arquivos alvo
   ├── Aplicação com semântica de patch no state.md (preservação de seções customizadas)
   ├── Escrita atômica (safeAtomicWriteFileSync: escrita temporária + rename atômico)
   ├── Gravação do ledger de histórico (hash, revisões, timestamp, flag forced)
   └── Liberação do lock e cancelamento dos signal handlers
```

---

## 3. Modelo de Dados e Entidades Canônicas

Todo o estado canônico reside em `.ai-context/` estruturado em arquivos Markdown legíveis por humanos e frontmatter YAML estrito.

### 3.1 `project.md` (Especificação Estática do Sistema)
Contém as fundações arquiteturais imutáveis, stack técnica e regras não negociáveis da equipe.
```markdown
---
spec_version: "1.0"
project: "EduTrack"
version: "0.1.0"
stack: ["Node.js", "TypeScript", "Fastify", "PostgreSQL"]
---
# Visão do Projeto
Plataforma educacional...

# Regras Invioláveis
1. Todo endpoint deve conter validação Zod.
```

### 3.2 `state.md` (Estado Volátil de Tarefas & Semântica de Patch)
Acompanha o progresso do desenvolvimento ativo. O `pactx` processa atualizações de estado com **Semântica de Patch Incremental**: se a IA omitir campos como `active_task`, `next_action` ou `status`, os valores existentes são preservados integralmente sem sobrescrita destrutiva.
```markdown
---
spec_version: "1.0"
sprint: "SPRINT_01"
active_task: "TASK-05 Autenticação via PIN"
recommended_model: "High"
status: "IN_PROGRESS"
---
# Objetivo Atual
Implementação do login por PIN numérico...

# O que foi feito recentemente
- [x] Schema Zod configurado

# Fatos & Descobertas
- Rate limit de 5 req/min obrigatório

# Hipóteses Descartadas / Erros Conhecidos (NÃO REPETIR)
- Bcrypt descartado devido a overhead

# Próxima Ação Imediata
Criar controller e rotas Fastify
```

### 3.3 `decisions/DEC-%03d.md` (Micro-ADRs & Linhagem Estrutural)
Decisões arquiteturais são versionadas sequencialmente. Quando uma ADR é substituída, o `pactx` atualiza o frontmatter da ADR antiga criando um link estrutural direto para a nova decisão:
```markdown
---
spec_version: "1.0"
id: "DEC-001"
title: "Autenticação Inicial por Senha"
status: "superseded"
date: "2026-08-20"
superseded_by: "DEC-002"
superseded_date: "2026-08-22"
superseded_reason: "Alunos do ensino fundamental possuem fricção com senhas complexas"
---
# Decisão
...
```

### 3.4 `glossary.md` (Contratos de Domínio & Termos Invariantes)
Armazena terminologia de domínio e contratos de entidades. Novos termos são normalizados via Unicode NFC e deduplicados de forma case-insensitive.

### 3.5 `.pactx-history.json` (Ledger de Auditoria)
Mantém o histórico imutável das mutações aplicadas, registrando hashes, revisões, timestamps e auditoria:
```json
{
  "version": "1.0",
  "applied_updates": [
    {
      "hash": "c5f89e21b8a901d4...",
      "applied_at": "2026-08-22T18:00:00.000Z",
      "forced": false,
      "base_revision": "7a9f1b2c3d4e5f60",
      "applied_revision": "8b0e2c3d4e5f6071",
      "task": "TASK-05 Autenticação via PIN",
      "created_adrs": ["DEC-002"],
      "superseded_adrs": ["DEC-001"]
    }
  ]
}
```

---

## 4. Arquitetura de Segurança Zero-Trust

O `pactx` impõe uma postura rigorosa de *Zero-Trust* sobre todas as saídas de IA, conteúdo da área de transferência, branches do Git e manipulações no sistema de arquivos.

### 4.1 Jail de Path Traversal (`assertInsideDirectory`)
- Identificadores de ADR são estritamente validados contra `/^(auto|DEC-(?!0+$)\d{3,4})$/i`.
- Os caminhos de escrita são validados via `fs.realpathSync.native`, garantindo que diretórios pai ou caminhos resolvidos nunca escapem do escopo de `.ai-context/`.

### 4.2 Proteção Anti-Symlink & Anti-Hardlink
- Antes de qualquer escrita, `safeAtomicWriteFileSync` inspeciona o arquivo com `fs.lstatSync()`.
- Se `stat.isSymbolicLink()` for verdadeiro, a escrita é abortada imediatamente com violação de segurança.
- Se `stat.nlink > 1` (tentativa de hijacking via hardlink), o link é desfeito (`unlinkSync`) antes da gravação de um novo inode exclusivo.

### 4.3 Sanitização contra Prompt Injection & Markdown Trojaning (`sanitizeBodyField`)
Conteúdo gerado por LLMs inserido em arquivos Markdown pode tentar manipular IAs downstream. A função `sanitizeBodyField` neutraliza:
- Injeção de Seções Markdown: Cabeçalhos iniciados com `#` até `######` são transformados em citações (`> `).
- Réguas Horizontais: Linhas contendo `---`, `***` ou `___` simulando quebras de frontmatter são removidas.
- Tags de Sistema e Prompts: Diretivas HTML/XML como `<system>`, `<instruction>`, `<rules>`, e comentários `<!-- ... -->` são devidamente escapados.
- Scanner Heurístico Anti-Evasão: Normaliza strings em Unicode NFKD, remove caracteres invisíveis zero-width (`\u200B-\u200D`, `\uFEFF`) e identifica tentativas de prompt injection em múltiplos idiomas.

### 4.4 Imunidade a ReDoS & Contenção de Memória
- Todas as expressões regulares utilizam quantificadores lineares, prevenindo backtracking exponencial catastrófico.
- Arrays são limitados a `MAX_ARRAY_ITEMS = 100`.
- Strings individuais são contidas em `MAX_STRING_LENGTH = 2000`.
- Lotes de ADRs são limitados a `MAX_DECISIONS_PER_BATCH = 20`.

---

## 5. Garantias de Concorrência e Transacionalidade

### 5.1 Persistência Atômica (Write-to-Temp + Atomic Rename)
Arquivos nunca são modificados no lugar:
1. O conteúdo é gravado em um arquivo temporário exclusivo: `.${filename}.${pid}.${timestamp}.${rand}.tmp`.
2. O Node executa `fs.renameSync`, garantindo substituição atômica no nível do sistema de arquivos.
3. Se qualquer etapa falhar, o arquivo temporário `.tmp` é imediatamente removido.

### 5.2 File Locking Atômico (`ContextLock`)
Para evitar condições de corrida entre múltiplos terminais ou agentes autônomos:
- A classe `ContextLock` cria `.ai-context/.pactx.lock` através de `fs.openSync` com a flag exclusiva `wx` (`O_CREAT | O_EXCL`).
- Registra PID do processo e timestamp de criação.
- Recupera stale locks de forma segura após 30 segundos de inatividade.
- Registra handlers para `SIGINT`, `SIGTERM` e `SIGHUP` para limpeza garantida do lock.

### 5.3 Controle Otimista de Concorrência (OCC)
- `getCurrentContextRevision` gera um hash SHA-256 canônico de 16 caracteres sobre `project.md`, `state.md`, `glossary.md` e todas as `decisions/*.md`.
- `pactx update` compara a `base_revision` do payload com o hash canônico atual. Se o repositório foi alterado durante a sessão de chat, um aviso de *Stale Context* é emitido, exigindo confirmação humana ou flag `--force`.

### 5.4 Rollback Transacional Instantâneo (*Fail-Closed*)
- Antes de aplicar mutações, o `applier.ts` armazena snapshots em memória de todos os arquivos alvo.
- Se ocorrer qualquer exceção ou interrupção de processo, todo o lote é revertido para o estado inicial, garantindo zero arquivos parcialmente gravados.

---

## 6. Decisões Arquiteturais e Trade-offs

| Decisão | Abordagem Escolhida | Alternativa Considerada | Racional |
|---|---|---|---|
| **Armazenamento** | Arquivos Markdown + YAML no Git | Bancos Vetoriais / RAG / Embeddings | Rastreamento nativo no Git oferece zero dependências de infraestrutura, execução 100% offline, histórico determinístico e facilidade de code review em PRs. |
| **Engine de Parsing** | Parsing de AST Seguro + Sanitização | Substituição via Regex Simples | Previne prototype pollution e corrupção estrutural de YAML, mantendo tipagem estrita de schema. |
| **Controle de Concorrência** | File Locking (`wx`) + Hash OCC de 16 caracteres | Locks de Banco / Servidor Central | Opera localmente em qualquer terminal e sistema operacional sem necessidade de daemons ou rede. |
| **Semântica de Mutação** | Merge Incremental de Patch | Sobrescrita Destrutiva de Snapshot | Impede que respostas parciais de IA apaguem inadvertidamente anotações, objetivos ou seções customizadas do desenvolvedor. |
