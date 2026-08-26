# Catálogo Completo de Funcionalidades & Arquitetura — PactX 📦

> **PactX (`@trsthales/pactx`)** é um motor universal de continuidade e memória em loop fechado para desenvolvimento de software assistido por Inteligência Artificial. Ele transforma repositórios locais em estado cognitivo determinístico e versionado, eliminando a degradação de contexto, a amnésia e a corrosão arquitetural entre sessões de IA.

🌐 **Language / Idioma:** [English](./FEATURES.md) | [Português (Brasil)](./FEATURES.pt-BR.md)

---

## Sumário

1. [Visão Geral & Filosofia de Design](#1-visão-geral--filosofia-de-design)
   - [Computação Sem Estado (IA) vs Estado Persistente (Repositório)](#computação-sem-estado-vs-estado-persistente)
   - [O Ciclo de Vida em Loop Fechado](#o-ciclo-de-vida-em-loop-fechado)
   - [Por que Arquivos Markdown Transparentes vs Bancos Vetoriais Opacos](#por-que-arquivos-markdown-transparentes-vs-bancos-vetoriais-opacos)
2. [Catálogo Completo de Comandos da CLI](#2-catálogo-completo-de-comandos-da-cli)
   - [`pactx init`](#pactx-init)
   - [`pactx` / `pactx pack`](#pactx--pactx-pack)
   - [`pactx update`](#pactx-update)
   - [`pactx status`](#pactx-status)
   - [`pactx doctor`](#pactx-doctor)
   - [`pactx diff`](#pactx-diff)
   - [`pactx rollback`](#pactx-rollback)
3. [As 6 Entidades da Memória Cognitiva do Projeto](#3-as-6-entidades-da-memória-cognitiva-do-projeto)
   - [`project.md` (Identidade & Invariantes)](#1-projectmd-identidade--invariantes)
   - [`state.md` (Execução Ativa & Semântica de Patch)](#2-statemd-execução-ativa--semântica-de-patch)
   - [`requirements.md` (Espaço Canônico do Problema)](#3-requirementsmd-espaço-canônico-do-problema)
   - [`decisions/DEC-%03d.md` (Espaço Arquitetural da Solução)](#4-decisionsdec-03dmd-espaço-arquitetural-da-solução)
   - [`glossary.md` (Contratos Invariantes de Domínio)](#5-glossarymd-contratos-invariantes-de-domínio)
   - [`.pactx/` (Ledger de Auditoria & Diários de Transação)](#6-pactx-ledger-de-auditoria--diários-de-transação)
4. [O Motor Transacional (`TransactionEngine` WAL)](#4-o-motor-transacional-transactionengine-wal)
   - [Máquina de Estados (`PREPARED` $\to$ `COMMITTED`)](#máquina-de-estados)
   - [Escrita em Temporário & Rename Atômico](#escrita-em-temporário--rename-atômico)
   - [Auto-Recovery Transparente no Boot & Proteção Anti-Loop](#auto-recovery-transparente-no-boot--proteção-anti-loop)
   - [Política de Retenção & Poda Automática](#política-de-retenção--poda-automática)
5. [Matriz de Segurança Zero-Trust & Defesa em Profundidade](#5-matriz-de-segurança-zero-trust--defesa-em-profundidade)
6. [Guia de Interoperabilidade Multi-IA](#6-guia-de-interoperabilidade-multi-ia)
   - [Fluxo de Trabalho com ChatGPT, Claude, Gemini, Cursor & Claude Code](#fluxo-de-trabalho)
   - [Especificação do Bloco `pactx-update` (v1.0 & v1.1)](#especificação-do-pactx-update)

---

## 1. Visão Geral & Filosofia de Design

### Computação Sem Estado vs Estado Persistente
Modelos de Linguagem (LLMs) são **motores de computação sem estado** (*stateless*). Toda sessão de chat começa do zero ou acumula tokens ruidosos que acabam gerando corrosão de contexto, alucinações e esquecimento de restrições. Em contraste, o seu projeto de software é **estado persistente e determinístico**.

O PactX resolve esse descompasso estabelecendo o repositório Git local como a **única fonte da verdade** para a memória do projeto.

### O Ciclo de Vida em Loop Fechado

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          SEU REPOSITÓRIO                               │
│      .ai-context/ (project, state, requirements, ADRs, glossary)       │
│      + Estado do Git em Tempo Real (branch, commits, arquivos editados)│
└──────────────────┬──────────────────────────────────▲──────────────────┘
                   │                                  │
      1. pactx pack│                                  │3. pactx update
         (Egress)  │                                  │   (Ingress)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  📋 Contexto Otimizado       │   │  📦 Bloco pactx-update          │
    │     (Copiado para Clipboard) │   │     (ADRs, Fatos, Requisitos)   │
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   ▼                                  │ 2. /handoff
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │               QUALQUER IA (ChatGPT / Claude / Gemini / Cursor)     │
    └────────────────────────────────────────────────────────────────────┘
```

1. **Egress (`pactx pack`):** Inspeciona a memória canônica, filtra decisões ativas, extrai o status do Git e compila um pacote de contexto otimizado em tokens para o clipboard.
2. **Raciocínio (`Sessão de IA`):** A IA atua com total consciência arquitetural, sem desperdício de tokens e com memória explícita de hipóteses descartadas.
3. **Ingress (`pactx update`):** A IA gera o bloco estruturado `pactx-update`. O PactX ingere, valida, exibe preview e persiste as alterações transacionalmente.

### Por que Arquivos Markdown Transparentes vs Bancos Vetoriais Opacos

| Recurso | Bancos Vetoriais / Embeddings | Arquivos Canônicos PactX (`.ai-context/`) |
|---|:---:|:---:|
| **Formato** | Binário / Banco de dados opaco | Markdown & YAML limpos e legíveis |
| **Controle de Versão** | Difícil de inspecionar no Git | Commits nativos, branches e code reviews |
| **Auditabilidade** | Similaridade estocástica de cosseno | Ledger SHA-256 e WAL 100% determinísticos |
| **Portabilidade** | Exige servidores externos e chaves API | Zero dependências, funciona 100% offline |
| **Editabilidade Humana** | Embeddings somente-leitura | Diretamente editável no VS Code, Vim ou Cursor |

---

## 2. Catálogo Completo de Comandos da CLI

### `pactx init`
Inicializa a estrutura canônica `.ai-context/` na raiz do projeto atual.

- **Quando usar:** Uma única vez por repositório ao adotar o PactX.
- **Comportamento:** Cria os arquivos `project.md`, `requirements.md`, `state.md`, `glossary.md` e a primeira decisão `decisions/DEC-001.md`. Se os arquivos já existirem, preserva o conteúdo preexistente sem sobrescrever.

```bash
npx @trsthales/pactx init
```

*Saída:*
```text
✔ .ai-context structure initialized successfully!
👉 Edit files in .ai-context/ and run 'npx @trsthales/pactx' to copy context.
```

---

### `pactx` / `pactx pack`
Compila a memória ativa do projeto em um payload Markdown estruturado e copia para a área de transferência (clipboard).

- **Quando usar:** No início de cada sessão de código ou ao trocar de janela/modelo de IA.
- **Flags:**
  - `-s, --short`: Compacta o prompt mantendo apenas diretrizes essenciais e tarefas ativas (~40% economia de tokens).
  - `--stdout`: Emite o pacote de contexto no stdout do terminal sem alterar o clipboard do sistema operacional.

```bash
npx @trsthales/pactx
```

*Saída:*
```text
✔ Context packed successfully!
📋 Copied to clipboard!
Size: 1.48 KB | ~390 tokens

👉 Paste directly into ChatGPT, Claude, Gemini, or your coding agent!
```

---

### `pactx update`
Ingere a resposta estruturada `pactx-update` da IA, valida regras de integridade e segurança, apresenta pré-visualização completa e executa a transação atômica.

- **Quando usar:** Ao receber um bloco `/handoff` gerado pela IA.
- **Flags:**
  - `-y, --yes`: Aplica mutações sem confirmação interativa (mantendo todas as validações de segurança ativas).
  - `--force`: Força a aplicação ignorando avisos de concorrência (ex: Stale Context).
  - `--dry-run`: Simula a mutação completa sem escrever nenhum byte no disco.
  - `--file <path>`: Lê o payload de atualização de um arquivo local em vez do clipboard.
  - `--stdin`: Lê o payload via entrada padrão (pipe UNIX).

```bash
npx @trsthales/pactx update
```

*Preview Interativo:*
```text
📦 pactx-update block detected!

================================================================================
📝 ATUALIZAÇÃO DE ESTADO (.ai-context/state.md)
   • Tarefa Ativa: "Implementar Lock Distribuído" [IN_PROGRESS]
   • Modelo Recomendado: High
   • Itens Concluídos:
     + [x] Implementada criação atômica com flag wx
   • Fatos & Descobertas:
     + Flag POSIX O_EXCL garante exclusividade atômica
   • Hipóteses Descartadas:
     + Mutex em memória não persiste entre invocações da CLI
   • Próxima Ação: "Adicionar verificação de vivacidade de PID"

🏛️ NOVAS DECISÕES ARQUITETURAIS
   [DEC-002] "Lockfile com Consciência de Processo"
   • Satisfaz: REQ-001
   • Motivo: Eliminar locks abandonados após SIGKILL
   • Decisão: Persistir PID e token em .pactx.lock e validar com process.kill(pid, 0)
================================================================================

? Apply this mutation plan to .ai-context/? (Y/n)
```

---

### `pactx status`
Exibe um dashboard consolidado de métricas e saúde da memória cognitiva do projeto.

- **Quando usar:** Para inspecionar o progresso do sprint ativo, requisitos satisfeitos, contagem de ADRs e status do lock.
- **Flags:**
  - `-j, --json`: Emite o objeto completo de métricas como JSON estruturado para pipelines de CI/CD.

```bash
npx @trsthales/pactx status
```

*Exibição do Dashboard:*
```text
┌────────────────────────────────────────────────────────────────────────┐
│ 📦 PACTX PROJECT STATUS: ctxpack (v0.3.0)                             │
├────────────────────────────────────────────────────────────────────────┤
│ 🎯 Tarefa Ativa: "Implementar Lock Distribuído" [IN_PROGRESS]          │
│ 🤖 Modelo: High | Revisão: 9c08a9f3eb2f1c84                           │
│ 📋 Requisitos: 3 no total (2 ativos, 1 rascunho) | 66.7% satisfeitos   │
│ 🏛️ Decisões: 2 no total (2 ativas, 0 obsoletas)                        │
│ 📖 Glossário: 4 termos definidos                                      │
│ 🌿 Git: [feat/v0.3-foundation] • 0 arquivos modificados                │
│ 🔒 Trava: Limpa (Desbloqueado)                                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

### `pactx doctor`
Executa diagnósticos automatizados das 8 regras de integridade e consistência do repositório.

- **Quando usar:** Em pipelines de CI/CD, hooks de pre-commit ou após edições manuais em `.ai-context/`.
- **Flags:**
  - `--fix`: Corrige automaticamente discrepâncias corrigíveis, remove locks órfãos e poda transações antigas.

```bash
npx @trsthales/pactx doctor --fix
```

*Tabela de Diagnóstico:*
```text
┌───┬────────────────────────────┬────────┬───────────────────────────────────────────┐
│ # │ Regra de Integridade       │ Status │ Mensagem                                  │
├───┼────────────────────────────┼────────┼───────────────────────────────────────────┤
│ 1 │ Schema do Frontmatter      │  PASS  │ Todos os frontmatters YAML são válidos    │
│ 2 │ Security Jail (Sandbox)    │  PASS  │ Nenhum path traversal ou symlink detectado│
│ 3 │ Linhagem de ADRs           │  PASS  │ Grafo de sucessão de ADRs é acíclico      │
│ 4 │ Mapeamento de Requisitos   │  PASS  │ Todas as referências satisfies existem    │
│ 5 │ Paridade Bidirecional      │  PASS  │ Paridade total entre ADRs e Requisitos    │
│ 6 │ Integridade do Ledger      │  PASS  │ Ledger de auditoria íntegro e parseável   │
│ 7 │ Integridade Transacional   │  PASS  │ Todos os manifestos WAL verificados       │
│ 8 │ Saúde do Lockfile          │  PASS  │ Lockfile limpo e responsivo               │
└───┴────────────────────────────┴────────┴───────────────────────────────────────────┘
✔ Todas as 8 regras de integridade foram aprovadas com sucesso!
```

---

### `pactx diff`
Exibe uma pré-visualização colorida e estruturada do bloco `pactx-update` sem adquirir travas e sem tocar no disco.

- **Quando usar:** Para inspecionar exatamente o que uma atualização propõe antes de aplicá-la.
- **Flags:**
  - `--file <path>`: Lê payload do arquivo.
  - `--stdin`: Lê payload do pipe.

```bash
cat update.md | npx @trsthales/pactx diff --stdin
```

---

### `pactx rollback`
Executa reversões transacionais determinísticas e com segurança de grafo (*Graph-Safe*) usando snapshots do WAL.

- **Quando usar:** Para desfazer uma mutação indesejada ou restaurar o estado arquitetural anterior.
- **Argumentos & Flags:**
  - `[hash]`: Hash alvo da transação (ou prefixo). Se omitido, reverte a transação mais recente (LIFO).
  - `-y, --yes`: Aplica o rollback sem confirmação interativa.
  - `--dry-run`: Simula a reversão sem alterar nenhum arquivo no disco.
  - `--force-cascade`: Reverte automaticamente todas as transações dependentes posteriores.

```bash
npx @trsthales/pactx rollback
```

---

## 3. As 6 Entidades da Memória Cognitiva do Projeto

```text
.ai-context/
├── project.md            # 1. Identidade & Invariantes
├── state.md              # 2. Execução Ativa & Semântica de Patch
├── requirements.md       # 3. Espaço Canônico do Problema
├── decisions/            # 4. Espaço Arquitetural da Solução
│   ├── DEC-001.md
│   └── DEC-002.md
├── glossary.md           # 5. Termos de Domínio & Contratos Invariantes
└── .pactx/               # 6. Ledger de Auditoria & Diários de Transação
    ├── ledger.json
    ├── .pactx.lock
    └── transactions/
```

### 1. `project.md` (Identidade & Invariantes)
Define a visão fundamental do projeto, stack tecnológica, limites arquiteturais e regras invioláveis.
- **Ciclo de vida:** Estático, modificado apenas em mudanças estruturais de grande porte.

### 2. `state.md` (Execução Ativa & Semântica de Patch)
Registra a tarefa ativa, status (`IN_PROGRESS`, `BLOCKED`, `COMPLETED`), modelo recomendado, itens concluídos, fatos descobertos, hipóteses descartadas e o próximo passo imediato.
- **Semântica de Patch:** Se uma atualização omitir `active_task` ou `next_action`, os valores preexistentes são preservados intactos.

### 3. `requirements.md` (Espaço Canônico do Problema)
Armazena requisitos funcionais, de segurança, performance e compliance.
- **Frontmatter:** YAML estruturado com `id`, `type`, `status` e `satisfied_by: ["DEC-002"]`.
- **Corpo Markdown:** Especificações detalhadas e critérios de aceite sob `### [REQ-xxx] Título`.

### 4. `decisions/DEC-%03d.md` (Espaço Arquitetural da Solução)
Registra decisões arquiteturais como micro-ADRs imutáveis.
- **Recursos:** Numeração sequencial automática (`DEC-001`, `DEC-002`), linhagem estrutural (`superseded_by`) e mapeamento explícito de requisitos (`satisfies: ["REQ-001"]`).

### 5. `glossary.md` (Contratos Invariantes de Domínio)
Léxico canônico de termos de negócio, nomes de tabelas de banco de dados, colunas e contratos de API.

### 6. `.pactx/` (Ledger de Auditoria & Diários de Transação)
Banco de dados interno contendo:
- `ledger.json`: Histórico SHA-256 de todas as mutações aplicadas com carimbo de data/hora e revisão.
- `.pactx.lock`: Arquivo de trava exclusiva com PID do processo, token UUID de posse e heartbeat.
- `transactions/TX-<hash>.json`: Manifestos de Write-Ahead Logging com snapshots completos pré-mutação.

---

## 4. O Motor Transacional (`TransactionEngine` WAL)

O PactX garante **propriedades ACID** para mutações em arquivos locais no repositório.

### Máquina de Estados

```text
       ┌──────────┐
       │ PREPARED │ (Snapshot gravado em TX-<hash>.json com SHA-256)
       └────┬─────┘
            │
            ▼
       ┌──────────┐
       │ APPLYING │ (Arquivos alterados via temp-rename atômico)
       └────┬─────┘
            ├─────────────────────────┐
            ▼ (Sucesso)               ▼ (Interrupção / Exceção)
     ┌───────────┐             ┌─────────────┐
     │ COMMITTED │             │ ROLLED_BACK │ (Snapshot restaurado)
     └───────────┘             └──────┬──────┘
                                      │ (Se falhar >= 3x)
                                      ▼
                                 ┌────────┐
                                 │ FAILED │ (Interrompido para revisão manual)
                                 └────────┘
```

### Escrita em Temporário & Rename Atômico
As escritas usam `safeAtomicWriteFileSync`:
1. O conteúdo é gravado em arquivo temporário oculto no mesmo diretório (`.${arquivo}.${pid}.${timestamp}.${rand}.tmp`).
2. A substituição ocorre de forma atômica no nível do SO/filesystem via `fs.renameSync()`.
3. Em caso de erro, o arquivo temporário é imediatamente removido.

### Auto-Recovery Transparente no Boot & Proteção Anti-Loop
Sempre que qualquer comando da CLI executa, a rotina `bootstrapPactx` inspeciona `.pactx/transactions/`:
- Se encontrar transações em `PREPARED` ou `APPLYING`, valida a integridade do snapshot via SHA-256 e restaura os arquivos originais.
- A transação abortada é expurgada de `ledger.json`.
- Se um manifesto falhar na recuperação por 3 vezes consecutivas, é marcado como `FAILED` para impedir loops infinitos.

### Política de Retenção & Poda Automática
Manifestos finalizados (`COMMITTED` ou `ROLLED_BACK`) com mais de 30 dias ou além dos 50 mais recentes são automaticamente podados durante execuções de rotina e no `doctor --fix`.

---

## 5. Matriz de Segurança Zero-Trust & Defesa em Profundidade

| Camada Defensiva | Modelo de Ameaça / Vulnerabilidade | Mecanismo de Mitigação no PactX |
|---|---|---|
| **Filesystem Jail** | Path traversal (`../../../etc/passwd`) | Limites canônicos impostos com `fs.realpathSync.native` travados na raiz do repositório Git. |
| **Proteção Anti-Symlink** | Sobrescrita arbitrária de arquivos via links simbólicos | `safeAtomicWriteFileSync` valida `fs.lstatSync().isSymbolicLink() === false` antes de gravar. |
| **Proteção Anti-Hardlink** | Corrupção cruzada de arquivos via links físicos | Detecta `stat.nlink > 1` e desvincula o link antes de gerar um novo inode isolado. |
| **Anti-Prompt Injection Evasion** | Caracteres de largura zero, homóglifos cirílicos | Normaliza texto em Unicode NFKD, remove marcadores invisíveis e aplica regexes lineares anti-evasão. |
| **Anti-Trojaning em Markdown** | Injeção de cabeçalhos `#` para manipular LLMs | `sanitizeBodyField` converte cabeçalhos embutidos em citações (`>`) e neutraliza tags XML (`<system>`, `<!-- -->`). |
| **Controle Otimista de Concorrência** | Sobrescritas cegas por múltiplos chats de IA | Revalida o hash de revisão sob trava exclusiva imediatamente antes da escrita (Final OCC Check). |
| **Anti-TOCTOU sob Trava** | Conflito na alocação sequencial de IDs de ADR | Aloca IDs definitivamente sob `ContextLock` e mapeia referências dinamicamente. |
| **Imunidade a ReDoS** | Ataques de negação de serviço por regex em strings longas | Todas as expressões regulares são estritamente lineares $\mathcal{O}(N)$ sem quantificadores aninhados. |

---

## 6. Guia de Interoperabilidade Multi-IA

### Fluxo de Trabalho

O PactX opera de forma fluida com qualquer ferramenta de IA:

```text
1. Terminal:            npx @trsthales/pactx
2. Interface de IA:     Cole (Ctrl+V) -> Desenvolva, converse, resolva tarefas
3. Interface de IA:     Digite "/handoff" -> Copie o bloco gerado
4. Terminal:            npx @trsthales/pactx update
```

Compatível com:
- **Interfaces Web:** ChatGPT, Claude.ai, Gemini Web, DeepSeek.
- **IDEs & Editores de IA:** Cursor, Windsurf, GitHub Copilot.
- **Agentes de Terminal:** Claude Code, Aider, OpenCode.

---

### Especificação do `pactx-update`

A IA emite um bloco de código estruturado:

````markdown
```pactx-update
version: "1.1"
base_revision: "9c08a9f3eb2f1c84"
source:
  type: "conversation"
  model: "Claude 3.7 Sonnet"
state:
  active_task: "Implementar Lock Distribuído"
  status: "IN_PROGRESS"
  recommended_model: "High"
  completed_items:
    - "Adicionada criação atômica de lockfile"
  new_facts:
    - "O_EXCL garante exclusividade atômica no POSIX e NTFS"
  rejected_hypotheses:
    - "Mutex em memória não protege entre invocações da CLI"
  next_action: "Adicionar verificação de vivacidade de PID"
new_requirements:
  - id: "auto"
    type: "security"
    title: "Vivacidade de Processo no Lock"
    statement: "O lockfile deve ser liberado automaticamente se o processo detentor encerrar."
new_decisions:
  - id: "auto"
    title: "Lockfile Baseado em Token com Verificação de PID"
    reason: "Garantir que locks abandonados por processos mortos sejam recuperados imediatamente"
    decision: "Armazenar token UUID e PID; validar com process.kill(pid, 0)"
    satisfies: ["REQ-002"]
superseded_decisions:
  - id: "DEC-001"
    by: "auto"
    reason: "Substituída pelo lockfile com consciência de processo"
new_glossary_terms:
  - term: "LockToken"
    definition: "UUID v4 atribuído à instância do ContextLock para evitar roubo de trava."
```
````

---

<p align="center">
  <b>PactX 📦 — Motor Universal de Continuidade de Contexto</b><br>
  Desenvolvido com rigor arquitetural zero-trust para engenharia de software de missão crítica.
</p>
