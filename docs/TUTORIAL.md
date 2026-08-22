# pactx Tutorial: Step-by-Step Practical Guide 🚀

🌐 **Language / Idioma:** [English](./TUTORIAL.md) | [Português (Brasil)](./TUTORIAL.pt-BR.md)

This tutorial walks you through how to use `pactx` in your daily development workflow with any AI model (ChatGPT, Claude, Gemini, Cursor, Copilot, etc.) to achieve closed-loop memory and seamless context continuity.

---

## Prerequisites

- **Node.js**: v18.0.0 or higher (`node -v`)
- **Git**: Installed and initialized in your project repository
- **No global installation required**: Run directly via `npx pactx`

---

## Step 1: Initialize Your Repository (`pactx init`)

Inside your project root directory, run:

```bash
npx pactx init
```

Output:
```text
✔ Estrutura .ai-context criada com sucesso!
👉 Edite os arquivos em .ai-context/ e rode a ferramenta para copiar o contexto.
```

This creates the canonical `.ai-context/` directory in your workspace:

```text
.ai-context/
├── project.md      # Static identity, stack, and non-negotiable rules
├── state.md        # Active sprint/task, facts, blockers, rejected hypotheses
├── glossary.md     # Invariant contracts, table names, domain terms
└── decisions/      # Versioned micro-ADRs (DEC-001.md, DEC-002.md)
```

### Customizing Initial State

Open `.ai-context/project.md` and define your project's stack and invariant rules:

```markdown
---
spec_version: "1.0"
project: "EduTrack Portal"
version: "0.1.0"
stack: ["Node.js", "TypeScript", "Fastify", "PostgreSQL", "Prisma"]
---
# Visão do Projeto
Plataforma educacional para acompanhamento de frequência e desempenho de alunos.

# Regras Invioláveis
1. Todo endpoint novo deve possuir validação estrita com schemas Zod.
2. Nunca execute migrações de banco destrutivas sem aprovação prévia.
3. Tratamento de erros deve seguir o padrão RFC-7807 (Problem Details).
```

Edit `.ai-context/state.md` with your current objective:

```markdown
---
spec_version: "1.0"
sprint: "SPRINT_01"
active_task: "TASK-01 Autenticação de Alunos via PIN"
recommended_model: "High"
status: "IN_PROGRESS"
---
# Objetivo Atual
Implementar o endpoint de autenticação de alunos utilizando código de turma e PIN de 4 dígitos.

# O que foi feito recentemente
- [x] Configuração da stack base e Prisma ORM.

# Fatos & Descobertas
- (Nenhum)

# Hipóteses Descartadas / Erros Conhecidos (NÃO REPETIR)
- (Nenhuma)

# Próxima Ação Imediata
Criar schema Zod e controller para rota POST /auth/student-pin.
```

---

## Step 2: Egress Flow — Pack Context (`pactx pack` / `pactx`)

Whenever you start a new AI chat or need to re-align your current session, run:

```bash
npx pactx
```

Output:
```text
✔ Context packed com sucesso!
📋 Copiado para a Área de Transferência!
Tamanho: 1.45 KB | ~380 tokens

👉 Cole diretamente no ChatGPT, Claude, Gemini ou no seu agente!
```

### What happened behind the scenes?
1. `pactx` read `project.md`, `state.md`, `glossary.md`, and all active `decisions/DEC-*.md`.
2. It inspected Git runtime state (active branch, last 5 commits, modified files).
3. It computed a canonical revision hash (e.g. `[rev: 7a9f1b2c3d4e5f60]`).
4. It formatted a token-optimized Markdown pack and copied it directly to your clipboard.

### Useful Packing Flags
- **Compact Pack (`--short`):**
  ```bash
  npx pactx --short
  ```
  Omits the glossary and obsolete decisions for tight token windows.
- **Pipe / Standard Output (`--stdout`):**
  ```bash
  npx pactx --stdout > context.md
  ```
  Dumps raw markdown directly to stdout without touching the clipboard.

---

## Step 3: Working with Any AI Model

Open your preferred AI tool (**ChatGPT**, **Claude**, **Gemini**, **Cursor**, etc.) and paste (`Ctrl+V` / `Cmd+V`).

### AI Initialization Example

The AI receives the structured context and immediately aligns with your project:

> **AI:** "Entendido. Estou assumindo como Tech Lead do projeto **EduTrack Portal** no branch `feat/student-auth`. Estamos na tarefa `TASK-01 Autenticação de Alunos via PIN`, com a regra inviolável de validação estrita com Zod e formato RFC-7807. Vamos implementar o schema Zod e o controller `POST /auth/student-pin`."

### Developing and Making Decisions During the Session

As you program together, you test ideas, establish invariants, and discard failed approaches:
- **Decision:** Use PBKDF2 with SHA-256 for 4-digit PIN hashing.
- **Fact:** Rate limiting for PIN attempts must be restricted to 5 requests per minute per IP.
- **Discarded Hypothesis:** Do NOT use plain bcrypt for 4-digit numeric PINs due to unnecessary CPU overhead compared to PBKDF2 with fixed salt.

---

## Step 4: Ingress Flow — Closing the Loop (`/handoff` & `pactx update`)

When you finish your task, reach a milestone, or are about to switch chats, tell the AI:

> `"/handoff"` *(or "Gere o bloco pactx-update")*

The AI will output the structured handoff block:

````yaml
```pactx-update
version: "1.0"
base_revision: "7a9f1b2c3d4e5f60"

source:
  model: "Claude 3.5 Sonnet"
  session_topic: "Implementação da autenticação por PIN"

state:
  active_task: "TASK-01 Autenticação de Alunos via PIN"
  status: "COMPLETED"
  recommended_model: "Medium"
  completed_items:
    - "Schema Zod e controller POST /auth/student-pin implementados"
    - "Testes de unidade com rate limit de 5 tentativas por minuto"
  new_facts:
    - "Rate limit de login por PIN configurado para 5 tentativas por minuto"
  rejected_hypotheses:
    - "Bcrypt com alto custo de CPU é desnecessário para PINs de 4 dígitos; PBKDF2 foi adotado"
  next_action: "Iniciar TASK-02: Tela de login de alunos no frontend"

new_decisions:
  - id: "auto"
    title: "Hashing de PIN Numérico com PBKDF2"
    reason: "PINs numéricos de 4 dígitos exigem hashing rápido com salt dedicado e rate limiting rigoroso"
    decision: "Utilizar PBKDF2 com 100.000 iterações e salt criptográfico individual"

new_glossary_terms:
  - term: "StudentPIN"
    definition: "Código numérico de 4 dígitos atribuído ao aluno para login rápido em sala de aula"
```
````

### Applying the Update with `pactx update`

Copy the AI's response (or just the code block) and run:

```bash
npx pactx update
```

`pactx` displays the **Full-Text Review Plan**:

```text
📦 Bloco pactx-update detectado!

Plano de Mutação Canônica:
────────────────────────────────────────────────────────────────────────────
📝 .ai-context/state.md
   • Tarefa Ativa: "TASK-01 Autenticação de Alunos via PIN" [COMPLETED]
   • Próximo Passo: "Iniciar TASK-02: Tela de login de alunos no frontend"
   • [+] Fato: "Rate limit de login por PIN configurado para 5 tentativas por minuto"
   • [+] Hipótese Descartada: "Bcrypt com alto custo de CPU é desnecessário para PINs de 4 dígitos; PBKDF2 foi adotado"
🏛️  .ai-context/decisions/DEC-002.md [CREATE]
   • Título: "Hashing de PIN Numérico com PBKDF2"
   • Decisão: "Utilizar PBKDF2 com 100.000 iterações e salt criptográfico individual"
📖 .ai-context/glossary.md [APPEND]
   • StudentPIN: "Código numérico de 4 dígitos atribuído ao aluno para login rápido em sala de aula"
────────────────────────────────────────────────────────────────────────────

? Deseja aplicar as alterações canônicas ao repositório? (Y/n) y

✔ Estado canônico atualizado com sucesso!
📋 Ledger de auditoria gravado em .ai-context/.pactx-history.json
```

Press `Enter` or type `y`.

### What happened automatically?
1. **Atomic File Write:** `DEC-002.md` was created with frontmatter and body.
2. **Patch Semantics:** `state.md` was updated cleanly without wiping out custom user sections or unmentioned fields.
3. **Glossary Term Appended:** `StudentPIN` was deduplicated and appended to `glossary.md`.
4. **Audit Ledger Recorded:** SHA-256 hash, base revision, applied revision, and timestamp were logged to `.pactx-history.json`.

---

## Step 5: Versioning in Git

Commit `.ai-context/` alongside your code changes:

```bash
git add .ai-context/ src/ test/
git commit -m "feat(auth): implement student PIN login and record DEC-002"
git push origin feat/student-auth
```

Now, any teammate (or another AI in a new chat) who checks out your branch and runs `npx pactx` will inherit the exact, up-to-date state of the project!

---

## Advanced Scenarios

### 1. Handling Stale Context Warnings
If another developer modified `.ai-context/` while your chat was ongoing, `pactx` detects that `base_revision` no longer matches the current hash:

```text
⚠️ AVISOS:
  • Stale Context: A base_revision do payload difere da revisão canônica atual do repositório.
```
- In interactive mode: Review the plan carefully and press `Y` if there are no semantic conflicts.
- In automated/scripted mode (`-y`): Use `--force` to confirm intentional override:
  ```bash
  npx pactx update -y --force
  ```

### 2. CI/CD and Scripting Automation via `--stdin` or `--file`
You can pipe AI outputs directly into `pactx`:

```bash
cat handoff_response.md | npx pactx update --stdin -y
```
Or read from a specific file:
```bash
npx pactx update --file ./handoff.md -y
```

### 3. Dry-Run Simulation
To simulate changes without writing to disk:
```bash
npx pactx update --dry-run
```
