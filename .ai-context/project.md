---
spec_version: "1.0"
project: "PactX"
version: "0.4.0"
stack: ["Node.js", "TypeScript", "Commander", "YAML", "Picocolors", "Clipboardy", "@modelcontextprotocol/sdk"]
---
# Visão do Projeto
O PactX é um motor de continuidade de contexto em loop fechado e persistência canônica de estado para desenvolvimento de software assistido por IA.

Ele desacopla a memória durável do projeto da janela de contexto volátil das IAs, operando como uma ponte bidirecional entre o repositório Git e qualquer modelo ou agente (ChatGPT, Claude, Gemini, Cursor, Windsurf):
1. **Egress (`pack`):** Inspeciona o estado do Git, requisitos e decisões ativas, gerando um Context Pack compacto em Markdown para a IA.
2. **Ingress (`update`):** Ingesta propostas estruturadas (`pactx-update`), validando segurança e persistindo mutações atomicamente com semântica de Patch.
3. **Session Intelligence:** Oferece telemetria de saturação de contexto em tempo real, captura contínua de micro-âncoras e extração fora da banda (`extract`).
4. **Governança & MCP:** Fornece suíte completa de ferramentas (`status`, `doctor`, `diff`, `rollback`) e servidor MCP nativo sobre `stdio` (`serve --mcp`).

Em uma frase:
> **PactX é a camada de inteligência de sessão e memória persistente, transacional e interoperável do seu projeto para IAs.**

---

# Regras Invariantes (Invariants)

1. **Segurança Zero-Trust & Filesystem Jail:** Todo payload externo (saídas de LLMs, transcripts de chat, flags de CLI) é estritamente não confiável. Toda escrita deve validar contenção física no repositório (`fs.realpathSync.native`), bloquear links simbólicos e hardlinks (`stat.isSymbolicLink()`, `stat.nlink > 1`), neutralizar injeções de tags e cabeçalhos (`sanitizeBodyField`) e utilizar regexes lineares imunes a ReDoS.
2. **Transacionalidade WAL & Fail-Closed:** Nenhuma mutação canônica é aplicada diretamente. Toda alteração passa pelo `TransactionEngine` com Write-Ahead Logging (`PREPARED` ➔ `APPLYING` ➔ `COMMITTED` / `ROLLED_BACK`), utilizando escritas atômicas (*Write-to-Temp + Rename*) e auto-recuperação no boot protegida por `ContextLock` com token UUID exclusivo.
3. **Semântica de Patch Incremental:** Mutações parciais em `state.md` ou `requirements.md` NUNCA devem apagar campos não mencionados, regras de negócio preexistentes ou seções customizadas criadas manualmente pelo desenvolvedor.
4. **Desacoplamento e Aprovação Humana (Human-in-the-Loop):** Toda proposta de mutação gerada por IAs ou agentes (via CLI, Extrator ou servidor MCP) gera propostas auditáveis (`proposalId`) e exige validação explícita antes do commit definitivo no disco.
5. **Zero Dependências Pesadas & Chamadas Nativas:** Manter o binário do CLI ultrarrápido (<50ms via lazy loading de subcomandos) e portável (Node >= 18). Chamadas de IA no extrator devem usar `fetch` nativo sem inclusão de SDKs pesados no core.
6. **Privacidade e Isolamento de Sessão:** O diretório efêmero `.ai-context/.pactx/sessions/` deve permanecer obrigatoriamente no `.gitignore` para impedir que logs de chat, variáveis de ambiente ou dados sensíveis sejam commitados no Git.
7. **Rigor e Cobertura de Testes:** Nenhuma funcionalidade, comando, regra de integridade ou edge case vai para produção sem testes unitários e de integração automatizados em `test/` cobrindo cenários válidos, falhas de I/O e ataques adversariais.
8. **Padrão English-First no Runtime:** Todos os logs de terminal da CLI, mensagens de erro, templates de scaffolding e prompts de egress devem permanecer em inglês por padrão para garantir interoperabilidade global.