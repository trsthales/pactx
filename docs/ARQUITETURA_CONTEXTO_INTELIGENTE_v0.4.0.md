# Arquitetura de Contexto Inteligente — PactX v0.4.0
## Amnésia, Monitoramento, Telemetria e Controle Ativo de Contexto

**Data:** 2026-08-27  
**Autor:** Principal AI Systems Architect & LLM Context Engine Researcher  
**Alvo:** `@trsthales/pactx` — Ciclo Fechado de Memória Cognitiva para IA  
**Escopo:** Solução arquitetural para Late-Session Amnesia e Context Blindness  
**Versão-Alvo:** v0.4.0 (MCP Server + Telemetria + Out-of-Band Extractor)

---

## 1. 🧠 ANÁLISE DOS MODOS DE FALHA DA AMNÉSIA E DA CEGUEIRA DE CONTEXTO

### 1.1. O Modelo Mental Correto: A IA como CPU Sem Cache L3

Um LLM não possui memória persistente entre sessões — ele é uma **função de transformação pura** de um vetor de tokens de entrada para um vetor de tokens de saída. A "memória" durante a sessão é inteiramente o conteúdo da janela de contexto, que é limitada, finita e degradável.

A analogia mais precisa: uma CPU sem cache L3 forçada a processar toda a memória RAM de um programa na memória principal. Conforme o programa cresce, o tempo de acesso aumenta, os registradores se esgotam e o processador começa a "priorizar" — silenciosamente ignorando instruções periféricas para manter a coerência dos caminhos quentes.

```
                    JANELA DE CONTEXTO (ex: 200K tokens)
┌──────────────────────────────────────────────────────────────────────┐
│ [CONTEXTO INICIAL]        [MENSAGENS DA SESSÃO]          [AGORA]    │
│  pactx pack (400t)  M1  M2  M3  ... M20  M30  M40  M45  M48  M50   │
│ ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ▲                                                              ▲     │
│ ATENÇÃO PLENA (início)                          ATENÇÃO DECAÍDA      │
│ Hipóteses Negativas                             "O que dissemos no   │
│ são registradas aqui                            M5 mesmo?"           │
└──────────────────────────────────────────────────────────────────────┘
         ZONA DE ALTA FIDELIDADE    ZONA DE DECAIMENTO PROGRESSIVO
         (30-40% primeiros tokens)  (20-10% últimos tokens, efeito borda)
```

### 1.2. Os Seis Modos de Falha Catalogados

#### FALHA-01: Late-Session Amnesia (Amnésia de Sessão Tardia)

**Mecanismo:** Em chats com 40+ turnos, os transformers de atenção (multi-head attention) alocam pesos desproporcionalmente para tokens recentes. Tokens do início da sessão — onde as hipóteses descartadas e as restrições de arquitetura foram estabelecidas — recebem gradientes de atenção próximos de zero.

**Manifestação Observável:**
- A IA sugere refatorar exatamente o que foi decidido que NÃO deveria ser refatorado na mensagem M3.
- A IA "esquece" que uma abordagem foi descartada por razão X e a propõe novamente como solução inovadora.
- O bloco `pactx-update` gerado no final da sessão omite hipóteses rejeitadas nas mensagens M2-M10.

**Por que o `/handoff` tardio é o pior momento para pedir o resumo:**
```
Solicitação de /handoff → IA usa atenção disponível → Atenção vai para últimas 20 msgs
                                                     ↓
                        [Mensagens M1-M30 recebem ~5% da atenção total]
                                                     ↓
                        Conhecimento Negativo M2-M10 é SILENCIOSAMENTE DESCARTADO
                        (não há sinal de erro, o output parece válido)
```

#### FALHA-02: Hallucination Under Saturation (Alucinação por Saturação)

**Mecanismo:** Com janela de contexto >80% ocupada, o modelo começa a gerar tokens mais prováveis estatisticamente (em vez de condicionalmente corretos ao contexto), o que aumenta a taxa de confabulação — especialmente em domínios técnicos onde os invariantes são precisos.

**Sintoma típico no pactx:** A IA gera um `pactx-update` com `base_revision` incorreto ou com decisões que contradizem frontmatter existente. O validador Zero-Trust do `pactx update` CAPTURA essa falha — mas a captura só acontece APÓS o dano de DX (desenvolvedor teve que pedir `/handoff`, copiar, rodar `pactx update`, e só então descobriu que o output era inválido).

#### FALHA-03: Semantic Drift (Deriva Semântica Progressiva)

**Mecanismo:** Ao longo da sessão, a IA acumula pequenas desvivações de terminologia. O "rate limiter" mencionado na M2 vira "throttle middleware" na M30 e "request guard" na M45. Sem âncora terminológica ativa, o glossário mental da IA diverge do `glossary.md` canônico.

**Impacto no pactx:** Novos termos incorretos entram no `new_glossary_terms` do `pactx-update`, criando termos duplicados ou conflitantes no `glossary.md`.

#### FALHA-04: Negative Knowledge Erosion (Erosão do Conhecimento Negativo)

**Mecanismo:** O Conhecimento Negativo ("hipóteses descartadas") é fundamentalmente mais difícil de preservar do que o Conhecimento Positivo ("decisões tomadas"). Isso porque o Conhecimento Negativo é definido por ausência — não há um artefato ativo que o represente. Apenas a memória do turno onde ele foi discutido o mantém vivo.

**Este é o modo de falha mais crítico e sub-documentado no design de agentes IA.** A IA não "sabe que esqueceu" — ela simplesmente repropõe a hipótese com confiança total.

#### FALHA-05: Context Blindness (Cegueira de Janela de Contexto)

**Mecanismo:** O desenvolvedor não tem visibilidade sobre o consumo atual da janela. As interfaces de chat (ChatGPT, Claude.ai, Gemini) deliberadamente ocultam esse dado do usuário. O desenvolvedor descobre saturação pelo comportamento errático da IA — um sinal tardio e qualitativo.

**Janelas de contexto por modelo (referência agosto 2026):**

| Modelo | Janela Máxima | Tokens "Seguros" (~70%) |
|---|---|---|
| Claude Sonnet 4.5 | 200K tokens | ~140K |
| GPT-4o | 128K tokens | ~90K |
| Gemini 2.5 Pro | 1M tokens | ~700K |
| Gemini 2.5 Flash | 1M tokens | ~700K |
| Llama 3.1 405B | 128K tokens | ~90K |

**Para sessões típicas de desenvolvimento:**
- Context pack inicial (`pactx pack`): ~400 tokens
- Prompt de sistema médio: ~500 tokens
- Mensagem média de usuário: ~200 tokens
- Resposta média da IA: ~600 tokens
- **Custo por turno:** ~800 tokens
- **Sessão de 40 turnos:** ~32K tokens + contexto inicial = ~33K tokens
- **Para GPT-4o (128K):** 33K tokens = **26% da janela**
- **Mas:** com exemplos de código grandes, diffs, logs de erro → pode chegar a 300-500 tokens/mensagem e 2000+ tokens/resposta → **40 turnos = 100K+ tokens**

#### FALHA-06: Attention Window Poisoning (Envenenamento por Artefatos Grandes)

**Mecanismo:** Colar diffs completos de arquivos grandes, stack traces com centenas de linhas ou outputs de `git log` extensos "poisona" a janela — esses tokens densos de baixa informação semântica consomem espaço crítico que deveria ser ocupado por contexto de decisão.

---

### 1.3. O Paradoxo do Auto-Resumo Tardio

```
Estado mental da IA ao receber /handoff com 45 mensagens na sessão:

┌─────────────────────────────────────────────────────────────────────┐
│ MEMÓRIA ATIVA (tokens que recebem atenção real):                    │
│   • Últimas 15 mensagens: 85% da atenção                            │
│   • Mensagens 20-30: 10% da atenção                                 │
│   • Mensagens 1-20 (hipóteses, decisões iniciais): 5% da atenção    │
│                                                                     │
│ TAREFA: "Gere o pactx-update da SESSÃO INTEIRA"                     │
│                                                                     │
│ RESULTADO PROVÁVEL:                                                  │
│   ✅ Captura decisões das últimas 15 mensagens (alta fidelidade)     │
│   ⚠️  Captura parcialmente decisões das mensagens 20-30              │
│   ❌ SILENCIOSAMENTE OMITE hipóteses descartadas das msgs 1-20       │
│   ❌ SILENCIOSAMENTE OMITE contra-argumentos das msgs 5-15           │
└─────────────────────────────────────────────────────────────────────┘
```

**A armadilha crítica:** O output do `/handoff` tardio parece completo. Ele tem estrutura YAML válida, passa na validação do `pactx update`, e é aplicado ao repositório. Mas é semanticamente incompleto de forma não-detectável.

---

## 2. 📊 SISTEMA DE MONITORAMENTO, TELEMETRIA E CONTROLE DE CONTEXTO

### 2.1. Fórmulas de Estimativa de Tokens

O `pactx` pode implementar estimativa de tokens sem depender de APIs externas, usando as seguintes heurísticas:

#### Regra de Tokenização por Heurística Local

```typescript
// src/utils/tokenEstimator.ts

/**
 * Estimativa conservadora de tokens para texto em inglês/português.
 * Base: ~4 chars/token para texto prosa, ~3 chars/token para código.
 * Adicionamos 15% de margem de segurança.
 */
export function estimateTokens(text: string): number {
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = text.match(codeBlockRegex) || [];
  const codeText = codeBlocks.join('');
  const proseText = text.replace(codeBlockRegex, '');

  const codeTokens = Math.ceil(codeText.length / 3);
  const proseTokens = Math.ceil(proseText.length / 4);

  return Math.ceil((codeTokens + proseTokens) * 1.15); // 15% safety margin
}

/**
 * Estimativa do custo de um turno de conversa (user + assistant).
 */
export function estimateTurnCost(
  userMessage: string,
  assistantResponse: string
): number {
  return estimateTokens(userMessage) + estimateTokens(assistantResponse);
}
```

#### Modelo Estatístico de Previsão de Saturação

```
Tokens_Consumed(n) = T_context + T_system + Σ(i=1..n) [T_user(i) + T_assistant(i)]

Onde:
  T_context  = tokens do context pack inicial (pactx pack output) ≈ 400t
  T_system   = tokens do prompt de sistema do modelo ≈ 500t
  T_user(i)  = tokens da i-ésima mensagem do usuário
  T_assistant(i) = tokens da i-ésima resposta da IA

Saturação(n) = Tokens_Consumed(n) / Janela_Máxima_do_Modelo

LIMIARES DE ALERTA:
  🟢 SAFE:     Saturação < 50%   → Sessão saudável
  🟡 CAUTION:  Saturação 50-70%  → Considerar handoff preventivo
  🟠 WARNING:  Saturação 70-85%  → FORTE recomendação de handoff AGORA
  🔴 CRITICAL: Saturação > 85%   → Risco alto de amnésia e alucinação
```

### 2.2. Métricas de Context Health (Context Health Score)

O **Context Health Score** é uma métrica composta que combina saturação quantitativa com indicadores qualitativos de deriva semântica:

```
ContextHealth = 100 × (1 - W_sat × Sat) × (1 - W_age × Age) × (1 - W_drift × Drift)

Componentes:
  Sat   = Saturação estimada da janela [0..1]
  Age   = Turnos desde o último checkpoint / Turnos_máx_recomendados [0..1]
  Drift = Número de contradições detectadas / Limiar de drift [0..1]

Pesos padrão:
  W_sat   = 0.5  (saturação é o fator dominante)
  W_age   = 0.3  (tempo desde último checkpoint)
  W_drift = 0.2  (indicador de deriva semântica)
```

#### Métricas de Drift Detectáveis Localmente (Sem IA)

| Métrica | Fórmula de Cálculo | Limiar de Alerta |
|---|---|---|
| **Turn Count** | `n = número de pares (user, assistant) na sessão` | n > 30 |
| **Git Diff Volume** | `bytes(git diff HEAD)` acumulados na sessão | > 50KB diff |
| **Rejected Hypothesis Age** | `now - timestamp_última_hipótese_registrada` | > 20 turnos |
| **ADR Contradiction Score** | Comparar palavras-chave de decisões com respostas recentes | > 2 contradições |
| **Glossary Drift** | Termos do glossary.md vs termos usados na última resposta | > 3 termos ausentes |

### 2.3. Limiares de Alerta e Early Warning System

```typescript
// src/telemetry/contextHealth.ts

export interface ContextHealthReport {
  sessionId: string;
  timestamp: string;
  model: {
    name: string;
    maxTokens: number;
    safeZoneTokens: number;  // 70% da janela máxima
  };
  consumption: {
    estimatedTokens: number;
    saturationPercent: number;
    turnsCount: number;
    contextPackTokens: number;
  };
  health: {
    score: number;           // 0-100, 100 = perfeito
    grade: 'SAFE' | 'CAUTION' | 'WARNING' | 'CRITICAL';
    daysFromLastHandoff: number;
    rejectedHypothesesAtRisk: number;  // hipóteses registradas há >20 turnos
  };
  recommendations: string[];
}

export const THRESHOLDS = {
  SAFE:     { saturation: 0.50, score: 80 },
  CAUTION:  { saturation: 0.70, score: 60 },
  WARNING:  { saturation: 0.85, score: 40 },
  CRITICAL: { saturation: 0.95, score: 20 },
} as const;

export const MODEL_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-5':  200_000,
  'claude-opus-4':      200_000,
  'gpt-4o':             128_000,
  'gpt-4o-mini':        128_000,
  'gemini-2.5-pro':   1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'llama-3.1-405b':    128_000,
};
```

### 2.4. Comandos de Visualização e Telemetria

#### `pactx status --telemetry`

```text
╔══════════════════════════════════════════════════════════════════════╗
║              pactx Context Health Dashboard v0.4.0                  ║
╠══════════════════════════════════════════════════════════════════════╣
║ Session: session_2026-08-27_a3f2d1   Model: claude-sonnet-4-5       ║
║ Started: 03:45:22   Duration: 48min  Turns: 38                      ║
╠══════════════════════════════════════════════════════════════════════╣
║ CONTEXT CONSUMPTION                                                  ║
║   Context Pack (initial):    412 tokens   [  2%]                    ║
║   Session Accumulation:   27,840 tokens   [ 14%]                    ║
║   Total Estimated:        28,252 tokens   [ 14%]                    ║
║   Safe Zone (70%):       140,000 tokens                             ║
║                                                                     ║
║   [████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 14%          ║
║    ← SAFE                    CAUTION  WARNING   CRIT →              ║
╠══════════════════════════════════════════════════════════════════════╣
║ CONTEXT HEALTH SCORE: 87/100 🟢 SAFE                                ║
║   Saturation Factor:    0.14  → SAFE                                ║
║   Session Age Factor:   0.38  → CAUTION (38 turnos)                 ║
║   Semantic Drift:       0.05  → SAFE                                ║
╠══════════════════════════════════════════════════════════════════════╣
║ RISK INDICATORS                                                     ║
║   ⚠️  Rejected hypotheses registered >20 turns ago: 3               ║
║   ✅  No ADR contradictions detected in recent responses            ║
║   ✅  Glossary terms present in recent responses: 8/9               ║
║   ⚠️  Git diff accumulated: 67KB (above 50KB threshold)             ║
╠══════════════════════════════════════════════════════════════════════╣
║ RECOMMENDATIONS                                                     ║
║   • Session health is good. Continue working normally.              ║
║   • Consider a Micro-Checkpoint at ~turn 45-50.                     ║
║   • Run /handoff before reaching turn 55 (estimated WARNING zone).  ║
╚══════════════════════════════════════════════════════════════════════╝
```

#### Telemetria no Output do `pactx pack`

```text
✔ Context packed successfully!
📋 Copied to clipboard!
Size: 1.45 KB | ~412 tokens

┌─ Session Telemetry ──────────────────────────────────────────────┐
│ Model Profile: claude-sonnet-4-5 (200K window)                   │
│ Session Budget: ~412 tokens used / ~140,000 tokens safe zone     │
│ Estimated session lifespan at avg pace: ~170 turns               │
│ ⚡ Micro-Checkpoint recommended at turn 30 / Hard limit: turn 50  │
└──────────────────────────────────────────────────────────────────┘
```

#### Shell Prompt Integration

```bash
# ~/.bashrc ou ~/.zshrc
pactx_prompt_health() {
  if command -v pactx &>/dev/null; then
    local health
    health=$(pactx status --telemetry --format=prompt-short 2>/dev/null)
    echo "${health}"
  fi
}
PS1='$(pactx_prompt_health)'"$PS1"
# Output: [pactx:🟢87] usuario@host:~/projeto$
# Output: [pactx:🟠52] usuario@host:~/projeto$
# Output: [pactx:🔴23] usuario@host:~/projeto$
```

### 2.5. Schema de Sessão de Telemetria (`.pactx/sessions/`)

```typescript
// .ai-context/.pactx/sessions/session-<iso-date>-<uuid>.json
interface SessionRecord {
  id: string;              // UUID v4
  startedAt: string;       // ISO 8601
  model: string;
  contextPackHash: string; // SHA-256 do context pack inicial
  contextPackTokens: number;
  checkpoints: Array<{
    turn: number;
    timestamp: string;
    estimatedTokens: number;
    capturedFacts: string[];
    capturedHypotheses: string[];
    capturedDecisions: string[];
  }>;
  currentTurn: number;
  estimatedTotalTokens: number;
  healthScore: number;
  lastHandoffTurn: number | null;
  closedAt: string | null;
}
```

---

## 3. 🛠️ PROPOSTAS DE ARQUITETURA PARA EXTRAÇÃO DE ESTADO

### 3.1. Solução A: Out-of-Band Extractor (`pactx extract`)

#### Filosofia

Em vez de pedir para a IA cansada resumir a si mesma, extraímos o transcript bruto e enviamos para um modelo limpo (zero-context, full attention) com uma tarefa cirúrgica e bem definida.

```
MODO ATUAL (Frágil):
  Sessão Longa (45 turnos) → /handoff → IA cansada resume → pactx-update incompleto

MODO OUT-OF-BAND (Robusto):
  Sessão Longa (45 turnos) → Export do Transcript → pactx extract transcript.json
                               ↓
            Modelo Secundário Limpo (Haiku/Flash, zero-context)
                               ↓
               pactx-update com fidelidade 100% determinística
```

#### CLI Contract

```bash
# Uso básico
pactx extract claude_chat_export.json --model haiku
pactx extract cursor_transcript.jsonl --model flash
pactx extract --stdin < chat_export.json
cat session.json | pactx extract --stdin --out session_update.md

# Com opções avançadas
pactx extract transcript.json \
  --model gemini-flash \
  --focus "ADRs,rejected-hypotheses" \
  --since-turn 20 \
  --merge-with-current \
  --dry-run
```

#### Pipeline de Extração

```typescript
// src/commands/extract.ts

export async function extractFromTranscript(options: ExtractOptions): Promise<void> {
  // 1. PARSE: Detecta e normaliza o formato do transcript
  const transcript = await TranscriptParser.detect(options.input);
  
  // 2. PRE-PROCESS: Extração determinística ANTES de chamar a IA
  const deterministicData = await DeterministicExtractor.extract(transcript);
  
  // 3. CHUNK: Divide em janelas sobrepostas se for muito longo
  const chunks = TranscriptChunker.chunk(transcript, {
    maxTokensPerChunk: 80_000,
    overlapTurns: 3,
    strategy: 'decision-aware',
  });
  
  // 4. EXTRACT: Chama modelo limpo para cada chunk
  const chunkUpdates = await Promise.all(
    chunks.map(chunk => ModelExtractor.extract(chunk, {
      model: options.model,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      existingContext: deterministicData,
    }))
  );
  
  // 5. MERGE: Consolida os updates de múltiplos chunks sem duplicatas
  const mergedUpdate = UpdateMerger.merge(chunkUpdates, deterministicData);
  
  // 6. OUTPUT: Formata como bloco pactx-update padrão
  const output = UpdateFormatter.format(mergedUpdate);
  
  if (options.dryRun) {
    console.log(output);
  } else {
    await ingestUpdate(output, options);
  }
}
```

#### Prompt de Extração Cirúrgico

```typescript
// src/commands/extract/prompts.ts

export const EXTRACTION_SYSTEM_PROMPT = `
You are a surgical context extractor for the pactx system.
Your ONLY task: extract ALL architectural decisions, facts, and rejected hypotheses
from the provided conversation transcript.

CRITICAL RULES:
1. You MUST include ALL rejected hypotheses (things explicitly decided NOT to do)
   — these are the most commonly lost in late-session summaries.
2. You MUST attribute each item to the approximate turn where it was decided.
3. You MUST flag contradictions between early and late session decisions.
4. Do NOT summarize or paraphrase — preserve the exact technical language.
5. If uncertain whether something is a decision vs. exploration, mark it as a
   candidate with confidence: LOW/MEDIUM/HIGH.

OUTPUT FORMAT: Emit ONLY the pactx-update YAML block. No commentary.
`;
```

#### Adaptadores de Formato de Transcript

```typescript
// src/commands/extract/parsers/
// Interface normalizada (formato interno do pactx)
interface NormalizedTranscript {
  source: 'claude' | 'chatgpt' | 'gemini' | 'cursor' | 'claude-code' | 'generic';
  sessionId?: string;
  model?: string;
  turns: Array<{
    index: number;
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    tokenCount?: number;
  }>;
  metadata: {
    totalTurns: number;
    estimatedTokens: number;
    hasCodeBlocks: boolean;
    detectedLanguages: string[];
  };
}

// Parsers implementados (detecção automática por estrutura do JSON):
// ClaudeExportParser    → JSON export do Claude.ai
// ChatGPTExportParser   → ZIP/JSON do ChatGPT
// GeminiExportParser    → Google Takeout format
// CursorTranscriptParser → .jsonl do Cursor
// ClaudeCodeParser      → Formato Claude Code
// MarkdownTranscriptParser → MD genérico (fallback)
// PlainTextParser       → Texto bruto (último recurso)
```

---

### 3.2. Solução B: In-Flight Micro-Anchors (Checkpoints Contínuos)

#### Filosofia

Em vez de acumular toda a informação para o final, capturar decisões no momento exato em que elas ocorrem, com custo quase zero de tokens durante a conversa.

#### O Protocolo de Micro-Anchor

```markdown
## Session Micro-Anchor Protocol (v1.0)
During this session, whenever you make an architectural decision, reject a hypothesis,
or establish a critical fact, emit a compact anchor IMMEDIATELY after your response.
This preserves decisions even if the session ends abruptly.

Format (emit inline, costs ~15 tokens):
`[📌 ANCHOR|TYPE|content]`

Types:
  DEC  = Architecture Decision: `[📌 ANCHOR|DEC|Use PBKDF2 for PIN hashing]`
  REJ  = Rejected Hypothesis:   `[📌 ANCHOR|REJ|Email auth not viable for kids]`
  FACT = Established Fact:      `[📌 ANCHOR|FACT|Rate limit: 5 req/min/user]`
  TASK = New task identified:   `[📌 ANCHOR|TASK|Implement PIN validation middleware]`
  WARN = Risk/blocker found:    `[📌 ANCHOR|WARN|PostgreSQL migration needed before deploy]`

Emit anchors SILENTLY at the END of responses where decisions are made.
Never emit anchors for exploratory discussion — only for confirmed decisions.
```

#### Parser de Micro-Anchors

```typescript
// src/commands/extract/microAnchorParser.ts

export const ANCHOR_REGEX = /\[📌 ANCHOR\|(\w+)\|([^\]]+)\]/g;

export interface MicroAnchor {
  type: 'DEC' | 'REJ' | 'FACT' | 'TASK' | 'WARN';
  content: string;
  turn: number;
  timestamp?: string;
}

export function parseMicroAnchors(transcript: NormalizedTranscript): MicroAnchor[] {
  const anchors: MicroAnchor[] = [];
  for (const turn of transcript.turns) {
    if (turn.role !== 'assistant') continue;
    let match: RegExpExecArray | null;
    const regex = new RegExp(ANCHOR_REGEX.source, 'g');
    while ((match = regex.exec(turn.content)) !== null) {
      const [, type, content] = match;
      if (['DEC', 'REJ', 'FACT', 'TASK', 'WARN'].includes(type)) {
        anchors.push({
          type: type as MicroAnchor['type'],
          content: content.trim(),
          turn: turn.index,
          timestamp: turn.timestamp,
        });
      }
    }
  }
  return anchors;
}

export function anchorsToPartialUpdate(anchors: MicroAnchor[]): PartialPactxUpdate {
  return {
    new_facts:           anchors.filter(a => a.type === 'FACT').map(a => a.content),
    rejected_hypotheses: anchors.filter(a => a.type === 'REJ').map(a => a.content),
    new_decisions:       anchors.filter(a => a.type === 'DEC').map(a => ({
                           id: 'auto', title: a.content, reason: `Turn ${a.turn}`
                         })),
  };
}
```

#### Integração no `pactx pack`

```bash
# Padrão: inclui instrução de micro-anchor (~80 tokens extras)
pactx pack

# Desativa para sessões de baixo consumo de tokens
pactx pack --no-anchors

# Modo ultra-compacto: inclui só o hint mínimo (~20 tokens)
pactx pack --anchor-mode=minimal
```

---

### 3.3. Solução C: MCP Real-Time Mutation Recording

#### Servidor MCP v0.4.0 — Tools Principais

```typescript
// src/mcp/server.ts

// TOOL 1: Captura decisão síncrona durante raciocínio
server.tool('pactx_record_decision', {
  description: 'Records an architectural decision, fact, or rejected hypothesis IMMEDIATELY when made.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['decision', 'rejected_hypothesis', 'fact', 'task', 'warning'],
      },
      content: { type: 'string', maxLength: 500 },
      rationale: { type: 'string', maxLength: 1000 },
      confidence: { type: 'string', enum: ['confirmed', 'tentative'] },
      satisfies: { type: 'array', items: { type: 'string' } },
    },
    required: ['type', 'content', 'confidence'],
  },
  async handler({ type, content, confidence, rationale, satisfies }) {
    const sessionStore = await SessionStore.getCurrent();
    const entry = {
      id: generateId(), type, content, rationale, confidence, satisfies,
      timestamp: new Date().toISOString(),
      turn: sessionStore.currentTurn,
    };
    await sessionStore.appendCheckpoint(entry);
    if (confidence === 'confirmed') {
      await DraftPersister.persist(entry);
    }
    return {
      content: [{ type: 'text', text: `✅ Recorded ${type}: "${content.substring(0, 50)}..."` }],
    };
  },
});

// TOOL 2: Context health em tempo real
server.tool('pactx_get_context_health', {
  description: 'Returns real-time context window health. Call proactively to decide whether to trigger a handoff.',
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string' },
      estimated_tokens_used: { type: 'number' },
    },
    required: ['model', 'estimated_tokens_used'],
  },
  async handler({ model, estimated_tokens_used }) {
    const health = await ContextHealthEngine.calculate({ model, estimatedTokens: estimated_tokens_used });
    return { content: [{ type: 'text', text: JSON.stringify(health, null, 2) }] };
  },
});

// TOOL 3: Proposta de mutação com revisão diferida
server.tool('pactx_propose_mutation', {
  description: 'Proposes a pactx-update mutation for deferred human review. Does NOT apply immediately.',
  inputSchema: {
    type: 'object',
    properties: {
      mutation: { type: 'object' },
      trigger: { type: 'string', enum: ['handoff', 'checkpoint', 'task-complete', 'blocker-found'] },
    },
    required: ['mutation', 'trigger'],
  },
  async handler({ mutation, trigger }) {
    const validation = await PactxParser.validate(mutation);
    if (!validation.valid) {
      return { content: [{ type: 'text', text: `❌ Validation failed: ${validation.errors.join(', ')}` }], isError: true };
    }
    const proposalId = await ProposalStore.save({ mutation, trigger, proposedAt: new Date().toISOString(), status: 'pending_review' });
    return { content: [{ type: 'text', text: `📋 Proposal saved (ID: ${proposalId}). Run \`pactx update --proposal ${proposalId}\` to review.` }] };
  },
});

// RESOURCES
server.resource('pactx://context', 'Current canonical context pack', async () => {
  const context = await composeContext();
  return { contents: [{ uri: 'pactx://context', mimeType: 'text/markdown', text: context }] };
});

server.resource('pactx://health', 'Current context health report', async () => {
  const health = await ContextHealthEngine.getLatest();
  return { contents: [{ uri: 'pactx://health', mimeType: 'application/json', text: JSON.stringify(health, null, 2) }] };
});

// PROMPT: Handoff otimizado com micro-anchors
server.prompt('pactx_handoff_prompt', {
  description: 'Generates optimal /handoff prompt incorporating all captured micro-anchors.',
  arguments: [{ name: 'session_focus', description: 'Main topic of current session', required: false }],
  async handler({ session_focus }) {
    const anchors = await SessionStore.getAllAnchors();
    const health = await ContextHealthEngine.getLatest();
    const anchorsSummary = anchors.length > 0
      ? `\n\nDuring this session, I captured these micro-anchors:\n${anchors.map(a => `- [${a.type}] ${a.content}`).join('\n')}`
      : '';
    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Generate the pactx-update block for this session.${anchorsSummary}\n\nFocus: ${session_focus || 'General session summary'}\nHealth at handoff: ${health.grade} (${health.score}/100)\n\nInclude ALL decisions, facts, and rejected hypotheses — especially from early in the session.\nEmit ONLY the pactx-update YAML block.`,
        },
      }],
    };
  },
});
```

---

## 4. ⚖️ MATRIZ DE TRADE-OFFS

### 4.1. Comparação das Três Abordagens

| Dimensão | A: Out-of-Band Extractor | B: In-Flight Micro-Anchors | C: MCP Real-Time |
|---|---|---|---|
| **Custo de Tokens (por sessão)** | 0 tokens durante sessão + custo de inferência | +80 tokens iniciais + ~15 tokens/decisão | +0 tokens (custo no agente, não no chat) |
| **Fricção de DX** | Média: requer export manual | Baixa: automático | Mínima: totalmente automático em IDEs |
| **Fidelidade Semântica** | Alta (90-95%): modelo limpo | Muito Alta (95-99%): captura no momento | Máxima (99%+): registro síncrono |
| **Cobertura de Plataformas** | Alta: qualquer chat com export | Alta: qualquer chat de texto | Limitada: IDEs com suporte a MCP |
| **Complexidade de Implementação** | Alta: múltiplos parsers | Baixa: regex + instrução no prompt | Alta: MCP server + SessionStore |
| **Custo Financeiro** | Baixo: Haiku/Flash ~$0.005/sessão | Zero | Zero |
| **Latência** | 10-30s (chamada API) | Instantâneo | Instantâneo |
| **Funciona offline?** | Não (requer API key) | Sim | Sim |
| **Detecta Conhecimento Negativo?** | Sim (prompt instruído explicitamente) | Sim (anchors REJ) | Sim (type: rejected_hypothesis) |
| **Requer mudança de comportamento?** | Sim: exportar transcript | Não | Não |

### 4.2. Custo Financeiro do Out-of-Band Extractor

```
Cenário: Sessão de 40 turnos com Claude Sonnet 4.5
  Transcrição estimada: 40 × 800t = 32,000 tokens de entrada

Com Gemini 2.5 Flash (recomendado):
  Entrada: 32,000t × $0.15/MTok = $0.005
  Saída:     ~600t × $0.60/MTok = $0.0004
  Total: ~$0.005 por sessão (~0.5 centavos)

Com Claude Haiku 3.5:
  Entrada: 32,000t × $0.80/MTok = $0.026
  Saída:     ~600t × $4.00/MTok = $0.0024
  Total: ~$0.028 por sessão (~3 centavos)

Custo anual (1 sessão/dia):
  Gemini Flash: ~$1.80/ano
  Claude Haiku: ~$10/ano
```

### 4.3. Recomendação por Perfil de Usuário

| Perfil de Usuário | Solução Recomendada | Justificativa |
|---|---|---|
| Dev solo, sessões curtas (<30 turnos) | B: Micro-Anchors | Complexidade zero, fricção zero |
| Dev solo, sessões longas (30+ turnos) | B + A como fallback | Anchors previnem, Extractor corrige |
| Time usando Cursor/Claude Code | C: MCP Real-Time | Automação total, sem fricção |
| CI/CD e pipelines de agentes | C: MCP | APIs programáticas, sem clipboard |
| Segurança crítica (sem cloud) | B + heurístico local | Zero dependência externa |

---

## 5. 📐 ESPECIFICAÇÃO TÉCNICA DA SOLUÇÃO RECOMENDADA

### 5.1. Arquitetura em Camadas (Layer Architecture)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    PACTX CONTEXT CONTINUITY v0.4.0                   │
│                                                                      │
│  Layer 1: PASSIVE (sempre ativo)                                     │
│  ├── Micro-Anchor Protocol no context pack                           │
│  └── Telemetria local (estimativa de tokens, contador de turnos)     │
│                                                                      │
│  Layer 2: ACTIVE (acionado por threshold)                            │
│  ├── Alerta de Early Warning no terminal                             │
│  ├── Prompt de checkpoint na saída do pactx pack                     │
│  └── Summary intermediário sugerido a cada N turnos                  │
│                                                                      │
│  Layer 3: EXTRACTION (sessão longa ou falha de handoff)              │
│  ├── pactx extract <transcript> (Out-of-Band, modelo limpo)          │
│  └── Merge inteligente com micro-anchors capturados                  │
│                                                                      │
│  Layer 4: REALTIME (IDEs com MCP)                                    │
│  ├── pactx_record_decision (captura síncrona)                        │
│  ├── pactx_get_context_health (monitoramento em tempo real)          │
│  └── pactx_propose_mutation (handoff não-destrutivo)                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2. Schema Completo de Telemetria de Sessão

```typescript
// .ai-context/.pactx/sessions/session-<iso>-<uuid>.json
interface PactxSessionTelemetry {
  schema_version: '1.0';
  id: string;                    // UUID v4
  started_at: string;            // ISO 8601
  closed_at: string | null;
  model: string;
  model_window_tokens: number;
  context_pack_hash: string;     // SHA-256 do context pack enviado
  context_pack_tokens: number;
  current_turn: number;
  turns: Array<{
    index: number;
    estimated_user_tokens: number;
    estimated_assistant_tokens: number;
    micro_anchors_captured: MicroAnchor[];
    health_snapshot: {
      saturation_percent: number;
      health_score: number;
      grade: 'SAFE' | 'CAUTION' | 'WARNING' | 'CRITICAL';
    };
  }>;
  all_anchors: MicroAnchor[];    // Todos os anchors capturados na sessão
  handoffs: Array<{
    turn: number;
    method: 'handoff-command' | 'extract' | 'mcp-propose';
    transaction_id: string | null;
    health_at_handoff: number;
  }>;
  summary: {
    total_turns: number;
    total_estimated_tokens: number;
    peak_saturation_percent: number;
    total_anchors_captured: number;
    knowledge_negative_captured: number;  // Anchors REJ
    knowledge_positive_captured: number;  // Anchors DEC + FACT
    handoff_health_avg: number | null;
  };
}
```

### 5.3. CLI Contract — `pactx extract`

```typescript
// src/commands/extract/index.ts
export interface ExtractOptions {
  input: string | Buffer;
  model: 'haiku' | 'flash' | 'flash-lite' | string;
  modelApiKey?: string;           // Via env: PACTX_EXTRACT_API_KEY
  sinceT?: number;                // Extrair a partir do turno N
  focusTypes?: Array<'decisions' | 'facts' | 'rejected-hypotheses' | 'tasks'>;
  mergeWithCurrent?: boolean;
  contextPack?: string;
  dryRun?: boolean;
  outputFile?: string;
  autoApply?: boolean;
  incorporateAnchors?: boolean;
  sessionId?: string;
}

export interface ExtractResult {
  success: boolean;
  anchorsFound: number;
  decisionsExtracted: number;
  factsExtracted: number;
  hypothesesExtracted: number;
  contradictionsDetected: number;
  confidencePct: number;          // 0-100
  pactxUpdateBlock: string;
  appliedTransactionId?: string;
}
```

### 5.4. Contrato MCP (OpenAPI-style)

```yaml
# Contrato formal das Tools MCP do pactx v0.4.0

tools:
  pactx_record_decision:
    category: write
    idempotent: false
    persistence: immediate-draft
    human_review_required: false
    
  pactx_propose_mutation:
    category: write
    idempotent: true
    persistence: deferred
    human_review_required: true
    
  pactx_get_context_health:
    category: read
    idempotent: true
    caching: 10s
    
  pactx_get_context:
    category: read
    idempotent: true
    caching: 30s

resources:
  pactx://context:
    mimeType: text/markdown
    refresh: on-mutation
  pactx://health:
    mimeType: application/json
    refresh: 10s
  pactx://session:
    mimeType: application/json
    refresh: on-anchor
```

### 5.5. Fluxo de Dados Completo (v0.4.0)

```
[1. EGRESS — pactx pack]
  .ai-context/ + git state
    → composer.ts → Context Pack (~400 tokens)
    + Micro-Anchor Protocol Instructions (~80 tokens)
    + Telemetria de modelo e limiares (~30 tokens)
    → Clipboard → Usuário cola no chat

[2. SESSÃO ATIVA]
  Turno N: usuário escreve, IA responde
    → MicroAnchorParser.scan(response) → 0..N anchors
    → SessionStore.appendTurn(turn, anchors, tokenEstimate)
    → ContextHealthEngine.calculate() → HealthReport
    Se health.grade === 'WARNING' || 'CRITICAL':
      → Terminal: exibe alerta pactx status --telemetry
      → MCP: resource pactx://health atualizado

[3. HANDOFF (três métodos)]

  Método A — /handoff padrão:
    IA gera pactx-update → usuário copia → pactx update

  Método B — Out-of-Band:
    usuário exporta transcript
    → pactx extract transcript.json --model flash
    → TranscriptParser.detect() → NormalizedTranscript
    → DeterministicExtractor.extract() → baseline heurístico
    → SessionStore.getAnchors() → micro-anchors
    → ModelExtractor.extract() (modelo limpo, zero-context)
    → UpdateMerger.merge(aiOutput, anchors, heuristic)
    → pactx update (pipeline Zero-Trust)

  Método C — MCP Real-Time:
    agent.tool('pactx_record_decision') [síncrono]
    → DraftPersister.persist() → .pactx/draft/
    → agent.tool('pactx_propose_mutation')
    → ProposalStore.save() → .pactx/proposals/<id>.json
    → usuário: pactx update --proposal <id>

[4. INGRESS — pactx update (comum a todos)]
  pactx-update block
    → Parser → Planner → ReviewUI → TransactionEngine (WAL)
    → .ai-context/ atualizado atomicamente
    → SessionStore.recordHandoff(transactionId, healthScore)
    → Próximo pactx pack inclui o novo estado canônico
```

---

## 6. 🛠️ EXTRAÇÃO HEURÍSTICA LOCAL (Parsing Determinístico)

### 6.1. O que Extrair SEM IA (100% Determinístico)

Antes de enviar o transcript para um modelo, o `pactx extract` executa uma fase de extração heurística local como baseline de alta confiança.

#### 6.1.1. Sinais do Git Diff

```typescript
interface GitSignals {
  newFiles: string[];             // Forte sinal de nova funcionalidade
  deletedFiles: string[];         // Possível obsolescência de ADR
  architecturalPatterns: Array<{
    file: string;
    pattern: 'interface-added' | 'class-renamed' | 'dependency-added' | 'api-endpoint-added';
    content: string;
  }>;
  inlineAnnotations: Array<{      // Comentários DECISION/REJECTED em diffs
    type: 'TODO' | 'FIXME' | 'DECISION' | 'REJECTED' | 'INVARIANT';
    content: string;
    file: string;
    line: number;
  }>;
}

// Padrões capturáveis deterministicamente:
// + interface UserAuthService { ... }  → nova interface → candidato a DEC
// + // DECISION: PIN must be 4 digits  → extração direta (confiança 99%)
// + // REJECTED: JWT too complex        → extração como REJ (confiança 99%)
// - class EmailAuthService { ... }     → classe removida → REJ implícito
// + "bcryptjs": "^2.4.3"               → nova dependência → FACT
```

#### 6.1.2. Padrões Linguísticos no Transcript

```typescript
const DECISION_PATTERNS = [
  /we('ve|\s+have) decided to/i,
  /the decision is to/i,
  /we('ll|\s+will) use/i,
  /going with/i,
  /chosen approach:/i,
];

const REJECTION_PATTERNS = [
  /we('re|\s+are) not (going to|using)/i,
  /decided against/i,
  /this approach (won't|will not|doesn't|does not) work/i,
  /rejected because/i,
  /do not (use|retry|implement)/i,
  /NOT viable/i,
];

const FACT_PATTERNS = [
  /confirmed:/i,
  /established fact:/i,
  /rate limit (is|must be|should be)/i,
  /max(imum)?\s+\d+/i,
];
```

#### 6.1.3. Matriz de Confiança por Sinal

| Sinal | Tipo | Confiança | Requer IA? |
|---|---|---|---|
| Comentário `// DECISION:` no diff | DEC | 99% | Não |
| Comentário `// REJECTED:` no diff | REJ | 99% | Não |
| Micro-anchor `[📌 ANCHOR\|REJ\|...]` | REJ | 98% | Não |
| Nova interface TypeScript exportada | DEC candidato | 70% | Sim |
| Dependência nova em package.json | FACT | 90% | Não |
| Padrão linguístico "decided against" | REJ candidato | 65% | Sim |
| Git branch com nome `feat/X` criado | TASK | 80% | Não |
| Schema de banco alterado | DEC candidato | 85% | Sim |
| Teste novo em `__tests__/` | FACT | 75% | Sim |

---

## 7. 🚀 DIRETRIZES DE IMPLEMENTAÇÃO E CRITÉRIOS DE SUCESSO

### 7.1. Roadmap de Implementação (v0.4.0 — 9 Semanas)

```
FASE 1 — Fundações de Telemetria (Semanas 1-2)
├── [Sem. 1]
│   ├── src/telemetry/tokenEstimator.ts
│   ├── src/telemetry/contextHealth.ts
│   ├── src/telemetry/sessionStore.ts
│   └── Testes unitários (mock de modelos)
└── [Sem. 2]
    ├── Integração em pactx pack (output de telemetria)
    ├── pactx status --telemetry (dashboard visual)
    ├── pactx status --telemetry --json (machine-readable)
    └── Documentar shell prompt integration

FASE 2 — Micro-Anchors (Semana 3)
├── src/commands/extract/microAnchorParser.ts
├── Instrução de Micro-Anchor no template do context pack
├── pactx pack --no-anchors (flag de opt-out)
└── Integração em pactx status (exibe anchors capturados)

FASE 3 — MCP Server Core (Semanas 4-6)
├── [Sem. 4] Scaffolding MCP + pactx_get_context + pactx_apply_update
├── [Sem. 5] pactx_record_decision + pactx_get_context_health + pactx_propose_mutation
└── [Sem. 6] Testes de integração MCP (Cursor + Claude Desktop) + docs

FASE 4 — Out-of-Band Extractor (Semanas 7-9)
├── [Sem. 7] src/commands/extract/parsers/ + TranscriptChunker
├── [Sem. 8] ModelExtractor + UpdateMerger + pactx extract CLI
└── [Sem. 9] Testes e2e + benchmark de fidelidade
```

### 7.2. Critérios de Sucesso (6 KPIs Mensuráveis)

| KPI | Meta | Método de Medição |
|---|---|---|
| **Taxa de Retenção de Conhecimento Negativo** | > 90% (vs. ~40-60% atual) | Revisão manual de 10 sessões longas |
| **Precisão da Estimativa de Tokens** | < 20% de erro médio | Comparar com contadores reais da API |
| **Time-to-Warning** | < 1 turno para detectar 70% | Simulação com sessão sintética |
| **Fidelidade do Out-of-Band Extractor** | > 95% (vs. ~70% do /handoff tardio) | Benchmark com 20 transcripts anotados |
| **Latência das Tools MCP** | < 50ms (record), < 200ms (get_context) | Testes de integração com Cursor |
| **Redução de Passos de Handoff** | 5 → 3 passos (chat); 5 → 1 (MCP) | Contagem manual por fluxo |

### 7.3. Seis Invariantes de Design (DO NOT VIOLATE)

1. **Git-Native First:** Toda persistência em `.ai-context/` como Markdown/YAML versionável. Nenhum banco de dados externo, nenhum servidor remoto.

2. **Offline-Capable Core:** Layer 1 (Micro-Anchors + Telemetria Local) funciona completamente sem rede ou API keys. `pactx extract` é opt-in com API key explícita.

3. **Zero-Trust Preservado:** O `pactx extract` gera um `pactx-update` que passa pelo MESMO pipeline Zero-Trust do `pactx update`. Extração automática NÃO bypassa revisão humana (exceto com `--yes`).

4. **Determinismo Antes de IA:** Extração heurística local SEMPRE antes de qualquer chamada de modelo externo. Output da IA = suplemento, não fonte primária.

5. **Contratos Retrocompatíveis:** Schema `pactx-update` v1.1 permanece válido. Novas features = campos opcionais. Nunca remover ou renomear campos existentes.

6. **Human-in-the-Loop Preservado:** Nenhuma mutação automática ao `.ai-context/` sem aprovação explícita, exceto com flags de bypass explícitos (`--yes`, `--auto-approve-proposals`).

### 7.4. Dependências Adicionais para v0.4.0

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "tiktoken": "^1.0.0"
  },
  "optionalDependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@google/generative-ai": "^0.21.0"
  }
}
```

> **Nota:** `tiktoken` é opcional — o sistema degrada graciosamente para a heurística de chars/tokens. `@anthropic-ai/sdk` e `@google/generative-ai` são instalados pelo dev ao configurar `pactx extract`.

---

## Apêndice A: Modelos de Extração Recomendados

| Modelo | Janela | Custo Entrada | Custo Saída | Velocidade | Recomendado para |
|---|---|---|---|---|---|
| **Gemini 2.5 Flash** | 1M tokens | $0.15/MTok | $0.60/MTok | ⚡⚡⚡ | Extração padrão — melhor custo-benefício |
| **Claude Haiku 3.5** | 200K tokens | $0.80/MTok | $4.00/MTok | ⚡⚡ | Alta precisão em decisões técnicas complexas |
| **GPT-4o-mini** | 128K tokens | $0.15/MTok | $0.60/MTok | ⚡⚡ | Alternativa para usuários OpenAI |
| **Gemini 2.5 Flash-Lite** | 1M tokens | $0.04/MTok | $0.15/MTok | ⚡⚡⚡⚡ | Volume alto / CI pipelines |
| **Ollama (local)** | Varia | $0.00 | $0.00 | ⚡ | Modo offline / privacidade máxima |

---

## Apêndice B: Exemplo de Context Pack com Micro-Anchors

```markdown
# pactx Context Pack — 2026-08-27
**Revision:** a3f2d1b8e9c04f2a | **Model:** claude-sonnet-4-5 | **Tokens:** ~512

## 📊 Session Telemetry
Window: 200K tokens | Safe Zone: 140K (70%) | Recommended handoff: turn 50
⚡ Micro-Anchor Protocol ACTIVE — emit `[📌 ANCHOR|TYPE|content]` on each decision

## 🎯 Active Task
TASK-07: Implementar autenticação de alunos via PIN
Status: IN_PROGRESS | Next: Validar PIN no authController

## 🏛️ Architecture Rules (NON-NEGOTIABLE)
1. Jamais expor hash do PIN na API response
2. Rate limit: máximo 5 tentativas/min por usuário
3. PostgreSQL como única fonte de verdade — sem Redis para sessões

## ❌ Rejected Hypotheses (DO NOT RETRY)
- JWT para alunos: complexidade desnecessária para público infantil
- E-mail como identificador: alunos não têm e-mail próprio
- bcrypt rounds > 12: latência inaceitável em hardware de escola pública

## 📋 Active Decisions
- DEC-003: PIN de 4 dígitos + Turma como autenticador composto
- DEC-004: PBKDF2 com salt por aluno para hashing seguro

## 📖 Glossary
- StudentPIN: Código numérico de 4 dígitos atribuído pelo professor
- Turma: Identificador único de turma escolar (ex: "7B-2026")
```

---

*Documento gerado em: 2026-08-27*  
*Versão-alvo: pactx v0.4.0*  
*Referências: [ARCHITECTURE.md](./ARCHITECTURE.md) | [ANALISE_HOSTIL_E_ROADMAP_v0.3.2.md](./ANALISE_HOSTIL_E_ROADMAP_v0.3.2.md) | [FEATURES.md](./FEATURES.md)*
