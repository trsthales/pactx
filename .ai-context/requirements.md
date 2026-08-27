---
spec_version: "1.0"
requirements:
  - id: "REQ-001"
    status: active
    type: functional
    title: "Desacoplamento de Estado Canônico e Egress Git-Native"
    satisfied_by: ["DEC-001"]
  - id: "REQ-002"
    status: active
    type: functional
    title: "Ingestão em Loop Fechado com Semântica de Patch"
    satisfied_by: ["DEC-002"]
  - id: "REQ-003"
    status: active
    type: security
    title: "Contenção em Jail de Diretório e Proteção Anti-Symlink/Hardlink"
    satisfied_by: ["DEC-003"]
  - id: "REQ-004"
    status: active
    type: compliance
    title: "Transacionalidade Durável com Write-Ahead Logging (WAL)"
    satisfied_by: ["DEC-004"]
  - id: "REQ-005"
    status: active
    type: functional
    title: "Reversão Determinística e Proteção de Grafo (Graph-Safe Rollback)"
    satisfied_by: ["DEC-004"]
  - id: "REQ-006"
    status: active
    type: performance
    title: "Telemetria Determinística e Monitoramento de Context Health"
    satisfied_by: ["DEC-005"]
  - id: "REQ-007"
    status: active
    type: functional
    title: "Captura de Micro-Âncoras em Tempo Real e Extração Fora da Banda"
    satisfied_by: ["DEC-005"]
  - id: "REQ-008"
    status: active
    type: functional
    title: "Servidor MCP Nativo sobre Stdio com Propostas Desacopladas"
    satisfied_by: ["DEC-006"]
---
# Requisitos e Regras de Negócio — PactX

Este documento registra os requisitos fundamentais, regras de negócio e restrições de engenharia que o PactX deve obrigatoriamente satisfazer.

---

### [REQ-001] Desacoplamento de Estado Canônico e Egress Git-Native
- **Tipo:** Funcional
- **Status:** Ativo
- **Declaração:** O sistema deve inspecionar o repositório Git e a pasta `.ai-context/` para compor um Context Pack compacto em Markdown (~400 tokens) para a área de transferência, mantendo o repositório local como a única autoridade canônica da verdade e tratando a IA como uma unidade de processamento sem estado (*stateless compute*).

---

### [REQ-002] Ingestão em Loop Fechado com Semântica de Patch
- **Tipo:** Funcional
- **Status:** Ativo
- **Declaração:** O sistema deve ingerir propostas estruturadas de mutação (`pactx-update`), aplicando alterações de forma incremental (*Patch Semantics*) sem nunca destruir campos omitidos ou seções manuais customizadas do usuário em `state.md` ou `requirements.md`.

---

### [REQ-003] Contenção em Jail de Diretório e Proteção Anti-Symlink/Hardlink
- **Tipo:** Segurança
- **Status:** Ativo
- **Declaração:** O sistema deve tratar toda saída de IA como entrada não confiável (*Zero-Trust*), validando caminhos físicos com `fs.realpathSync.native` contidos na raiz do repositório, bloqueando links simbólicos e hardlinks compartilhados (`nlink > 1`), neutralizando injeções de tags/cabeçalhos e impedindo ataques de ReDoS com regexes lineares.

---

### [REQ-004] Transacionalidade Durável com Write-Ahead Logging (WAL)
- **Tipo:** Conformidade / Confiabilidade
- **Status:** Ativo
- **Declaração:** Toda mutação canônica deve ser registrada previamente em diários de transação (`PREPARED` ➔ `APPLYING` ➔ `COMMITTED`), com escritas atômicas (*Write-to-Temp + Rename*), recuperação automática no boot sob `ContextLock` com token UUID exclusivo e proteção anti-loop de recuperação ($\ge 3$ tentativas ➔ `FAILED`/`RECOVERY_REQUIRED`).

---

### [REQ-005] Reversão Determinística e Proteção de Grafo (Graph-Safe Rollback)
- **Tipo:** Funcional
- **Status:** Ativo
- **Declaração:** O sistema deve permitir a reversão atômica de transações passadas protegida por WAL (LIFO padrão ou por hash direcionado), bloqueando a reversão de transações intermediárias caso haja decisões ou requisitos posteriores ativos dependendo daquele lote, a menos que `--force-cascade` seja explicitamente invocado.

---

### [REQ-006] Telemetria Determinística e Monitoramento de Context Health
- **Tipo:** Performance / Observabilidade
- **Status:** Ativo
- **Declaração:** O sistema deve calcular estimativas locais de consumo de tokens ponderando código (~3 chars/token) e prosa (~4 chars/token) com margem de segurança de 15%, classificando a saúde da sessão em 5 zonas de risco operacional (`SAFE`, `WATCH`, `CAUTION`, `WARNING`, `CRITICAL`) com nível de confiança explícito (`EXACT`, `ESTIMATED`, `UNKNOWN`).

---

### [REQ-007] Captura de Micro-Âncoras em Tempo Real e Extração Fora da Banda
- **Tipo:** Funcional
- **Status:** Ativo
- **Declaração:** O sistema deve suportar anotações invisíveis `<!-- pactx:v1 ... -->` e diretivas do desenvolvedor (`/remember`, `/pin`, `@pactx`) durante a conversa para persistência em `anchors.jsonl`, além de permitir extração fora da banda (`pactx extract`) de transcripts completos em duas fases (determinística local + modelo limpo suplementar com *Evidence Spans*).

---

### [REQ-008] Servidor MCP Nativo sobre Stdio com Propostas Desacopladas
- **Tipo:** Funcional / Interoperabilidade
- **Status:** Ativo
- **Declaração:** O sistema deve expor resources (`context`, `health`, `status`) e tools (`record_anchor`, `get_context_health`, `propose_mutation`, `apply_mutation`) sobre o protocolo Model Context Protocol (MCP) para integração nativa com Cursor, Claude Desktop e IDEs, garantindo que propostas de mutação gerem identificadores auditáveis (`proposalId`) com revisão humana antes da aplicação canônica.