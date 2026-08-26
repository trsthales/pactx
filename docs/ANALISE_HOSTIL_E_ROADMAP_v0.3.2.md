# Análise Profunda e Hostil de Código, Arquitetura e Roadmap — PactX v0.3.2

**Data da Auditoria:** 2026-08-26  
**Auditor:** Principal Security & Systems Architect (Adversarial AI Red Team)  
**Alvo:** PactX (`@trsthales/pactx`) v0.3.2  
**Escopo:** 100% da base de código (`src/`, `test/`, `docs/`, `package.json`)  
**Metodologia:** Análise estática profunda, inspeção adversarial de fluxo de controle, verificação de concorrência/POSIX, validação de invariantes criptográficas e mapeamento de capacidades para agentes IA.

---

## 1. 🔍 DIAGNÓSTICO EXECUTIVO & POSTURA DE SEGURANÇA

Após a implementação das correções de segurança críticas (**P1-A, P1-B, P1-C, P2-B, P2-C**) na versão `0.3.2`, o PactX atingiu um nível de robustez transacional e contenção de diretório significativamente elevado:

- **Transacionalidade WAL:** 92/92 testes automatizados cobrindo todo o ciclo `PREPARED → APPLYING → COMMITTED / ROLLED_BACK`, auto-recovery com detecção de conflito de hash (`afterHash`) e bloqueio `RECOVERY_REQUIRED`.
- **Prevenção contra Evasão e Injeção:** `sanitizeBodyField` fecha as brechas de injeção HTML/XML (`<script>`, `<img>`, etc.) e esquemas maliciosos (`javascript:`, `data:`).
- **Contenção e Jail:** `resolveAndValidateJail` e `findContextDir` limitam estritamente o alcance ao repositório Git ou a até 10 níveis de diretórios.

No entanto, uma **auditoria adversarial hostil** exige buscar as falhas silenciosas de runtime, suposições implícitas de sistema operacional e vetores de contenção de longo prazo.

---

## 2. 🪲 BUGS SILENCIOSOS & EDGE CASES DE RUNTIME

### [BUG-SIL-01] Não-Determinismo na Ordem de ADRs no `composeContext`
- **Módulo:** `src/composer.ts` (linhas 66-78)
- **Gravidade:** Média (Inconsistência de Contexto / Flutuação de Prompt)
- **Descrição:** Em `getCurrentContextRevision` (linha 37), os arquivos de decisão são lidos com `.sort()`, garantindo hash determinístico. Contudo, em `composeContext` (linha 66), a leitura é feita sem `.sort()`:
  ```typescript
  const files = (fs.readdirSync(decisionsDir) as string[]).filter(f => f.endsWith('.md'));
  ```
  Em sistemas de arquivos onde `readdir` retorna arquivos na ordem dos nós de disco (ext4 sem indexação, XFS, NFS ou certas versões de macOS/Windows), o prompt emitido para a IA terá a ordem dos ADRs alternada entre execuções ou máquinas diferentes, mesmo que a revisão seja idêntica.
- **Correção:** Adicionar `.sort()` em `composeContext`:
  ```typescript
  const files = (fs.readdirSync(decisionsDir) as string[]).filter(f => f.endsWith('.md')).sort();
  ```

---

### [BUG-SIL-02] Fallback de Busy-Wait Consome 100% de CPU em Runtimes Restritos
- **Módulo:** `src/update/lock.ts` (linhas 92-97)
- **Gravidade:** Baixa a Média (Degradação de Performance / CPU Spike)
- **Descrição:** No `ContextLock.acquire()`, caso `SharedArrayBuffer` não esteja disponível no runtime (ou bloqueado por configurações de isolamento), o fallback é um loop síncrono vazio:
  ```typescript
  const sleepUntil = Date.now() + sleepTime;
  while (Date.now() < sleepUntil) {} // 100% de uso de CPU durante os retries
  ```
- **Correção:** Utilizar `Atomics.wait` protegido ou `setTimeout` síncrono com `child_process.spawnSync('sleep', ...)` no Linux/macOS como fallback não-bloqueante de ciclo de clock, ou um delay suave.

---

### [BUG-SIL-03] Doctor Regra 4 Não Valida Requisito Vinculado a ADR `superseded`
- **Módulo:** `src/commands/doctor.ts` (linhas 150-180)
- **Gravidade:** Baixa (Integridade Semântica)
- **Descrição:** A Regra 9 do doctor detecta quando um ADR *ativo* satisfaz um requisito *deprecated*. No entanto, a Regra 4 não avisa se um requisito *ativo* lista em `satisfied_by` um ADR que já foi marcado como `superseded` (ou seja, a decisão que o satisfazia ficou obsoleta e nenhuma nova decisão ativa o substituiu).
- **Correção:** Na Regra 4 do `doctor.ts`, verificar se o ADR referenciado em `satisfied_by` possui `status === 'superseded'` e emitir um aviso informativo.

---

### [BUG-SIL-04] Sanitização de Títulos e Campos de Objetos não String no Parser
- **Módulo:** `src/update/parser.ts`
- **Gravidade:** Baixa (Robustez a Payload Inválido de IA)
- **Descrição:** Se uma IA alucinada gerar um objeto aninhado em vez de string em um campo que espera texto (por exemplo, `title: { text: "Minha Decisão" }`), `String(d.title)` se tornará `"[object Object]"`.
- **Correção:** Validar explicitamente se o valor é string antes de chamar `.trim()` ou extrair propriedades se for objeto plano.

---

## 3. 🛡️ OPORTUNIDADES DE REFINAMENTO & HARDENING

### [HARD-01] Heartbeat Dinâmico no `ContextLock`
- **Cenário:** Em mutações extremamente grandes (lotes com 20 ADRs + 20 Requisitos + I/O de disco lento), se a escrita demorar mais de 30 segundos, outro processo pode considerar o lock abandonado por timeout de mtime.
- **Hardening:** Implementar um timer interno `setInterval` de 5 segundos que atualize o campo `heartbeatAt` no arquivo de lock durante todo o período em que o lock for mantido, limpando o timer no `release()`.

### [HARD-02] Bounds em `composeContext` para Projetos Massivos
- **Cenário:** Projetos com centenas de ADRs acumulados ao longo de meses podem gerar um contexto de 100KB+ tokens no `pactx pack`.
- **Hardening:**
  - Adicionar resumo de itens concluídos antigos (manter apenas os últimos 20 no prompt, agrupando o restante).
  - Truncar lista de ADRs obsoletos (`superseded`) para apenas títulos e IDs.

### [HARD-03] Tombstone Permanente para Manifestos em Quarentena
- **Cenário:** Quando um manifesto corrompido é movido para `.pactx/quarantine/`, o diretório de transações perde o registro original.
- **Hardening:** Gravar um `TX-<hash>.tombstone.json` com `status: 'FAILED'` e referência ao arquivo movido para auditoria transparente.

---

## 4. 🚀 ROADMAP DE NOVAS FUNCIONALIDADES (v0.4.0 & Futuro)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PACT-X ROADMAP (2026)                          │
├───────────────────┬───────────────────┬────────────────────────────────┤
│      v0.4.0       │      v0.5.0       │             v1.0.0             │
│ (MCP & Extensões) │ (Visual & Multi)  │       (Enterprise Ready)       │
├───────────────────┼───────────────────┼────────────────────────────────┤
│ • MCP Server StdIO│ • Graph Visualizer│ • Multi-Agent Namespaces       │
│ • Git Hooks Native│ • pactx compact   │ • Git-Blame AI Attribution     │
│ • pactx validate  │ • Mermaid Export  │ • Criptografia de Segredos     │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

---

### 4.1. Marco v0.4.0: Suporte Nativo ao Model Context Protocol (MCP Server)
O PactX foi concebido para o ciclo fechado de memória cognitiva com IA. Integrar nativamente o padrão aberto **MCP (Model Context Protocol)** permitirá que qualquer assistente (Claude Desktop, Cursor, Roo Code, Gemini Code Assist, Continue) consuma e altere o contexto diretamente via RPC sem depender de copiar/colar do clipboard.

#### Ferramentas MCP a Expor:
1. `pactx_get_context`: Retorna o contexto canônico empacotado (equivalente a `pactx pack --stdout`).
2. `pactx_apply_update`: Ingesta e aplica o bloco `pactx-update` de forma transacional (equivalente a `pactx update --yes`).
3. `pactx_inspect_diff`: Simula a mutação e retorna o plano de modificações em JSON estruturado.
4. `pactx_get_status`: Retorna métricas de saúde, objetivos ativos e satisfação de requisitos.
5. `pactx_diagnose_doctor`: Executa os 9 diagnósticos de integridade e retorna o relatório.
6. `pactx_rollback_transaction`: Reverte a última transação de forma segura.

---

### 4.2. Marco v0.4.1: Git Hooks Integrados (`pactx hook`)
Automação de ciclo de vida no fluxo de trabalho de desenvolvedores humanos:
- `pactx hook install`: Instala hooks em `.git/hooks/`.
- **Pre-commit:** Executa `pactx doctor` silenciosamente e impede commit se houver violação de integridade ou transação em estado de falha pendente.
- **Post-commit:** Registra o hash do commit do Git no `ledger.json` da transação correspondente.

---

### 4.3. Marco v0.5.0: Exportador Visual de Grafo & Auto-Compactação

#### `pactx graph` (Exportação Mermaid & SVG)
- Geração de diagrama de linhagem cognitiva mostrando:
  - Requisitos (`REQ-xxx`) $\to$ ADRs ativos (`DEC-xxx`) $\to$ ADRs obsoletos substituídos.
  - Fatos estabelecidos e hipóteses refutadas vinculadas aos requisitos.
  - Exportação direta para Mermaid Markdown ou visualização interativa no navegador.

#### `pactx compact` (Higienização e Arquivamento de Memória)
- Conforme o projeto cresce, arquivar automaticamente:
  - ADRs obsoletos há mais de 60 dias para `.ai-context/archive/decisions/`.
  - Itens de tarefas concluídas com mais de 3 sprints de idade para `.ai-context/archive/history.md`.
  - Preservação total de links de rastreabilidade, mantendo o prompt do dia-a-dia com consumo ultrabaixo de tokens.

---

### 4.4. Marco v1.0.0: Multi-Agent Namespaces & Auditoria Criptográfica

#### Multi-Agent Topics / Sub-Contexts
- Suporte a múltiplos tópicos ou agentes trabalhando em paralelo no mesmo repositório:
  - `pactx pack --topic frontend` / `pactx pack --topic database`.
  - Sub-estados particionados com sincronização em lock global.

#### Atribuição de IA e Criptografia
- Assinatura criptográfica de mutações com chave do desenvolvedor.
- Registro estrito do modelo de IA gerador (`claude-3-7-sonnet`, `gemini-2.5-pro`, `gpt-4o`) no histórico do Git.

---

## 5. 📋 TABELA COMPARATIVA DE RISCO & MATURIDADE

| Vetor de Análise | Estado v0.3.0 | Estado v0.3.2 | Meta v0.4.0 |
|---|---|---|---|
| **Transacionalidade WAL** | Manifestos `APPLY` | Manifestos `APPLY` e `ROLLBACK` de 1ª classe | Tool RPC com rollback atômico |
| **Quarentena e Conflito** | Exclusão arbitrária | Quarentena `.corrupt` e checagem de `afterHash` | Tombstones rastreáveis |
| **Bloqueio de Falhas** | Não existia | `RECOVERY_REQUIRED` bloqueia update e rollback | Notificação proativa via MCP |
| **Sanitização de Input** | Parcial (tags fixas) | Universal (HTML/XML genérico + URLs) | Scanner heurístico semântico |
| **Concorrência** | Token básico | Token UUID + PID liveness (`kill(pid, 0)`) | Heartbeat intervalar dinâmico |
| **Contenção de Diretório** | Sobe até a raiz | Limite de Git Root ou 10 níveis max | Multi-workspace boundary |

---

## 6. 🏁 CONCLUSÃO & RECOMENDAÇÕES FINAIS

O PactX v0.3.2 é uma base técnica sólida, resiliente e madura. As fundações de Write-Ahead Logging, detecção de conflitos, sanitização e diagnósticos automatizados colocam o projeto em posição ideal para a transição para a **v0.4.0 (MCP Server)**.

### Próximos Passos Imediatos:
1. Corrigir o `.sort()` em `composeContext` (`src/composer.ts`).
2. Adicionar o pacote MCP Server (`@modelcontextprotocol/sdk`) e criar o ponto de entrada `src/mcp/server.ts`.
3. Criar a suite de testes e2e para clientes MCP (Cursor / Claude Desktop).
