# Revisão Técnica Arquitetural — RFC-002
**Revisor:** Principal Distributed Systems & Security Architect  
**Documento:** [especificacao-RFC-002.md](file:///home/thales/Projetos/ctxpack/docs/RFC/especificacao-RFC-002.md)  
**Codebase de Referência:** PactX v0.2.2 (pós-fix Anti-TOCTOU)  
**Data:** 2026-08-25

---

## 1. 🔍 AVALIAÇÃO CRÍTICA GERAL

### O que está conceitualmente excelente e pronto para produção

**1.1 A máquina de estados do TransactionEngine é conceitualmente sólida.**  
O ciclo `PREPARED → APPLYING → COMMITTED / ROLLED_BACK` é a aplicação clássica correta de Write-Ahead Logging para single-node. A decisão de gravar **todo o snapshot dos arquivos canônicos** *antes* de iniciar qualquer mutação é a abordagem correta — é efetivamente um *undo log* completo, que é mais simples e mais confiável do que um *redo log* para este caso de uso (poucas dezenas de KB de dados, operações não-concorrentes sob lock exclusivo).

**1.2 A separação `.pactx/` para runtime interno é uma decisão excelente de higiene.**  
Segregar o diretório de máquina (ledger, transactions, lock) do conteúdo legível por humanos elimina classe inteira de bugs onde ferramentas de diff/grep acidentalmente incluem metadados internos. A estrutura é intuitiva e ergonômica.

**1.3 A migração transparente v0.2.x → v0.3.0 é elegante.**  
A estratégia de verificar a presença do layout legado no boot e realizar migração atômica sem intervenção humana é o padrão correto. A preservação de 100% do histórico de idempotência é fundamental.

**1.4 O modelo Requirement→Decision→Task→Facts é uma ontologia limpa.**  
A separação entre o *quê* (Requirement) e o *como* (Decision/ADR) preenche uma lacuna real do v0.2.x. A relação `satisfies` cria rastreabilidade bidirecional que agrega valor concreto para governança.

**1.5 A suíte de governança (status, doctor, diff, rollback) é bem dimensionada.**  
As 8 regras do `doctor` cobrem os invariantes estruturais relevantes. O `diff` pré-visualização e o `rollback` transacional são as ferramentas que faltavam para tornar o sistema apto para uso profissional contínuo.

**1.6 O Rollback-como-Transação-WAL é a decisão correta.**  
Executar a operação de rollback dentro do próprio TransactionEngine (`PREPARED → APPLYING → COMMITTED`) elimina a classe de bugs "crash-during-rollback" que é infame em sistemas de recuperação. Isso garante que um `SIGKILL` durante o rollback será auto-recuperado no próximo boot.

---

## 2. 🛠️ O QUE MUDAR NA ESPECIFICAÇÃO

### 2.1 CRÍTICO: Janela de vulnerabilidade do manifesto TX no `SIGKILL`

> [!CAUTION]
> **Brecha identificada:** A RFC descreve que o manifesto `TX-<hash>.json` é gravado com status `PREPARED`, depois atualizado para `APPLYING`, e finalmente para `COMMITTED`. Mas **a gravação do próprio manifesto TX é uma operação de I/O**. Se o processo receber `SIGKILL` exatamente durante a *primeira escrita* do manifesto (estado `PREPARED`), o arquivo JSON pode ser gravado de forma parcial/corrompida no disco.

**Cenário de ataque:**
1. `TransactionEngine` inicia `writeFileSync(txPath, manifestoPREPARED)`.
2. O kernel agenda a escrita mas o buffer ainda não foi `fsync()`'d.
3. `SIGKILL` termina o processo.
4. O FS journal pode ter gravado parcialmente o JSON do manifesto.
5. No próximo boot, auto-recovery encontra um `TX-xxx.json` corrompido (JSON inválido) e falha ao parsear.

**Correção necessária na especificação:**

```diff
 ### 3.1 Estados da Transação
 * **`PREPARED`:** O arquivo `.ai-context/.pactx/transactions/TX-<hash>.json`
-  é gravado contendo o plano de mutação e o snapshot.
+  é gravado atomicamente (write-to-temp + rename) contendo o plano de mutação
+  e o snapshot. A auto-recovery DEVE tratar JSON corrompido/parcial como
+  "transação que nunca chegou a PREPARED" e deletar o manifesto sem restaurar
+  snapshot (pois nenhuma mutação ocorreu).
```

Adicionalmente, cada transição de status (`PREPARED→APPLYING`, `APPLYING→COMMITTED`) deve usar a mesma primitiva `safeAtomicWriteFileSync` já existente no codebase. A especificação deve declarar isso explicitamente.

---

### 2.2 IMPORTANTE: `requirements.md` em Markdown é frágil para parsing programático

> [!WARNING]
> O formato proposto para `requirements.md` usa headings Markdown (`### [REQ-001]`) com bullet points para campos (`- **Status:** active`). Este formato é **inerentemente frágil** para parsing programático por três razões:

1. **Ambiguidade de parsing:** A regex para extrair `- **Status:** active` vai falhar se o usuário editar manualmente e escrever `- **Status**: active` (dois pontos fora do bold), `- Status: active` (sem bold), ou `**Status:** Active` (capitalização).

2. **Inconsistência com o precedente:** Os ADRs (`decisions/DEC-xxx.md`) usam **YAML frontmatter** para metadados estruturados, que é imune a variações de formatação. Requirements usa Markdown inline, criando uma inconsistência de design.

3. **Escalabilidade:** Com >20 requisitos, um arquivo Markdown monolítico se torna difícil de navegar e o parser de seções fica exponencialmente mais frágil.

**Correção recomendada — duas opções:**

| Opção | Formato | Prós | Contras |
|-------|---------|------|---------|
| **A (Recomendada)** | Arquivo único `requirements.md` com YAML frontmatter + corpo Markdown | Consistente com ADRs, parsing robusto, humano-legível | Arquivo monolítico (aceitável para <100 REQs) |
| **B** | Diretório `requirements/REQ-001.md`, `REQ-002.md` (espelha `decisions/`) | Escalável, cada REQ isolado, diffs granulares | Mais churn de arquivos, mais complexo |

Para a Opção A, o formato sugerido seria:

```markdown
---
spec_version: "1.0"
requirements:
  - id: "REQ-001"
    status: active
    type: security
    satisfiedBy: ["DEC-002"]
  - id: "REQ-002"
    status: active
    type: functional
    satisfiedBy: ["DEC-003"]
---

### [REQ-001] Multi-tenant Data Isolation
O sistema deve isolar dados de alunos estritamente por escola para conformidade com a LGPD.

### [REQ-002] Student Simplified Authentication
Alunos do ensino fundamental devem conseguir se autenticar usando apenas Turma e PIN numérico.
```

Isso separa metadados estruturados (frontmatter YAML) do conteúdo narrativo (corpo Markdown), exatamente como os ADRs já fazem.

---

### 2.3 A auto-recovery precisa de um mecanismo anti-loop e limite de tentativas

> [!IMPORTANT]
> A Seção 3.2 descreve que no boot, o engine restaura qualquer transação `APPLYING` ou `PREPARED` órfã. Mas **não especifica o que acontece se a restauração falhar** (disco cheio, permissão negada, snapshot corrompido no manifesto TX).

**Cenário de loop infinito:**
1. Boot detecta TX em `APPLYING`.
2. Tenta restaurar snapshot → falha (ex: disco cheio).
3. TX permanece em `APPLYING`.
4. Próximo boot repete o ciclo infinitamente.

**Correção necessária:**

```markdown
### 3.2.1 Limite de Tentativas de Recovery
- Cada manifesto TX contém um contador `recovery_attempts: number`.
- A cada tentativa de auto-recovery, o contador é incrementado atomicamente.
- Se `recovery_attempts >= 3`, a transação é marcada como `FAILED` (novo estado terminal)
  e o `pactx doctor` reporta o erro como crítico exigindo intervenção manual.
- Transações `FAILED` NÃO são reprocessadas na auto-recovery automática.
```

---

### 2.4 O `ContextLock` deve migrar de `.pactx.lock` (raiz) para `.pactx/.pactx.lock`

A Seção 2.1 mostra o lockfile em `.ai-context/.pactx/.pactx.lock`, mas o código atual em [`lock.ts`](file:///home/thales/Projetos/ctxpack/src/update/lock.ts#L9) cria o lock em `path.join(contextDir, '.pactx.lock')` — ou seja, na **raiz** de `.ai-context/`. A RFC-002 precisa ser explícita sobre a migração do lockfile path, e o passo 2.2 (migração transparente) deve incluir a remoção do lock legado:

```diff
 2. Se `.ai-context/.pactx-history.json` existir...
    - Cria o diretório `.ai-context/.pactx/transactions/`.
    - Move `.ai-context/.pactx-history.json` para `.ai-context/.pactx/ledger.json`.
-   - Remove `.ai-context/.pactx.lock` legado (se existir).
+   - Remove `.ai-context/.pactx.lock` legado (se existir).
+   - Atualiza ContextLock para usar `.ai-context/.pactx/.pactx.lock` na v0.3.0.
```

Isso é coerente com a filosofia de segregar runtime interno em `.pactx/`.

---

### 2.5 A política de poda precisa de salvaguarda contra deleção de transações necessárias para rollback

A Seção 3.3 define: *"mantém os últimos 50 manifestos finalizados"* e *"transações >30 dias são podadas"*. Mas se o usuário quiser executar `pactx rollback <hash>` de uma transação de 35 dias atrás que já foi podada, o rollback falhará silenciosamente por falta de snapshot.

**Correção:** A especificação deve declarar que `pactx rollback <hash>` emite erro claro quando o manifesto TX foi podado:

```
Error: Transaction TX-<hash> was pruned (older than 30 days or exceeded the 50-transaction retention limit).
Rollback requires the original transaction journal with snapshot data.
Hint: Use 'pactx rollback' (without hash) to revert only the most recent transaction.
```

---

## 3. ➕ O QUE ACRESCENTAR

### 3.1 Checksums de integridade nos manifestos TX

O manifesto `TX-<hash>.json` armazena snapshots de arquivos canônicos, mas a RFC não especifica se esses snapshots são verificados contra bit-rot ou corrupção silenciosa. Adicionar:

```typescript
interface TransactionManifest {
  txHash: string;
  status: 'PREPARED' | 'APPLYING' | 'COMMITTED' | 'ROLLED_BACK' | 'FAILED';
  recovery_attempts: number;
  createdAt: string;
  snapshot: Array<{
    path: string;
    contentHash: string;   // SHA-256 do conteúdo original
    content: string;       // Conteúdo para restauração
  }>;
  createdFiles: string[];  // Arquivos novos para deletar no rollback
  plan: MutationPlan;
}
```

Na auto-recovery, antes de restaurar, verificar `SHA-256(content) === contentHash`. Se divergir, marcar como `FAILED`.

---

### 3.2 Validação de referência cruzada `satisfies` no planner

A RFC introduz `satisfies: ["REQ-001"]` nos ADRs, mas **não especifica quando essa referência é validada**. Há três momentos possíveis:

| Momento | Prós | Contras |
|---------|------|---------|
| Parser (ingestão) | Fail-fast | Pode rejeitar payloads válidos se o REQ for criado no mesmo lote |
| Planner | Pode validar lote completo | Mais complexidade |
| Doctor (pós-facto) | Não bloqueia o fluxo | Permite referências inválidas temporariamente |

**Recomendação:** Validar no **planner** com tolerância intra-lote. Se `satisfies` referencia um `REQ-xxx` que está sendo criado no mesmo payload (`new_requirements`), aceitar. Se referencia um `REQ-xxx` que não existe no disco nem no lote, emitir **warning** (não erro), pois o Requirement pode ser adicionado manualmente pelo humano depois.

---

### 3.3 Definir explicitamente o comportamento de `source.type` para v1.0

A RFC-002 expande o campo `source` para incluir `type: 'conversation' | 'agent' | 'manual' | 'document'`. Mas o schema v1.0 atual não tem esse campo. A especificação deve declarar:

```markdown
Ao receber um payload `version: "1.0"` sem `source.type`, o engine assume
`type: 'conversation'` como default implícito para retrocompatibilidade.
```

---

### 3.4 Adicionar `new_requirements` ao schema `RawUpdatePayload` v1.1

A RFC mostra `new_requirements` no exemplo do payload v1.1 (Seção 7), mas o [`RawUpdatePayload`](file:///home/thales/Projetos/ctxpack/src/update/types.ts#L1-L32) atual não tem esse campo. A especificação deve incluir a interface TypeScript completa:

```typescript
new_requirements?: Array<{
    id?: string;           // 'auto' gera REQ-XXX sequencial
    type: 'functional' | 'security' | 'performance' | 'compliance';
    title: string;
    statement: string;
}>;
```

E os ADRs no `new_decisions` precisam do campo opcional:
```typescript
new_decisions?: Array<{
    id?: string;
    title: string;
    reason: string;
    decision: string;
    satisfies?: string[];  // ex: ["REQ-001", "REQ-003"]
}>;
```

---

### 3.5 Especificar a semântica de `--force-cascade` no rollback de transação intermediária

A Seção 6.4 menciona `--force-cascade` mas não define sua semântica. Deve-se acrescentar:

```markdown
#### 6.4.1 Semântica de `--force-cascade`
Quando `pactx rollback <hash> --force-cascade` é executado:
1. A análise de grafo identifica todas as transações posteriores que dependem de
   entidades criadas na transação alvo.
2. As transações dependentes são revertidas em ordem LIFO (da mais recente para
   a mais antiga), cada uma como uma sub-transação WAL.
3. Por último, a transação alvo é revertida.
4. Todas as sub-reversões são registradas como entradas individuais no ledger.
5. Se qualquer sub-reversão falhar, o cascade é abortado e o estado é restaurado
   ao ponto antes do início do cascade (rollback do rollback).
```

---

### 3.6 Tratamento de conflitos na migração quando ambos os layouts coexistem

A Seção 2.2 assume que `.pactx-history.json` e `.pactx/ledger.json` são mutuamente exclusivos. Mas é possível que um usuário faça downgrade para v0.2.x, aplique mutações (gravando em `.pactx-history.json`), e depois volte para v0.3.0. Nesse cenário, ambos os arquivos existiriam com entradas diferentes.

**Acrescentar:**
```markdown
### 2.2.1 Resolução de Conflito de Layout Duplo
Se AMBOS `.pactx-history.json` e `.pactx/ledger.json` existirem:
1. Fazer merge deduplicado por `hash` (union dos applied_updates de ambos).
2. Ordenar cronologicamente por `applied_at`.
3. Gravar o resultado unificado em `.pactx/ledger.json`.
4. Remover `.pactx-history.json`.
5. Emitir warning no terminal sobre a detecção do conflito de layout.
```

---

## 4. 🏁 VEREDITO DE IMPLEMENTAÇÃO

### ✅ APROVADO COM RESSALVAS

A RFC-002 é uma especificação de alta qualidade que eleva o PactX de ferramenta utilitária para motor transacional de nível profissional. A ontologia de conhecimento, o modelo WAL, a suíte de governança e a estratégia de retrocompatibilidade demonstram maturidade arquitetural significativa.

**Classificação das ressalvas por severidade:**

| # | Severidade | Item | Seção |
|---|-----------|------|-------|
| 1 | 🔴 **Bloqueante** | Escrita atômica do manifesto TX + tratamento de JSON corrompido na recovery | §2.1 |
| 2 | 🔴 **Bloqueante** | Anti-loop na auto-recovery (counter + estado `FAILED`) | §2.3 |
| 3 | 🟡 **Alta** | Migrar `requirements.md` para YAML frontmatter (ou justificar a escolha de Markdown puro) | §2.2 |
| 4 | 🟡 **Alta** | Definir semântica completa de `--force-cascade` | §3.5 |
| 5 | 🟡 **Alta** | Acrescentar `new_requirements` e `satisfies` ao `RawUpdatePayload` v1.1 | §3.4 |
| 6 | 🟢 **Média** | Checksums de integridade nos snapshots do manifesto TX | §3.1 |
| 7 | 🟢 **Média** | Erro explícito quando manifesto podado impede rollback | §2.5 |
| 8 | 🟢 **Média** | Resolução de conflito de layout duplo (downgrade+upgrade) | §3.6 |
| 9 | 🔵 **Baixa** | Default `source.type = 'conversation'` para v1.0 | §3.3 |
| 10 | 🔵 **Baixa** | Migração explícita do lockfile path | §2.4 |

> [!IMPORTANT]
> **Recomendação:** Resolver os 2 itens 🔴 bloqueantes (escrita atômica do manifesto TX e anti-loop de recovery) **antes** de iniciar a implementação. Os itens 🟡 podem ser resolvidos durante a implementação com PR de refinamento. Os itens 🟢 e 🔵 podem ser endereçados como follow-ups antes do release final v0.3.0.

**Nota positiva final:** A base de código existente (v0.2.2 pós-fix Anti-TOCTOU) demonstra que a equipe já internaliza os padrões de escrita atômica (`safeAtomicWriteFileSync`), lock exclusivo (`ContextLock`), e resolução sob seção crítica — os mesmos padrões que o TransactionEngine da RFC-002 exige. A distância de implementação entre o código atual e a especificação é curta e bem mapeada.
