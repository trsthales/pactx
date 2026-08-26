# Tutorial do pactx: Guia Prático Passo a Passo 🚀

🌐 **Idioma / Language:** [Português (Brasil)](./TUTORIAL.pt-BR.md) | [English](./TUTORIAL.md)

Este tutorial demonstra como utilizar o `pactx` no seu fluxo de desenvolvimento diário com qualquer inteligência artificial (ChatGPT, Claude, Gemini, Cursor, Copilot, etc.) para alcançar continuidade de contexto em loop fechado e eliminar a amnésia de IA.

---

## Pré-requisitos

- **Node.js**: v18.0.0 ou superior (`node -v`)
- **Git**: Instalado e inicializado no repositório do seu projeto
- **Nenhuma instalação global necessária**: Execute diretamente via `npx @trsthales/pactx`

---

## Passo 1: Inicializando o Repositório (`pactx init`)

Na pasta raiz do seu projeto, execute:

```bash
npx @trsthales/pactx init
```

Saída:
```text
✔ .ai-context structure initialized successfully!
👉 Edit files in .ai-context/ and run 'npx @trsthales/pactx' to copy context.
```

Isso cria a pasta canônica `.ai-context/` no seu projeto:

```text
.ai-context/
├── project.md      # Identidade estática, stack tecnológica e regras invioláveis
├── state.md        # Sprint atual, tarefa ativa, fatos e hipóteses descartadas
├── glossary.md     # Contratos invariantes, tabelas e termos de domínio
└── decisions/      # Micro-ADRs versionadas (DEC-001.md, DEC-002.md)
```

### Configurando o Estado Inicial

Abra `.ai-context/project.md` e configure a stack e as regras da sua equipe:

```markdown
---
spec_version: "1.0"
project: "Portal EduTrack"
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

Edite `.ai-context/state.md` com o objetivo atual:

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

## Passo 2: O Fluxo de Egresso — Empacotando o Contexto (`pactx pack` / `pactx`)

Sempre que for iniciar um novo chat com IA ou alinhar uma sessão existente, execute:

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

### O que aconteceu nos bastidores?
1. O `pactx` leu `project.md`, `state.md`, `glossary.md` e todas as decisões ativas em `decisions/DEC-*.md`.
2. Inspecionou o estado de runtime do Git (branch atual, últimos 5 commits, arquivos modificados no diff local).
3. Calculou um hash criptográfico canônico da revisão (ex: `[rev: 7a9f1b2c3d4e5f60]`).
4. Formatou um Markdown otimizado em tokens e copiou diretamente para a área de transferência.

### Flags Úteis de Empacotamento
- **Modo Compacto (`--short`):**
  ```bash
  npx @trsthales/pactx --short
  ```
  Omite o glossário e decisões obsoletas para caber em janelas de tokens restritas.
- **Redirecionamento / Pipe (`--stdout`):**
  ```bash
  npx @trsthales/pactx --stdout > contexto.md
  ```
  Imprime o Markdown diretamente no terminal sem alterar a área de transferência.

---

## Passo 3: Trabalhando com Qualquer Modelo de IA

Abra sua ferramenta de IA de preferência (**ChatGPT**, **Claude**, **Gemini**, **Cursor**, etc.) e cole o conteúdo (`Ctrl+V` / `Cmd+V`).

### Exemplo de Inicialização da IA

A IA recebe o contexto estruturado e assume a liderança técnica alinhada com as restrições:

> **IA:** "Entendido. Estou assumindo como Tech Lead do projeto **Portal EduTrack** na branch `feat/student-auth`. Estamos na tarefa `TASK-01 Autenticação de Alunos via PIN`, respeitando a regra inviolável de validação estrita com Zod e formato RFC-7807. Vamos implementar o schema Zod e o controller `POST /auth/student-pin`."

### Desenvolvimento e Tomada de Decisão na Sessão

Durante a programação em par, você e a IA exploram caminhos e chegam a conclusões:
- **Decisão:** Usar PBKDF2 com SHA-256 para o hash de PIN de 4 dígitos.
- **Fato Comprovado:** O rate limit de tentativas de PIN deve ser limitado a 5 requisições por minuto por IP.
- **Hipótese Descartada:** NÃO utilizar bcrypt padrão para PIN numérico curto devido a overhead desnecessário de CPU em comparação com PBKDF2 com salt fixo.

---

## Passo 4: O Fluxo de Ingresso — Fechando o Loop (`/handoff` e `pactx update`)

Ao finalizar a tarefa ou antes de trocar de chat, peça à IA:

> `"/handoff"` *(ou "Gere o bloco pactx-update")*

A IA emitirá o bloco estruturado de handoff:

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

### Aplicando a Atualização com `pactx update`

Copie a resposta da IA e execute no seu terminal:

```bash
npx @trsthales/pactx update
```

O `pactx` exibirá o **Plano de Mutação em Texto Integral**:

```text
📦 pactx-update block detected!

Canonical Mutation Plan:
────────────────────────────────────────────────────────────────────────────
📝 .ai-context/state.md
   • Active Task: "TASK-01 Autenticação de Alunos via PIN" [COMPLETED]
   • Next Action: "Iniciar TASK-02: Tela de login de alunos no frontend"
   • [+] Fact: "Rate limit de login por PIN configurado para 5 tentativas por minuto"
   • [+] Discarded Hypothesis: "Bcrypt com alto custo de CPU é desnecessário para PINs de 4 dígitos; PBKDF2 foi adotado"
🏛️  .ai-context/decisions/DEC-002.md [CREATE]
   • Title: "Hashing de PIN Numérico com PBKDF2"
   • Decision: "Utilizar PBKDF2 com 100.000 iterações e salt criptográfico individual"
📖 .ai-context/glossary.md [APPEND]
   • StudentPIN: "Código numérico de 4 dígitos atribuído ao aluno para login rápido em sala de aula"
────────────────────────────────────────────────────────────────────────────

? Apply canonical changes to repository? (Y/n) y

✔ Canonical state updated successfully!
📋 Audit ledger recorded in .ai-context/.pactx-history.json
```

Pressione `Enter` ou digite `y`.

### O que o pactx fez automaticamente?
1. **Write-Ahead Logging (WAL) & Escrita Atômica:** As mudanças foram orquestradas via manifestos WAL (`TX-<hash>.json`) e gravadas atomicamente.
2. **Semântica de Patch:** Atualizou `state.md` e `requirements.md` preservando seções customizadas do usuário e requisitos existentes não mencionados.
3. **Append no Glossário:** Inseriu o novo termo `StudentPIN` sem duplicar termos já existentes.
4. **Ledger de Auditoria:** Gravou o hash SHA-256, base_revision, timestamp e metadados em `.ai-context/.pactx/ledger.json`.

---

## Passo 5: Ferramentas e Operações Essenciais (`status`, `diff`, `doctor`, `rollback`)

### 1. Inspecionando a Memória Cognitiva (`pactx status`)
Visualize o status consolidado do projeto, métricas de requisitos, ADRs e saúde do git:

```bash
npx @trsthales/pactx status
```

Ou exporte os dados estruturados em JSON para automações/scripts:
```bash
npx @trsthales/pactx status --json
```

### 2. Pré-visualizando Mutações sem Gravar no Disco (`pactx diff`)
Inspecione o plano de mutação colorido a partir do clipboard, arquivo ou pipe com zero efeitos colaterais no disco:

```bash
npx @trsthales/pactx diff
# Ou a partir de um arquivo:
npx @trsthales/pactx diff --file ./candidato_update.md
```

### 3. Validando a Integridade do Repositório & Auto-Repair (`pactx doctor`)
Execute a suíte de 8 regras de consistência e segurança:

```bash
npx @trsthales/pactx doctor
```

Caso sejam detectados locks abandonados ou transações expiradas, repare automaticamente com:
```bash
npx @trsthales/pactx doctor --fix
```

### 4. Reversão Graph-Safe & WAL-Protected (`pactx rollback`)
Reverta a mutação mais recente com segurança (LIFO):

```bash
npx @trsthales/pactx rollback
```

Ou reverta uma transação histórica específica:
```bash
npx @trsthales/pactx rollback <hash> --force-cascade
```

---

## Passo 6: Versionamento no Git

Faça o commit de `.ai-context/` junto com suas alterações de código:

```bash
git add .ai-context/ src/ test/
git commit -m "feat(auth): implementar login de aluno via PIN e registrar DEC-002"
git push origin feat/student-auth
```

Dessa forma, qualquer colega de equipe (ou outra IA em um novo chat) que fizer checkout da sua branch e rodar `npx @trsthales/pactx` herdará instantaneamente o estado exato e atualizado do projeto!

---

## Cenários Avançados

### 1. Lidando com Avisos de *Stale Context*
Se outro desenvolvedor fez alterações no `.ai-context/` enquanto seu chat estava aberto, o `pactx` detecta a divergência:

```text
⚠️ WARNINGS:
  • Stale Context: The update was based on revision "7a9f1b2c3d4e5f60", but the current repository is at revision "8b0e2c3d4e5f6a12".
```
- No modo interativo: Revise o plano e confirme com `Y` caso não haja conflito semântico.
- No modo automatizado/scripts (`-y`): Use `--force` para confirmar a aplicação intencional:
  ```bash
  npx @trsthales/pactx update -y --force
  ```

### 2. Automação em Scripts ou CI via `--stdin` e `--file`
Você pode enviar blocos de handoff diretamente via pipe:

```bash
cat resposta_handoff.md | npx @trsthales/pactx update --stdin -y
```
Ou ler de um arquivo específico:
```bash
npx @trsthales/pactx update --file ./handoff.md -y
```

### 3. Simulação sem Gravação (`--dry-run`)
Para validar o plano de mutação sem alterar nenhum arquivo:
```bash
npx @trsthales/pactx update --dry-run
```
