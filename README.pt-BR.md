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
      1. npx @trsthales/pactx │        3. npx @trsthales/pactx update
         (Egresso) │                        (Ingresso)│ (Human-in-the-Loop)
                   ▼                                  │
    ┌──────────────────────────────┐   ┌──────────────┴──────────────────┐
    │  📋 Contexto Otimizado       │   │  📦 Bloco pactx-update          │
    │     (Copiado p/ Clipboard)   │   │     (ADRs, Fatos, Hipóteses)    │
    └──────────────┬───────────────┘   └──────────────▲──────────────────┘
                   │                                  │
                   ▼                                  │ 2. /handoff ou extract
    ┌─────────────────────────────────────────────────┴──────────────────┐
    │       QUALQUER IA (ChatGPT / Claude / Gemini / Cursor / MCP)       │
    └────────────────────────────────────────────────────────────────────┘
```

1. **Egresso (`pactx` / `pack`):** Inspeciona especificações do projeto, ADRs ativas e o delta do Git para gerar um pacote Markdown limpo e com consumo mínimo de tokens.
2. **Micro-Âncoras & Telemetria em Tempo Real:** Captura passiva de âncoras (`<!-- pactx:v1 ... -->`) e diretivas do desenvolvedor (`/remember`) durante a conversa.
3. **Ingresso (`pactx update` ou `pactx extract`):** Ingere blocos estruturados de handoff ou extrai diretamente de transcripts de chat, com validação Zero-Trust e transações atômicas WAL.
4. **Servidor MCP Nativo (`pactx serve --mcp`):** Servidor Model Context Protocol nativo para agentes em IDEs (Cursor, Claude Desktop, Windsurf).

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

---

## 🤖 Integração com Model Context Protocol (MCP) (v0.4.0)

O `pactx` fornece um **Servidor MCP nativo** sobre `stdio` para memória em tempo real em IDEs como **Cursor**, **Claude Desktop** e **Windsurf**.

### Configuração no Cursor (`.cursor/mcp.json` ou Configurações Globais)

Adicione ao arquivo `.cursor/mcp.json` na raiz do seu projeto ou em `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pactx": {
      "command": "npx",
      "args": ["-y", "@trsthales/pactx@latest", "serve", "--mcp"]
    }
  }
}
```

### Configuração no Claude Desktop (`claude_desktop_config.json`)

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pactx": {
      "command": "npx",
      "args": ["-y", "@trsthales/pactx@latest", "serve", "--mcp"]
    }
  }
}
```

### Resources & Tools MCP Disponíveis

| Tipo | Identificador | Descrição |
|---|---|---|
| **Resource** | `pactx://context` | Context Pack canônico atualizado em Markdown |
| **Resource** | `pactx://health` | Relatório de saturação de contexto e risco de amnésia em JSON |
| **Resource** | `pactx://status` | Métricas cognitivas completas do repositório em JSON |
| **Tool** | `pactx_record_anchor` | Grava micro-âncoras de decisão/fato/rejeição em tempo real |
| **Tool** | `pactx_get_context_health` | Retorna saúde da janela de contexto e recomendações de handoff |
| **Tool** | `pactx_propose_mutation` | Propõe um plano de mutação e gera um `proposalId` para revisão humana |
| **Tool** | `pactx_apply_mutation` | Aplica atomicamente uma proposta aprovada ao estado do repositório |

---

## 🔍 Extrator de Transcripts Out-of-Band (`pactx extract`)

Resumos de `/handoff` no final de conversas longas são vulneráveis à fadiga da atenção da IA. O `pactx extract` extrai o estado diretamente do arquivo de transcript bruto:

```bash
# Extração determinística offline (zero custo de tokens / sem API key)
npx @trsthales/pactx extract chat_export.json -y

# Extração semântica com Evidence Spans usando Gemini, Claude, OpenAI ou Ollama local
npx @trsthales/pactx extract transcript.jsonl --model gemini-2.5-flash --api-key $GEMINI_API_KEY
npx @trsthales/pactx extract cursor_log.json --model claude-3-5-haiku
npx @trsthales/pactx extract session.txt --model qwen2.5-coder # Ollama local

# Inspeciona sem modificar arquivos no disco
npx @trsthales/pactx extract chat.json --dry-run
```

---

## 📊 Telemetria de Saúde de Contexto (`pactx status --telemetry`)

Monitore o consumo da janela de contexto e as zonas de risco operacional antes que a amnésia aconteça:

```bash
npx @trsthales/pactx status --telemetry
```

```text
╔══════════════════════════════════════════════════════════════════════╗
║              pactx Context Health Dashboard v0.4.0                  ║
╠══════════════════════════════════════════════════════════════════════╣
║ Session: session_2026-08-27_a3f2d1   Model: claude-3-5-sonnet       ║
║ Turns: 24                            Anchors Logged: 5 captured      ║
╠══════════════════════════════════════════════════════════════════════╣
║ CONTEXT CONSUMPTION                                                  ║
║   Total Estimated:        28,252 tokens   [ 14%]                    ║
║   Safe Zone (70%):       140,000 tokens                             ║
║                                                                     ║
║   [████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 14%          ║
║    ← SAFE                    CAUTION  WARNING   CRIT →              ║
╠══════════════════════════════════════════════════════════════════════╣
║ CONTEXT HEALTH: 86/100 🟢 SAFE                                       ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Referência da CLI

### Comandos Principais
| Comando / Flag | Descrição |
|---|---|
| `pactx` / `pactx pack` | Lê o estado do repositório, copia context pack para o clipboard e inicia sessão efêmera |
| `pactx init` | Cria a estrutura inicial do `.ai-context/` com templates |
| `pactx status` | Exibe o dashboard cognitivo executivo e o estado em runtime do Git |
| `pactx status --telemetry` | Exibe saúde do contexto, barra de saturação e métricas de micro-âncoras |
| `pactx status --json` | Emite métricas estruturadas completas em JSON |
| `pactx diff` | Inspeciona e exibe o plano de mutação colorido sem modificar o disco |
| `pactx rollback [hash]` | Rollback seguro por grafo protegido por WAL (LIFO ou hash específico) |
| `pactx doctor` | Valida a saúde do repositório contra 8 regras de integridade (`--fix` para auto-reparo) |
| `pactx serve --mcp` | Inicia o servidor MCP nativo sobre stdio para Cursor e Claude Desktop |

### Comandos de Ingresso e Extração
| Comando / Flag | Descrição |
|---|---|
| `pactx update` | Lê o clipboard, valida payload, exibe plano em texto integral e solicita confirmação |
| `pactx update --proposal <id>` | Inspeciona e aplica proposta desacoplada gerada pelo servidor MCP |
| `pactx update -y`, `--yes` | Aplica mudanças sem confirmação interativa (mantém todas as validações de segurança) |
| `pactx update --dry-run` | Simula e exibe o plano completo de mutação sem modificar arquivos no disco |
| `pactx extract [file]` | Extrai decisões, fatos e hipóteses descartadas de transcripts de chat |
| `pactx extract --stdin` | Extrai de dados enviados via pipe (`cat chat.json \| pactx extract --stdin`) |
| `pactx extract --model <name>` | Extração semântica com LLM (Gemini, Claude, OpenAI, Ollama) com Evidence Spans |

---

## Segurança Enterprise & Arquitetura Zero-Trust

O `pactx update` trata saídas de IA como **entradas não confiáveis (untrusted candidate input)**:

1. **Write-Ahead Logging (WAL):** Gravações em múltiplos arquivos são orquestradas via manifestos WAL atômicos (`PREPARED` -> `APPLYING` -> `COMMITTED` / `ROLLED_BACK`). Falhas disparam auto-recuperação transparente no boot.
2. **Isolamento de Caminho (Path Traversal Jail):** Identificadores de ADR e Requisitos são rigorosamente validados contra `/^(auto\|DEC-\d{3,4}\|REQ-\d{3,4})$/i`.
3. **Serialização Segura de AST:** Zero interpolação ingênua de strings em YAML. Todo frontmatter é gerado via dumpers formais.
4. **Rollback Seguro por Grafo de Dependências:** Análise de links downstream (`satisfies`, `superseded_by`) para prevenir estados inconsistentes.
5. **Idempotência Canônica:** Payloads são hasheados com SHA-256 no ledger `.ai-context/.pactx/ledger.json`. Reaplicar o mesmo conteúdo resulta em No-Op seguro.
6. **Revisão Humana Anti-Envenenamento:** O terminal renderiza o texto integral de cada decisão, requisito, fato e hipótese antes da confirmação humana.

---

## Especificação de Diretórios (`.ai-context/`)

```text
.ai-context/
├── project.md            # Visão, stack tecnológico e regras invariantes
├── requirements.md       # Requisitos canônicos & regras de negócio (REQ-001)
├── state.md              # Tarefa ativa, itens concluídos, fatos e hipóteses descartadas
├── glossary.md           # Termos de domínio, contratos de API e entidades
├── decisions/
│   ├── DEC-001.md        # ADRs ativas ou substituídas com histórico estruturado
│   └── DEC-002.md
└── .pactx/
    ├── ledger.json       # Ledger de auditoria com hashes SHA-256 aplicados
    ├── .pactx.lock       # Lockfile atômico de concorrência
    ├── transactions/     # Manifestos de Write-Ahead Log (WAL) (TX-<hash>.json)
    └── sessions/         # Telemetria efêmera, micro-âncoras e propostas (gitignored)
```

---

## Documentação

- ⚡ **[Catálogo Completo de Recursos](./docs/FEATURES.pt-BR.md)** — Guia exaustivo de comandos, engine WAL e modelos de segurança.
- 📖 **[Tutorial Passo a Passo](./docs/TUTORIAL.pt-BR.md)** — Guia prático de como integrar e usar o `pactx` no dia a dia.
- 🏛️ **[Especificação Técnica & Arquitetura](./docs/ARCHITECTURE.pt-BR.md)** — Mergulho profundo no motor de loop fechado e garantias transacionais.

---

## Licença

Distribuído sob a licença **MIT**. Consulte [`LICENSE`](./LICENSE) para obter mais informações.
