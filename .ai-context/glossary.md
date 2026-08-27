# Glossário & Contratos Canônicos — PactX

Este documento define os termos de domínio, entidades de arquitetura, garantias de integridade e contratos semânticos fundamentais do PactX.

---

## 1. Fundamentos de Memória e Ciclo de Vida

- **Estado Canônico (*Canonical State*)**: A verdade persistente, formal e verificada do projeto, armazenada em arquivos legíveis na pasta `.ai-context/` e versionada estritamente via Git.
- **Estado Candidato (*Candidate State*)**: Propostas de mutação não verificadas emitidas por LLMs ou agentes (ex: blocos `pactx-update` ou chamadas MCP), tratadas como dados não confiáveis (*Zero-Trust*) até serem validadas e aprovadas.
- **Egress (`pactx pack`)**: O processo de inspecionar o runtime do Git, requisitos e decisões ativas para compor um pacote de contexto otimizado em tokens (~400t) copiado para a Área de Transferência.
- **Ingress (`pactx update`)**: O processo de ingestão, validação de segurança, revisão humana em texto integral e persistência transacional atômica de propostas de mutação no repositório.
- **Conhecimento Negativo (*Negative Knowledge*)**: Registro formal e explícito de hipóteses testadas e comprovadamente falsas (o que NÃO fazer), impedindo que IAs futuras repitam erros e abordagens já descartadas.
- **Semântica de Patch (*Patch Semantics*)**: A regra inviolável de que atualizações parciais em `state.md` ou `requirements.md` modificam apenas os campos explicitamente enviados, preservando 100% dos dados omitidos e seções customizadas do usuário.
- **Postura *Fail-Closed***: Filosofia de segurança padrão do sistema onde qualquer ambiguidade, corrupção de schema, link quebrado ou erro de I/O aborta a operação inteira com rollback imediato, impedindo estados parciais ou inconsistentes.

---

## 2. Motor Transacional & Concorrência (WAL Engine)

- **TransactionEngine (WAL — *Write-Ahead Logging*)**: O motor de persistência que orquestra mutações através de uma máquina de estados durável gravada em disco antes da alteração dos arquivos canônicos.
- **Estados da Transação**:
  - `PREPARED`: Manifesto `TX-<hash>.json` gravado atomicamente em disco com os snapshots originais e checksums SHA-256 de pre-flight.
  - `APPLYING`: Transição indicando que as escritas atômicas nos arquivos canônicos estão em andamento no disco.
  - `COMMITTED`: Mutações em disco concluídas com sucesso e entrada consolidada no `ledger.json`.
  - `ROLLED_BACK`: Transação revertida com restauração do snapshot (via `pactx rollback` ou auto-recovery).
  - `RECOVERY_REQUIRED`: Estado de trava de segurança indicando transação órfã em conflito que bloqueia novas mutações até intervenção do `pactx doctor`.
  - `FAILED`: Estado terminal indicando esgotamento do limite anti-loop de recuperação.
- **Auto-Recovery no Boot**: Rotina executada na inicialização de qualquer comando sob `ContextLock`, inspecionando transações órfãs (`PREPARED`/`APPLYING`) deixadas por crashes (`kill -9` ou queda de energia) e restaurando o repositório automaticamente.
- **Trava de Contexto (*ContextLock*)**: Lock de arquivo atômico (`.ai-context/.pactx/.pactx.lock`) criado com flag exclusiva `wx`, associado a um token UUID v4 e validação de vivacidade de processo (`process.kill(pid, 0)`), impedindo condições de corrida entre processos paralelos.
- **Escrita Atômica (*Safe Atomic Write*)**: Padrão de persistência (`safeAtomicWriteFileSync`) que grava em arquivos temporários ocultos (`.*.tmp`) no mesmo volume e realiza a substituição atômica no nível do SO (`fs.renameSync`), com verificação prévia anti-symlink e anti-hardlink.
- **Quarentena (`.pactx/quarantine/`)**: Diretório seguro onde manifestos TX com JSON corrompido são isolados para preservar evidências forenses sem deletar histórico.
- **Poda de Transações (*Pruning*)**: Rotina executada sob lock que remove manifestos finalizados antigos (>50 transações ou >30 dias) mantendo o ledger cronológico intacto.

---

## 3. Modelo de Conhecimento & Grafos de Decisão

- **Entidade Requisito (*Requirement*)**: Representação formal do *Espaço do Problema* (regras de negócio, restrições funcionais e de segurança) armazenada em `requirements.md` com YAML frontmatter e corpo Markdown.
- **Registro de Decisão Arquitetural (*ADR*)**: Representação formal do *Espaço da Solução* (como o problema foi resolvido tecnicamente) armazenada em `decisions/DEC-%03d.md` com numeração sequencial atômica.
- **Vínculo `satisfies` ⇄ `satisfied_by`**: Relação bidirecional estrita onde um ADR ativo declara quais requisitos ele atende (`satisfies: ["REQ-001"]`), refletida sincronizadamente no campo `satisfied_by` de `requirements.md`.
- **Linhagem Estrutural (*`superseded_by`*)**: Relação de substituição histórica onde um ADR obsoleto aponta formalmente para o novo ADR ativo que o substituiu, mantendo a árvore genealógica de decisões intacta.
- **Rollback *Graph-Safe***: Mecanismo de reversão que inspeciona o grafo de dependências posteriores antes de desfazer uma transação antiga, impedindo que ADRs ou requisitos ativos fiquem com referências órfãs.

---

## 4. Hashing, Integridade & Rastreabilidade

- **Hash Canônico (*Canonical Hash*)**: Digest SHA-256 calculado sobre o payload `pactx-update` normalizado (chaves ordenadas, Unicode NFC e quebras de linha `\n`), utilizado como chave estrita de idempotência no `ledger.json`.
- **Hash de Revisão Canônica (*`base_revision`*)**: Digest SHA-256 de 16 caracteres calculado sobre a composição canônica estruturada de todo o repositório (`project`, `state`, `requirements`, `glossary`, `decisions`), utilizado para detectar concorrência otimista (OCC) e alertar sobre contexto desatualizado (*Stale Context*).
- **Proveniência (*`source`*)**: Metadados tipados (`type: conversation | agent | manual | document`, `model`, `sessionTopic`, `txHash`, `appliedAt`) que registram a cadeia de custódia e autoria de cada mutação.
- **Spans de Evidência (*Evidence Spans*)**: Anotações geradas pelo extrator referenciando o número do turno e a citação literal do transcript (`evidence: { turn, quote }`) que comprovam a origem de cada decisão.

---

## 5. Inteligência de Sessão & Telemetria (v0.4.0)

- **Micro-Âncoras em Tempo Real (*In-Flight Micro-Anchors*)**: Comentários HTML estruturados com JSON (`<!-- pactx:v1 type payload -->`) emitidos pela IA durante a conversa no milissegundo em que uma decisão é tomada, invisíveis na renderização web do Markdown.
- **Diretiva `/remember`**: Comando prefixado pelo desenvolvedor no chat (`/remember decision: ...`, `/remember reject: ...`, `/remember fact: ...`) forçando a captura determinística de informações na memória da sessão.
- **Extrator Fora da Banda (*Out-of-Band Extractor*)**: Mecanismo (`pactx extract`) que processa transcripts brutos (Claude, ChatGPT, Cursor, Raw) em duas fases: extração determinística local (offline / $0.00) seguida de consolidação semântica opcional com modelos limpos.
- **Telemetria de Context Health**: Métrica composta de risco operacional baseada em saturação da janela útil ($\text{Tokens} / (\text{Window} - \text{Reserved})$), idade da sessão e volume de diffs, classificada em 5 zonas (`SAFE`, `WATCH`, `CAUTION`, `WARNING`, `CRITICAL`).
- **Nível de Confiança de Telemetria**: Classificação explícita da precisão de tokens (`EXACT` via API, `ESTIMATED` via cálculo ponderado de caracteres ou `UNKNOWN` para interfaces sem dados).
- **Storage de Sessão Efêmero (`.pactx/sessions/`)**: Armazenamento local de rascunhos (`anchors.jsonl`, `current.json`, `proposals/`) mantido estritamente no `.gitignore` para proteger segredos e dados transitórios.
- **Proposta Desacoplada (*`proposalId`*)**: Fluxo de segurança onde ferramentas MCP geram planos em `.pactx/sessions/proposals/PROP-<hash>.json` e exigem confirmação explícita do desenvolvedor (`pactx update --proposal <id>`) antes da gravação no Git.
- **Servidor MCP (*Model Context Protocol*)**: Servidor nativo sobre `stdio` (`pactx serve --mcp`) expondo resources (`context`, `health`, `status`) e tools (`record_anchor`, `get_context_health`, `propose_mutation`, `apply_mutation`) para agentes como Cursor, Claude Desktop e Windsurf.