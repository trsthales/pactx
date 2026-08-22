# RFC-001: The Closed-Loop Mutation Protocol (`pactx update`)

* **RFC Number:** 001
* **Version:** 1.2 (Enterprise Hardened & Transactional)
* **Status:** FINAL / ACCEPTED
* **Target Release:** `pactx v0.2.0`
* **Authors:** pactx core team

---

## 1. Visão Geral e Modelo Conceitual

A RFC-001 estabelece o **Loop Fechado de Continuidade de Estado (Read/Write Loop)** para o `pactx`. O protocolo transforma a ferramenta de um *Context Packer* unidirecional em um **Motor Transacional de Memória Persistente de Projeto**.

### 1.1 Separação Canônica de Papéis
O sistema opera sob o modelo estrito de três camadas:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. IA (Proponente Não Confiável)                                        │
│    Emite propostas de mutação estruturada (Candidate State).            │
│    Zero permissão de escrita ou execução direta no sistema.             │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. pactx (Orquestrador & Guardião Transacional)                          │
│    Valida schemas, isola paths (Jail), normaliza, previne injeções,      │
│    avalia concorrência, calcula planos em memória e gerencia rollback.  │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. Desenvolvedor (Autoridade Canônica)                                  │
│    Revisa o texto integral do plano e autoriza a persistência no disco. │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. O Schema do Bloco de Ingestão (`pactx-update`)

A saída emitida pela IA ao final de uma sessão, após tomada de decisão ou sob comando `/handoff` deve conter um bloco de código delimitado com a tag `pactx-update` contendo YAML estritamente formatado.

### 2.1 Especificação do Payload (YAML)

````yaml
```pactx-update
version: "1.0"
base_revision: "a7f3b8" # Hash de 6 caracteres do contexto fornecido no pactx pack

source: # Metadados opcionais de proveniência
  model: "Gemini 1.5 Pro"
  session_topic: "Implementação do guard de autenticação multi-tenant"

state:
  active_task: "TK-02 Auth Guard"
  status: "IN_PROGRESS" # IN_PROGRESS | BLOCKED | COMPLETED
  recommended_model: "High" # Medium | High

  completed_items:
    - "Interceptor HTTP criado para injeção de Tenant-ID"
    - "Testes de validação de token concluídos (14/14 verdes)"

  new_facts:
    - "O proxy reverso remove o cabeçalho Authorization se a rota não estiver na allowlist"

  rejected_hypotheses:
    - "O erro 403 não era CORS; o header Authorization estava sendo limpo pelo proxy"

  next_action: "Implementar mutex no refresh token para evitar race condition na renovação"

new_decisions:
  - id: "auto" # 'auto' delega ao pactx a numeração sequencial segura (DEC-002)
    title: "Isolamento de banco de dados por Tenant"
    reason: "Garantir conformidade com a LGPD e permitir backups independentes por escola"
    decision: "Cada escola terá um banco de dados SQLite/PostgreSQL isolado gerenciado dinamicamente"

superseded_decisions:
  - id: "DEC-001"
    by: "auto" # 'auto' vincula à nova decisão gerada neste lote, ou ID explícito (DEC-002)
    reason: "Substituída após validação de requisitos de isolamento multi-tenant"

new_glossary_terms:
  - term: "TenantContext"
    definition: "Contexto em memória responsável por propagar o tenant ativo na thread da requisição"
```
````

---

## 3. Diretrizes de Segurança & Zero-Trust Architecture

Toda entrada proveniente de uma IA é tratada como **não confiável** (*Untrusted Input*).

### 3.1 Prevenção de Path Traversal & Allowlist de Identificadores
* Qualquer identificador de ADR fornecido no YAML (`new_decisions[].id` ou `superseded_decisions[].id`) deve satisfazer estritamente:
  $$\text{Regex de ID}: \quad \texttt{/^(auto|DEC-\textbackslash d\{3,4\})\$/i}$$
* Se um identificador contiver `/`, `\`, `..`, bytes nulos ou qualquer caractere fora da allowlist, o parser **rejeita a operação imediatamente** (*Fail-Closed*).
* O payload **nunca fornece caminhos de arquivo** (`targetFile`). O `pactx` é a única entidade autorizada a mapear identificadores semânticos para caminhos no disco, garantindo contenção absoluta dentro de `.ai-context/`.

### 3.2 Serialização Segura (Anti-Injeção Estrutural)
* **Zero interpolação manual de template strings para YAML/Frontmatter.**
* O `pactx` utiliza obrigatoriamente um serializador formal (`yaml.dump()`), que realiza o escape de quebras de linha (`\n`), aspas e caracteres de controle, impedindo que títulos ou descrições injetem chaves não autorizadas no frontmatter.

### 3.3 Allowlist de Capacidades do Engine
O `pactx update` opera como um sistema de mutação restrito. Operações fora da allowlist são bloqueadas:

```text
OPERAÇÕES PERMITIDAS:
  ✔ UPDATE state.md (metadados, tarefas, fatos, hipóteses e próxima ação)
  ✔ CREATE decisions/DEC-%03d.md (novos ADRs com status active)
  ✔ MODIFY decisions/DEC-%03d.md (apenas frontmatter: status superseded e superseded_by)
  ✔ APPEND glossary.md (novos termos invariantes)
  ✔ WRITE .pactx-history.json (registro de auditoria e idempotência)

OPERAÇÕES ESTRITAMENTE PROIBIDAS:
  ✖ Escrita ou alteração de arquivos fora de .ai-context/
  ✖ Deleção de qualquer arquivo
  ✖ Alteração de código-fonte, configurações do Git ou scripts
  ✖ Execução de comandos do sistema
```

### 3.4 Scanner Heurístico Anti-Poisoning
Para evitar que *Prompt Injections* sejam aprovadas por engano e virem estado canônico persistente, o `pactx` inspeciona todos os campos de texto. Se identificar padrões como:
* Frases de override de instrução (`ignore previous instructions`, `system prompt override`);
* Cercas de código aninhadas (```` ``` ````);
* Cabeçalhos Markdown de sistema (`### SYSTEM`, `### INSTRUCTION`);

O CLI emite um aviso em amarelo e destaca o texto suspeito para revisão antes da confirmação humana.

### 3.5 Invariantes da Flag `--yes`
* `--yes` / `-y` **apenas pula a confirmação interativa do terminal (`readline`)**.
* `--yes` **nunca** ignora validações de schema, regras de jail de path, auditoria de segurança ou idempotência.

---

## 4. O Motor Transacional & O `MutationPlan`

A aplicação de mutações segue uma esteira determinística de 6 estágios:

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  1. Ingest   │ ──► │  2. Validate │ ──► │  3. Plan     │
│ (Clip/Stdin) │     │ (Zero-Trust) │     │  (In-Memory) │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
┌──────────────┐     ┌──────────────┐            ▼
│  6. Atomic   │ ◄── │  5. Full-Text│ ◄── ┌──────────────┐
│ Commit/Rollbk│     │    Review    │     │4. Canonical  │
└──────────────┘     └──────────────┘     │ Idempotency  │
                                          └──────────────┘
```

### 4.1 Interface TypeScript do `MutationPlan`

```typescript
export interface MutationPlan {
  schemaVersion: string;
  baseRevision?: string;
  canonicalHash: string; // SHA-256 do objeto normalizado
  source?: {
    model?: string;
    sessionTopic?: string;
  };
  warnings: string[]; // Concorrência otimista e alertas heurísticos
  operations: {
    stateUpdate?: {
      activeTask: string;
      status: 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';
      recommendedModel: 'Medium' | 'High';
      newCompletedItems: string[];
      newFacts: string[];
      newRejectedHypotheses: string[];
      nextAction: string;
    };
    createdAdrs: Array<{
      id: string; // ex: "DEC-002"
      targetPath: string;
      title: string;
      reason: string;
      decision: string;
      date: string;
    }>;
    supersededAdrs: Array<{
      id: string; // ex: "DEC-001"
      targetPath: string;
      supersededBy: string; // ex: "DEC-002"
      reason: string;
      date: string;
    }>;
    appendedGlossaryTerms: Array<{
      term: string;
      definition: string;
    }>;
  };
}
```

### 4.2 Idempotência Canônica & Ledger de Histórico
Para evitar falsas divergências por espaçamento ou aspas, o hash de idempotência é calculado a partir do **objeto normalizado**:

$$\text{Raw YAML} \xrightarrow{\text{parse}} \text{Objeto JS} \xrightarrow{\text{ordenar chaves / JSON estável}} \text{SHA-256 (canonicalHash)}$$

1. O `pactx` mantém o ledger persistente em `.ai-context/.pactx-history.json`.
2. Se o `canonicalHash` já estiver registrado no histórico, o comando exibe a data de aplicação anterior e encerra com status de sucesso (*No-Op* seguro).
3. Adicionalmente, ADRs passam por deduplicação semântica: decisões com título e conteúdo idênticos já persistidos não são recriadas.

### 4.3 Controle Otimista de Concorrência (`base_revision`)
1. O `pactx pack` inclui no contexto um hash de 6 caracteres do estado atual (ex: `rev: "a7f3b8"`).
2. Se o `base_revision` do update divergir do hash canônico atual do repositório, o `pactx update` emite um aviso explícito:
   ```text
   ⚠️ AVISO DE CONCORRÊNCIA: O repositório foi modificado localmente após a geração
      deste contexto. Revise as alterações com atenção antes de confirmar.
   ```

### 4.4 Atomicidade Multi-Arquivo (Snapshot em Memória & Rollback)
Para evitar estados parciais e corrompidos em caso de falha de I/O ou encerramento abrupto:
1. **Pre-flight Snapshot:** Antes de escrever, o `pactx` carrega o conteúdo original de todos os arquivos alvos para a memória.
2. **Write Loop:** Realiza as escritas sequenciais em `.ai-context/`.
3. **Rollback Trigger:** Se **qualquer** escrita falhar ou lançar exceção:
   * Restaura imediatamente o conteúdo original de todos os arquivos a partir do snapshot em memória.
   * Deleta quaisquer arquivos novos que tenham sido criados no lote.
   * Aborta o processo garantindo **zero mutações residuais** (*Fail-Closed*).

---

## 5. Regras de Mutação de Entidades

### 5.1 Numeração Sequencial de ADRs (`DEC-%03d`)
* Quando `new_decisions[].id` for `"auto"`, o `pactx` escaneia `decisions/`, identifica o maior índice numérico e gera o próximo ID formatado com 3 dígitos (ex: `DEC-001`, `DEC-002`, ..., `DEC-010`).

### 5.2 Relação Estrutural de Decisões Substituídas
Ao marcar uma decisão como substituída, o frontmatter do arquivo original é atualizado estruturalmente:

```yaml
---
id: "DEC-001"
title: "Database Isolation per School"
status: "superseded"
superseded_by: "DEC-002"
superseded_date: "2026-08-22"
---
```

### 5.3 Normalização de Hipóteses e Fatos
* Hipóteses e Fatos passam por normalização (remoção de pontuações redundantes e comparação insensível a maiúsculas/minúsculas).
* Itens idênticos aos já existentes em `state.md` são ignorados; itens inéditos são adicionados via *append*.

---

## 6. Experiência de Uso (CLI UX)

### 6.1 Revisão em Texto Integral (Anti-Aprovação Cega)
O CLI exibe o **conteúdo integral dos itens** que serão gravados, garantindo que o desenvolvedor leia exatamente o que está aprovando:

```text
$ npx pactx update

📦 Bloco pactx-update detectado na Área de Transferência!

Plano de Mutação Canônica:
────────────────────────────────────────────────────────────────────────────
📝 .ai-context/state.md
   • Tarefa Ativa: "TK-02 Auth Guard" [IN_PROGRESS | High Reasoning]
   • Próximo Passo: "Implementar mutex no refresh token para evitar race condition"
   • [+] Novo Fato: "O proxy reverso remove o cabeçalho Authorization..."
   • [+] Nova Hipótese Descartada: "O erro 403 não era CORS..."

🏛️  .ai-context/decisions/DEC-002.md [CREATE]
   • Título: "Isolamento de banco de dados por Tenant"
   • Decisão: "Cada escola terá um banco de dados SQLite/PostgreSQL isolado..."

🏛️  .ai-context/decisions/DEC-001.md [SUPERSEDE]
   • Status: active ➔ superseded (Substituída por DEC-002)

📖 .ai-context/glossary.md [APPEND]
   • TenantContext: "Contexto em memória responsável por propagar o tenant..."
────────────────────────────────────────────────────────────────────────────

? Deseja aplicar as alterações canônicas ao repositório? (Y/n) Y

✔ Estado canônico atualizado com sucesso! (4 operações persistidas)
📋 Ledger de auditoria gravado em .ai-context/.pactx-history.json
```

### 6.2 Modo de Simulação (`--dry-run`)
Valida o payload, calcula o `canonicalHash`, monta o `MutationPlan` e exibe a visualização completa sem alterar 1 único byte no disco:
```bash
npx pactx update --dry-run
```

---

## 7. CLI Commands & Flags Reference

| Comando / Flag | Comportamento |
|---|---|
| `pactx update` | Lê do Clipboard, valida, apresenta o plano em texto integral e solicita confirmação |
| `pactx update -y`, `--yes` | Aplica o plano sem confirmação interativa (mantendo 100% das validações de segurança) |
| `pactx update --dry-run` | Simula a execução e exibe o plano sem tocar no disco |
| `pactx update --file <path>` | Lê o bloco a partir de um arquivo local |
| `pactx update --stdin` | Recebe a entrada via pipe: `cat resposta.md \| pactx update --stdin` |

---

## 8. Integração no Egress Prompt (`composer.ts`)

O `composer.ts` passa a injetar a diretriz canônica de encerramento com regras expressas **anti-alucinação**:

```markdown
### PROTOCOLO DE ENCERRAMENTO & HANDOFF CANÔNICO:
Ao concluir uma tarefa, estabelecer decisões arquiteturais ou quando o usuário solicitar "/handoff",
emita OBRIGATORIAMENTE um bloco com a tag ```pactx-update ... ``` seguindo o schema abaixo.

DIRETRIZES FUNDAMENTAIS:
1. Registre APENAS fatos, tarefas e decisões efetivamente estabelecidos nesta sessão.
2. NUNCA invente decisões arquiteturais para preencher o schema. Se nada foi decidido, use listas vazias ([]).
3. Seja conciso e preciso nos motivos e decisões.

```pactx-update
version: "1.0"
base_revision: "{{CONTEXT_REVISION_HASH}}"
state:
  active_task: "<nome da tarefa ativa>"
  status: "IN_PROGRESS | BLOCKED | COMPLETED"
  recommended_model: "Medium | High"
  completed_items:
    - "<item concluído>"
  new_facts:
    - "<descoberta ou fato comprovado no runtime>"
  rejected_hypotheses:
    - "<hipótese testada e comprovadamente falsa>"
  next_action: "<ação imediata seguinte>"
new_decisions:
  - id: "auto"
    title: "<título da decisão>"
    reason: "<motivo>"
    decision: "<decisão técnica tomada>"
superseded_decisions:
  - id: "<ID ex: DEC-001>"
    by: "auto"
    reason: "<motivo da substituição>"
new_glossary_terms:
  - term: "<Termo>"
    definition: "<Definição invariante>"
```
```

---

## 9. Definition of Done & Critérios de Aceite (DoD)

- [ ] Parser YAML formal utilizando biblioteca de serialização segura (`yaml`).
- [ ] Validação de identificadores de ADR contra a regex `/^(auto|DEC-\d{3,4})$/i`.
- [ ] Cálculo de hash canônico normalizado e persistência em `.ai-context/.pactx-history.json`.
- [ ] Motor transacional com snapshot em memória e rollback automático em caso de erro.
- [ ] Renderização em texto integral no CLI antes da confirmação humana.
- [ ] Suporte a `--dry-run`, `--yes`, `--file` e `--stdin`.
- [ ] Cobertura de testes unitários abrangendo:
  - Caminho feliz completo (criação de ADR, supersede, state update, glossário);
  - Tentativas de injeção e path traversal (garantindo rejeição e erro);
  - Idempotência canônica (re-execução resultando em no-op);
  - Rollback em caso de falha simulada no meio da escrita.
```