<p align="center">
  <img src="img/logo.png" alt="pactx banner" width="450">
</p>

# pactx 📦

> **Motor universal de continuidade de contexto em loop fechado e handoff para desenvolvimento assistido por IA.**  
> Mantenha sua IA alinhada entre chats, modelos e sessões sem degradação de contexto ou manutenção manual de estado.

🌐 **Idioma / Language:** [Português (Brasil)](./README.pt-BR.md) | [English](./README.md)

[![npm version](https://img.shields.io/npm/v/@trsthales/pactx.svg)](https://www.npmjs.com/package/@trsthales/pactx)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## O Problema: "Amnésia e Degradação de Contexto em IAs"

Sessões longas de chat sofrem com degradação da janela de contexto, alucinações e perda de restrições arquiteturais. Ao alternar entre chats ou modelos (ChatGPT ⇄ Claude ⇄ Gemini ⇄ Cursor), pedir a uma IA com contexto degradado para *"resumir o que fizemos"* resulta em decisões esquecidas, repetição de erros e desperdício de tokens.

**LLMs são motores computacionais sem estado (stateless). Seu projeto é estado persistente.**

---

## A Solução: Memória de Loop Fechado com `pactx`

O `pactx` transforma seu repositório na **fonte canônica da verdade** e cria uma **ponte bidirecional** entre sua base de código e qualquer modelo de IA.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          SEU REPOSITÓRIO                               │
│      .ai-context/ (projeto, estado, ADRs ativas, glossário)            │
│      + Estado do Git em Runtime (branch, commits recentes, diff)       │
└──────────────────┬──────────────────────────────────▲──────────────────┘
                   │                                  │
      1. npx @trsthales/pactx │        3. npx @trsthales/pactx │ update
         (Egresso) │                        (Ingresso)│ (Human-in-the-Loop)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  📋 Contexto Otimizado       │   │  📦 Bloco pactx-update          │
    │     (Copiado p/ Clipboard)   │   │     (ADRs, Fatos, Hipóteses)    │
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   ▼                                  │ 2. /handoff
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │            QUALQUER IA (ChatGPT / Claude / Gemini / Cursor)        │
    └────────────────────────────────────────────────────────────────────┘
```

1. **Egresso (`pactx` / `pack`):** Inspeciona especificações do projeto, ADRs ativas e o delta do Git para gerar um pacote Markdown limpo e com consumo mínimo de tokens.
2. **Ingresso (`pactx update`):** Ingere o bloco estruturado de handoff da IA, valida schema e regras de segurança, exibe revisão completa e persiste decisões, fatos e tarefas de forma atômica em `.ai-context/`.

---

## Início Rápido (Quickstart)

Nenhuma instalação global é necessária:

### 1. Inicialize o `.ai-context/` no seu repositório
```bash
npx @trsthales/pactx init
```

Isso gera a estrutura canônica de diretórios:
```text
.ai-context/
├── project.md      # Identidade estática, stack e regras invioláveis
├── requirements.md # Requisitos canônicos & regras de negócio (REQ-001)
├── state.md        # Tarefa ativa, fatos, impedimentos, hipóteses descartadas
├── glossary.md     # Contratos invariantes, tabelas, termos de domínio
└── decisions/      # Micro-ADRs versionadas (DEC-001.md)
```

### 2. Empacote o Contexto & Inicie a Sessão (1 Segundo)
```bash
npx @trsthales/pactx
```
Saída:
```text
✔ Context packed successfully!
📋 Copied to clipboard!
Size: 1.45 KB | ~380 tokens

👉 Paste directly into ChatGPT, Claude, Gemini, or your coding agent!
```
Cole (`Ctrl+V`) em qualquer chat de IA. O modelo entenderá instantaneamente a tarefa exata, arquitetura ativa, regras invioláveis e hipóteses já descartadas.

### 3. Feche o Loop & Persista o Estado
Ao concluir uma tarefa ou antes de trocar de chat, peça à IA:
> `"/handoff"` *(ou "Gere o bloco pactx-update")*

Copie a resposta da IA e execute no seu terminal:
```bash
npx @trsthales/pactx update
```

Interface Interativa de Revisão:
```text
📦 pactx-update block detected!

Canonical Mutation Plan:
────────────────────────────────────────────────────────────────────────────
📝 .ai-context/state.md
   • Active Task: "TASK-05 Login de Alunos via PIN" [IN_PROGRESS]
   • Next Action: "Implementar validação do StudentPIN no authController"
   • [+] Fact: "Rate limit de login por PIN deve ser restrito a 5 tentativas por minuto"
   • [+] Discarded Hypothesis: "O login de alunos NÃO deve exigir e-mail ou senha"
📋 .ai-context/requirements.md [CREATE]
   • [REQ-002] "Student PIN Security Policy" (functional)
     Statement: "Alunos devem se autenticar através de PIN de 4 dígitos com rate limit restrito."
🏛️  .ai-context/decisions/DEC-002.md [CREATE]
   • Title: "Autenticação de Alunos via PIN Numérico de 4 Dígitos"
   • Satisfies: REQ-002
   • Decision: "Utilizar combinação de Turma + PIN com hash seguro no PostgreSQL"
📖 .ai-context/glossary.md [APPEND]
   • StudentPIN: "Código numérico de 4 dígitos atribuído ao aluno"
────────────────────────────────────────────────────────────────────────────

? Apply canonical changes to repository? (Y/n) y

✔ Canonical state updated successfully!
📋 Audit ledger recorded in .ai-context/.pactx/ledger.json
```

---

## O Schema do Bloco `pactx-update` (v1.1)

As IAs emitem o bloco de atualização encapsulado na cerca de código `pactx-update`:

````yaml
```pactx-update
version: "1.1"
base_revision: "2a0de5fa8c9b10e4"

source:
  type: "conversation" # conversation | agent | manual | document
  model: "Gemini 1.5 Pro"
  session_topic: "Implementação da autenticação por PIN"

state:
  active_task: "TASK-05 Login de Alunos via PIN"
  status: "IN_PROGRESS" # IN_PROGRESS | BLOCKED | COMPLETED
  recommended_model: "Medium" # Medium | High
  completed_items:
    - "Definição do fluxo de autenticação por PIN"
  new_facts:
    - "Rate limit de login por PIN restrito a 5 tentativas por minuto"
  rejected_hypotheses:
    - "O login de alunos NÃO deve exigir e-mail ou senha alfanumérica"
  next_action: "Implementar validação no controller e aplicar rate limit"

new_requirements:
  - id: "auto" # gera automaticamente REQ-002
    type: "functional" # functional | security | performance | compliance
    title: "Student PIN Security Policy"
    statement: "Alunos devem se autenticar através de PIN de 4 dígitos com rate limit restrito."

new_decisions:
  - id: "auto" # O pactx calcula automaticamente a próxima sequência (DEC-002)
    title: "Autenticação de Alunos via PIN Numérico de 4 Dígitos"
    reason: "Alunos do ensino fundamental possuem fricção com senhas complexas"
    decision: "Utilizar Turma + PIN de 4 dígitos com hash seguro"
    satisfies: ["REQ-002"]

superseded_decisions:
  - id: "DEC-001"
    by: "auto" # ou ID específico
    reason: "Substituída pelo novo modelo de multi-tenancy"

new_glossary_terms:
  - term: "StudentPIN"
    definition: "Código numérico de 4 dígitos atribuído ao aluno"
```
````

---

## Referência da CLI

### Comandos Principais
| Comando / Flag | Descrição |
|---|---|
| `pactx` / `pactx pack` | Lê o estado do repositório, copia o pacote de contexto para o clipboard e exibe estatísticas |
| `pactx init` | Cria a estrutura de diretórios `.ai-context/` com templates iniciais |
| `pactx status` | Exibe o dashboard visual executivo da memória cognitiva e estado do git |
| `pactx status --json` | Emite o status completo estruturado em formato JSON para automações |
| `pactx diff` | Inspeciona e exibe o plano de mutação colorido sem gravar arquivos no disco |
| `pactx diff --file <path>` | Inspeciona plano de mutação a partir de um arquivo específico |
| `pactx diff --stdin` | Inspeciona plano de mutação recebido via pipe |
| `pactx rollback [hash]` | Reversão Graph-Safe & WAL-Protected da transação mais recente (LIFO) ou hash específico |
| `pactx rollback --force-cascade` | Reverte automaticamente em cascata todas as transações dependentes posteriores |
| `pactx doctor` | Valida a saúde e integridade do repositório contra 8 regras fundamentais |
| `pactx doctor --fix` | Repara automaticamente locks abandonados, limpa temporários e poda registros antigos |

### Comandos de Ingestão (`pactx update`)
| Comando / Flag | Descrição |
|---|---|
| `pactx update` | Lê o clipboard, valida o payload, exibe o plano em texto integral e solicita confirmação |
| `pactx update -y`, `--yes` | Aplica as alterações sem confirmação interativa (mantém todas as validações de segurança e integridade) |
| `pactx update --dry-run` | Simula e exibe o plano de mutação completo sem gravar arquivos no disco |
| `pactx update --file <path>` | Lê o bloco `pactx-update` a partir de um arquivo markdown ou log |
| `pactx update --stdin` | Lê o bloco via pipe (`cat response.md \| pactx update --stdin`) |
| `pactx update --force` | Força a aplicação mesmo na presença de avisos críticos (como Stale Context com `-y`) |

---

## Segurança de Nível Industrial & Arquitetura Zero-Trust

O `pactx update` trata todas as saídas de IA como **entradas não confiáveis**:

1. **Write-Ahead Logging (WAL):** Mutações de múltiplos arquivos são orquestradas via manifestos WAL atômicos (`PREPARED` -> `APPLYING` -> `COMMITTED` / `ROLLED_BACK`). Quedas de processo disparam auto-recovery transparente no boot.
2. **Jail de Diretórios & Anti-Path Traversal:** Identificadores de ADR e Requisitos são restritos à regex `/^(auto\|DEC-(?!0+$)\d{3,4}\|REQ-(?!0+$)\d{3,4})$/i`. Escritas são presas dentro de `.ai-context/` com validação de `realpath`.
3. **Serialização Segura via AST:** Nenhuma interpolação ingênua de strings em YAML. Todos os frontmatters são gerados através de dumpers formais de YAML para prevenir injeção estrutural.
4. **Reversão Graph-Safe:** O rollback analisa vínculos dependentes (`satisfies`, `superseded_by`) e impede estados corrompidos ou inconsistentes.
5. **Idempotência Canônica:** Payloads são normalizados e registrados com hash SHA-256 no arquivo `.ai-context/.pactx/ledger.json`. Executar o mesmo clipboard novamente resulta em No-Op seguro.
6. **Revisão Humana Anti-Envenenamento:** O terminal exibe o texto literal e completo de cada decisão, requisito, fato e hipótese antes de solicitar a confirmação do desenvolvedor.
7. **File Locking Concorrente:** Proteção contra escritas simultâneas em múltiplos terminais via `.pactx.lock` exclusivo e tratamento de sinais (`SIGINT`, `SIGTERM`, `SIGHUP`).

---

## Especificação dos Arquivos (`.ai-context/`)

```text
.ai-context/
├── project.md            # Visão, stack tecnológica e regras invioláveis
├── requirements.md       # Requisitos canônicos & regras de negócio (REQ-001)
├── state.md              # Tarefa ativa, itens concluídos, fatos e hipóteses descartadas
├── glossary.md           # Termos de domínio, contratos de API e entidades
├── decisions/
│   ├── DEC-001.md        # ADRs ativas ou obsoletas com linhagem estrutural & vínculos satisfies
│   └── DEC-002.md
└── .pactx/
    ├── ledger.json       # Ledger de auditoria com hashes SHA-256 aplicados
    ├── .pactx.lock       # Lockfile de concorrência atômica
    └── transactions/     # Manifestos do Write-Ahead Log (WAL) (TX-<hash>.json)
```

---

## Documentação

- 📖 **[Tutorial Passo a Passo](./docs/TUTORIAL.pt-BR.md)** — Guia prático sobre como integrar e usar o `pactx` no seu fluxo diário.
- 🏛️ **[Especificação Técnica & Arquitetura](./docs/ARCHITECTURE.pt-BR.md)** — Detalhamento técnico sobre o motor de loop fechado, modelo de segurança e garantias transacionais.

---

## Licença

Distribuído sob a licença **MIT**. Consulte o arquivo [`LICENSE`](./LICENSE) para obter mais informações.izados e registrados com hash SHA-256 no arquivo `.ai-context/.pactx-history.json`. Executar o mesmo clipboard novamente resulta em No-Op seguro.
5. **Revisão Humana Anti-Envenenamento:** O terminal exibe o texto literal e completo de cada decisão, fato e hipótese antes de solicitar a confirmação do desenvolvedor.
6. **File Locking Concorrente:** Proteção contra escritas simultâneas em múltiplos terminais via `.pactx.lock` exclusivo e tratamento de sinais (`SIGINT`, `SIGTERM`, `SIGHUP`).

---

## Especificação dos Arquivos (`.ai-context/`)

```text
.ai-context/
├── project.md            # Visão, stack tecnológica e regras invioláveis
├── state.md              # Tarefa ativa, itens concluídos, fatos e hipóteses descartadas
├── glossary.md           # Termos de domínio, contratos de API e entidades
├── .pactx-history.json   # Ledger de auditoria com hashes SHA-256 aplicados
└── decisions/
    ├── DEC-001.md        # ADRs ativas ou obsoletas com linhagem estrutural
    └── DEC-002.md
```

---

## Documentação

- 📖 **[Tutorial Passo a Passo](./docs/TUTORIAL.pt-BR.md)** — Guia prático sobre como integrar e usar o `pactx` no seu fluxo diário.
- 🏛️ **[Especificação Técnica & Arquitetura](./docs/ARCHITECTURE.pt-BR.md)** — Detalhamento técnico sobre o motor de loop fechado, modelo de segurança e garantias transacionais.

---

## Licença

Distribuído sob a licença **MIT**. Consulte o arquivo [`LICENSE`](./LICENSE) para obter mais informações.
