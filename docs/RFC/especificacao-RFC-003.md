# RFC-003: Session Intelligence, Context Telemetry, In-Flight Micro-Anchors & Out-of-Band Extraction

* **RFC Number:** 003
* **Version:** 1.2 (Deterministic Telemetry, Structured Anchors & Decoupled MCP Approval)
* **Status:** FINAL / APPROVED
* **Target Release:** `pactx v0.4.0`
* **Predecessors:** RFC-001 (Closed-Loop Mutation Protocol), RFC-002 (WAL Transaction Engine & Requirements)
* **Author:** pactx core team
* **Date:** 2026-08-27

---

## 1. Contexto e Motivação

Nas versões `v0.1.x` a `v0.3.x`, o `pactx` estabeleceu um motor robusto de persistência transacional com **Write-Ahead Logging (WAL)**, modelo canônico de requisitos e suíte completa de governança CLI (`status`, `doctor`, `diff`, `rollback`).

Contudo, a experiência prática em sessões longas de desenvolvimento expôs dois modos de falha cognitivos inerentes aos Grandes Modelos de Linguagem (LLMs):

1. **A Armadilha da Amnésia de Fim de Sessão (*The Late-Session Amnesia Trap*):** Em conversas com múltiplos turnos (30+ mensagens), a distribuição de atenção dos transformers sofre degradação (*Lost in the Middle*). Solicitar `/handoff` no final de uma sessão saturada força a IA a resumir a si mesma a partir de uma memória volátil degradada, causando a **omissão de Conhecimento Negativo** (hipóteses descartadas nas primeiras mensagens) e sínteses imprecisas de decisões arquiteturais.
2. **Cegueira de Janela de Contexto (*Context Blindness*):** O desenvolvedor opera sem telemetria do consumo real da janela de contexto, percebendo a saturação apenas após a degradação lógica e a geração de respostas alucinadas.

> **Tese Central da RFC-003:** "A sessão de chat não deve ser a fonte da verdade do handoff; a sessão é apenas uma fonte de evidências transitórias."

---

## 2. Telemetria Local e Monitoramento de Context Health

A telemetria do PactX opera localmente de forma determinística e offline, fornecendo métricas claras com níveis de confiança explícitos (`EXACT | ESTIMATED | UNKNOWN`).

### 2.1 Estimativa Ponderada de Tokens
A contagem local de tokens diferencia o código-fonte (maior densidade sintática) da prosa tradicional:

$$\text{Tokens} = \left(\left\lceil \frac{\text{chars do código}}{3} \right\rceil + \left\lceil \frac{\text{chars de prosa}}{4} \right\rceil\right) \times 1.15$$

* **Heurística Determinística:** Caracteres dentro de cercas ` ``` ` ou inline ` ` ` são classificados como código (`/3`); todos os demais caracteres fora de blocos de código são classificados como prosa (`/4`).
* **Margem de Segurança:** Adiciona 15% de margem conservadora para acomodar variações entre tokenizadores (GPT-4o, Claude, Gemini).

### 2.2 Zonas de Risco e Limiares Operacionais

$$\text{Usable Context} = \text{Context Window} - \text{Reserved Output}$$
$$\text{Saturation} = \frac{\text{Tokens Consumidos}}{\text{Usable Context}}$$

| Saturação | Nível | Classificação | Ação Operacional |
|---|---|:---:|---|
| **< 50%** | `SAFE` | 🟢 Verde | Trabalho normal; atenção plena do modelo. |
| **50% – 70%** | `WATCH` | 🟢 Verde | Sessão produtiva; emitir micro-âncoras. |
| **70% – 85%** | `CAUTION` | 🟡 Amarelo | Início de perda de atenção; planejar handoff. |
| **85% – 95%** | `WARNING` | 🟠 Laranja | **Handoff recomendado imediatamente**. |
| **> 95%** | `CRITICAL` | 🔴 Vermelho | Risco iminente de alucinação e quebra de contratos. |

### 2.3 Inicialização da Sessão de Telemetria
1. O comando `pactx pack` inicia/reseta o arquivo `.ai-context/.pactx/sessions/current.json` gravando:
   - `sessionStartedAt`: timestamp ISO 8601 do momento da geração do pack.
   - `packTokenEstimate`: tokens iniciais do context pack.
   - `baseRevision`: hash de 16 caracteres da revisão canônica fornecida.
2. O comando `pactx status --telemetry` calcula a idade da sessão e a evolução de turnos a partir de `current.json`. Se o arquivo não existir, exibe status `IDLE` (zero falsos alarmes).

### 2.4 Visualização no Terminal (`pactx status --telemetry`)

```text
$ npx @trsthales/pactx status --telemetry

📦 PactX Context Telemetry — Checkmind Escolar (v0.3.2)
────────────────────────────────────────────────────────────────────────────
🎯 Active Task:     TASK-05 Login de Alunos via PIN [IN_PROGRESS]
🤖 Model Profile:   Claude Sonnet 3.7 (200K window | 140K safe zone)
🔑 Context Rev:     8bc6ecbadcf68ab4

📊 Session Metrics:
   • Pack Initial:   ~2,410 tokens (ESTIMATED)
   • Session Age:    45 min (Est. 15 turns | 3 git commits)
   • Tokens Used:    ~14,400 tokens [10% of window]
   • Context Health: 90/100 🟢 [SAFE]
   • Confidence:     ESTIMATED

   ──── Session Timeline ────────────────────────────────
   [████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 10%
   0%      ↑ here     70% ⚡ handoff   85% 💀 cliff   100%
   ──────────────────────────────────────────────────────

💡 Recommendation: Safe to continue working. ~130 turns remaining before handoff.
────────────────────────────────────────────────────────────────────────────
```

---

## 3. Protocolo de Micro-Âncoras em Tempo Real (*In-Flight Anchoring*)

Para capturar decisões e hipóteses no momento exato em que ocorrem, o prompt de saída (`composer.ts`) instrui as IAs a emitirem micro-âncoras estruturadas em JSON dentro de comentários HTML (invisíveis na renderização web do Markdown).

### 3.1 Gramática Canônica das Micro-Âncoras
```html
<!-- pactx:v1 dec {"title":"Usar SQLite por tenant","satisfies":["REQ-002"]} -->
<!-- pactx:v1 fact "O proxy reverso limpa o cabeçalho Authorization" -->
<!-- pactx:v1 rej "CORS não era a causa raiz do 403" -->
<!-- pactx:v1 req {"title":"Auth simplificada","type":"functional"} -->
<!-- pactx:v1 task "Implementar validação do StudentPIN no controller" -->
```

* **Vantagem de Engenharia:** O parser interno do PactX executa `JSON.parse()` direto no conteúdo do comentário, eliminando regexes frágeis de atributos HTML.
* **Custo em tokens:** ~10 a 20 tokens por decisão durante o chat.

### 3.2 Diretiva de Memória do Desenvolvedor (`/remember`)
O desenvolvedor pode forçar a captura de um fato ou decisão durante a conversa:
> `/remember decision: O banco de cada escola será um SQLite isolado`  
> `/remember reject: Não tentar alterar middlewares de CORS`  
> `/remember fact: Rate limit de login por PIN é 5 req/min`

* **Garantia de Extração:** O parser do `pactx extract` busca no transcript tanto os comentários `<!-- pactx:v1 -->` quanto as mensagens do usuário iniciadas por `/remember`, garantindo captura 100% determinística mesmo se a IA esquecer de emitir o comentário.

---

## 4. Extrator Fora da Banda (*Out-of-Band Extractor*: `pactx extract`)

Para conversas longas ou transcrições completas, o comando `pactx extract` ingere o transcript exportado e desacopla a extração em duas fases complementares:

```text
  Transcript Export (JSON / Markdown / Cursor)
                    │
                    ▼
  ┌────────────────────────────────────────────────────────┐
  │ FASE 1: Extração Determinística Local (Zero IA / $0.00)│
  │ • Varredura de micro-âncoras <!-- pactx:v1 -->         │
  │ • Captura de comandos /remember do usuário             │
  │ • Análise de Git diffs (arquivos criados/deletados)    │
  │ • Anotações // DECISION: e // REJECTED: no código      │
  └────────────────────────┬───────────────────────────────┘
                           │
                           ▼
  ┌────────────────────────────────────────────────────────┐
  │ FASE 2: Extração Semântica Suplementar (Opcional)     │
  │ • Chamada via fetch nativo para modelo limpo           │
  │   (Gemini Flash / Claude Haiku / Ollama local)         │
  │ • Contexto limpo com atenção total sobre o transcript  │
  │ • Anotação de Evidence Spans ({ turn, quote })         │
  └────────────────────────┬───────────────────────────────┘
                           │
                           ▼
  ┌────────────────────────────────────────────────────────┐
  │ Geração do Bloco pactx-update v1.1                     │
  │ • Validação Zero-Trust e persistência no Transaction WAL│
  └────────────────────────────────────────────────────────┘
```

### 4.1 CLI Contract (`pactx extract`)

```bash
# Extração determinística local (Offline / Zero API Key)
npx @trsthales/pactx extract session.json

# Extração via pipe com pré-visualização dry-run
cat chat-export.json | npx @trsthales/pactx extract --stdin --dry-run

# Extração híbrida com modelo secundário via fetch nativo
npx @trsthales/pactx extract session.json --model gemini-flash --api-key $GEMINI_API_KEY
```

### 4.2 Adaptadores de Transcript (`TranscriptAdapter`)
* **`claude`:** Export JSON do Claude.ai (`human` / `assistant` turns).
* **`chatgpt`:** Export JSON/ZIP do ChatGPT.
* **`cursor`:** Logs estruturados de sessões do Cursor (`.jsonl`).
* **`raw` / `markdown`:** Texto puro ou export genérico de Markdown.

### 4.3 Evidence Spans (Auditabilidade)
O modelo extrator referencia o número do turno e a citação de origem de cada fato ou decisão:

```yaml
new_decisions:
  - id: "auto"
    title: "Isolamento SQLite por tenant"
    evidence:
      turn: 37
      quote: "Decidimos que cada escola terá um arquivo SQLite separado"
```

---

## 5. Storage de Sessão Efêmero (`.ai-context/.pactx/sessions/`)

Para garantir privacidade e impedir o vazamento de segredos e PII no repositório, o storage de sessão é **adicionado ao `.gitignore`**:

```text
.ai-context/.pactx/
├── .pactx.lock
├── ledger.json
├── transactions/
└── sessions/                   # 🔒 Storage de Sessão Efêmero (.gitignore)
    ├── current.json            # Metadados e início da sessão ativa
    ├── anchors.jsonl           # Log append-only de micro-âncoras capturadas
    └── proposals/              # Propostas de mutação geradas via MCP
```

* **Política de Retenção de Sessões:** `anchors.jsonl` e `current.json` são resetados a cada novo `pactx pack`. Sessões arquivadas com mais de 7 dias são podadas pelo `pactx doctor --fix`.

---

## 6. Servidor MCP Nativo (`pactx serve --mcp`)

O servidor MCP opera sobre `stdio`, projetado para ser configurado persistentemente em IDEs e agentes (Cursor, Claude Desktop, Windsurf, VS Code).

### 6.1 Resources
* `pactx://context`: Retorna o Context Pack atualizado em Markdown.
* `pactx://health`: Retorna as métricas de telemetria e saturação em JSON.
* `pactx://status`: Retorna o status executivo do repositório.

### 6.2 Tools
* `pactx_record_anchor`: Registra uma micro-âncora no `anchors.jsonl` da sessão em tempo real.
* `pactx_get_context_health`: Consulta o Context Health e limiares operacionais.
* `pactx_propose_mutation`: Valida o schema, salva a proposta em `.pactx/sessions/proposals/PROP-<hash>.json` e retorna o `proposalId` com o diff visual.
* `pactx_apply_mutation`: Aplica um `proposalId` aprovado sob lock transacional WAL.

### 6.3 Desacoplamento da Aprovação Humana no MCP
1. O agente na IDE chama `pactx_propose_mutation` $\to$ recebe `proposalId` e o diff.
2. O desenvolvedor revisa o diff na IDE ou executa `pactx update --proposal <proposalId>` no terminal para aprovar com segurança.

---

## 7. Matriz de Trade-offs e Retenção

| Estratégia | Consumo de Tokens | Fricção de DX | Retenção de Conhecimento Negativo | Complexidade de Implementação |
|---|:---:|:---:|:---:|:---:|
| **Handoff Manual Final (`/handoff`)** | Fixo (~400t) | Baixa | Variável (sujeita a saturação) | Baixa |
| **Micro-Âncoras (`<!-- pactx:v1 -->`)** | Baixo (+15t/decisão) | Zero (automático) | Alta (captura no momento) | Baixa |
| **Diretiva `/remember`** | Baixo (~10t/comando) | Baixa (sob demanda) | Muito Alta (intenção explícita) | Baixa |
| **Extrator OOB (`pactx extract`)** | Zero no chat principal | Média (requer log) | Alta (contexto limpo dedicado) | Média |
| **Servidor MCP em Tempo Real** | Zero no chat | Zero (integrado na IDE) | Muito Alta (síncrona via tool) | Média |

---

## 8. CLI Commands & Flags Reference (v0.4.0)

| Comando / Flag | Comportamento |
|---|---|
| `pactx status --telemetry` | Exibe o dashboard de telemetria com barra visual de saturação e nível de confiança |
| `pactx status --telemetry --json` | Exporta as métricas de telemetria em JSON para automações |
| `pactx extract <file>` | Executa extração de transcript (fase determinística + modelo de IA opcional) |
| `pactx extract --stdin` | Recebe o transcript via pipe para extração |
| `pactx extract --dry-run` | Apenas simula e exibe o bloco `pactx-update` extraído |
| `pactx update --proposal <id>` | Revisa e aplica uma proposta gerada via MCP |
| `pactx serve --mcp` | Inicia o servidor Model Context Protocol sobre `stdio` |

---

## 9. Definition of Done & Quality Gates (v0.4.0)

- [ ] Módulo `src/telemetry/tokenEstimator.ts` com cálculo determinístico de código (`/3`) e prosa (`/4`) com margem de 15%.
- [ ] Inicialização de `current.json` no `pactx pack` e leitura pelo `pactx status --telemetry`.
- [ ] Injeção de micro-âncoras `<!-- pactx:v1 ... -->` e diretiva `/remember` no `composer.ts`.
- [ ] Comando `pactx extract <file>` com parsers (Claude, ChatGPT, Cursor, Raw) e extração determinística de âncoras/Git.
- [ ] Extração semântica opcional via `fetch` nativo com geração de `evidence: { turn, quote }`.
- [ ] Servidor MCP `pactx serve --mcp` com fluxo de `propose_mutation` desacoplado por `proposalId`.
- [ ] Suíte de testes automatizados cobrindo:
  - `tokenEstimator`: texto puro, código puro, mix, strings vazias e com espaços.
  - `parsers`: transcripts válidos, arquivos truncados e formatos corrompidos.
  - `micro-anchors`: âncoras válidas em JSON, JSON malformado, injeções em âncoras.
  - `MCP`: chamadas de tool válidas, payloads inválidos, concorrência.
- [ ] Documentação (`README.md`, `README.pt-BR.md`, `TUTORIAL.md`, `ARCHITECTURE.md`, `FEATURES.md`) sincronizada em Inglês e Português.
