---
spec_version: "1.0"
sprint: "SPRINT_RELEASE_0.4.0"
active_task: "TASK-01 Validação de MCP em IDEs e Divulgação da v0.4.0"
recommended_model: "Medium"
status: "IN_PROGRESS"
---
# Objetivo Atual
Homologar a integração do servidor MCP nativo (`pactx serve --mcp`) em IDEs e agentes (Cursor, Claude Desktop e Windsurf), consolidar a documentação de telemetria e micro-âncoras, e conduzir a divulgação comunitária da release v0.4.0.

# O que foi feito recentemente
- [x] Implementação do motor inicial de empacotamento de contexto (v0.1.0).
- [x] Ingestão em loop fechado via `pactx update` com validação Zero-Trust e aprovação humana (v0.2.0 / v0.2.2).
- [x] Implementação do `TransactionEngine` com Write-Ahead Logging (WAL), estados duráveis (`PREPARED`, `APPLYING`, `COMMITTED`, `ROLLED_BACK`) e auto-recuperação no boot (v0.3.0).
- [x] Criação da entidade canônica `Requirement` (`requirements.md`), semântica de Patch incremental e suíte de governança (`status`, `doctor`, `diff`, `rollback`) (v0.3.0).
- [x] Resolução da condição de corrida TOCTOU na alocação sequencial de IDs de ADR sob `ContextLock` exclusivo (v0.3.2).
- [x] Implementação do Servidor MCP nativo (`pactx serve --mcp`) sobre transporte `stdio` com Resources e Tools desacopladas por `proposalId` (v0.4.0).
- [x] Extrator Fora da Banda (`pactx extract`) em duas fases: determinística local offline + semântica com modelo limpo e *Evidence Spans* (v0.4.0).
- [x] Módulo de telemetria e Context Health (`pactx status --telemetry`) com cálculo ponderado de tokens e barra visual de saturação ANSI (v0.4.0).
- [x] Protocolo de micro-âncoras em tempo real `<!-- pactx:v1 -->` e suporte à diretiva `/remember` no `composer.ts` (v0.4.0).
- [x] Suíte de testes automatizados expandida para 134/134 testes passando com 100% de sucesso e build limpo (v0.4.0).

# Fatos & Descobertas
- Em servidores MCP sobre transporte `stdio`, o `stdout` é reservado exclusivamente para o protocolo JSON-RPC; qualquer log ou mensagem operacional deve ser direcionada estritamente para o `stderr` para evitar corrupção de pacotes.
- O cálculo ponderado de tokens (código a ~3 chars/token e prosa a ~4 chars/token com +15% de margem) fornece estimativas locais consistentes com zero dependências de tokenizadores externos pesados.
- A extração determinística local (varrendo micro-âncoras, comandos `/remember`, diffs do Git e anotações no código) captura a maior parte do estado de uma sessão com custo financeiro zero e sem dependência de rede.
- O diretório efêmero `.ai-context/.pactx/sessions/` deve permanecer obrigatoriamente no `.gitignore` para proteger transcrições de chat, variáveis de ambiente e dados privados.
- O `ContextLock` exige token de posse exclusivo (UUID v4) e checagem de vivacidade de PID (`process.kill(pid, 0)`) para impedir que processos concorrentes roubem travas ativas.

# Hipóteses Descartadas / Erros Conhecidos (NÃO REPETIR)
- O `/handoff` manual no final de chats longos (30+ mensagens) NÃO deve ser a única fonte de verdade; micro-âncoras contínuas e extração fora da banda eliminam a amnésia e o efeito *Lost in the Middle*.
- O rollback de transações NÃO pode ser executado como um script auxiliar efêmero; ele deve ser uma transação WAL de primeira classe (`type: 'ROLLBACK'`) com snapshots e rollback de ledger atômicos.
- `stateUpdate` e `requirements` NÃO podem ser modelados como snapshots substitutivos; a semântica de Patch incremental é mandatória para evitar a destruição de campos omitidos ou seções manuais do usuário.
- O auto-recovery NÃO deve deletar manifestos de transação corrompidos; manifestos com falha devem ser isolados em quarentena (`.pactx/quarantine/`) sob a trava `RECOVERY_REQUIRED`.
- O `pactx rollback <hash>` NÃO deve permitir reversões de transações intermediárias antigas caso existam decisões posteriores dependendo daquele lote, a menos que `--force-cascade` seja explicitamente invocado.

# Próxima Ação Imediata
Configurar e testar o servidor MCP (`pactx serve --mcp`) no arquivo `.cursor/mcp.json` do Cursor e no Claude Desktop, validando a chamada das tools `pactx_record_anchor` e `pactx_propose_mutation` em uma sessão de desenvolvimento assistido.