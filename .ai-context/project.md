---
spec_version: "1.0"
project: "PactX"
version: "0.2.2"
stack: ["Node.js", "TypeScript", "Commander", "YAML", "Picocolors", "Clipboardy"]
---
# Project Vision
PactX é uma camada de continuidade para desenvolvimento com IA.

Ele mantém o estado persistente e canônico do projeto fora dos chats e permite sincronizá-lo entre diferentes IAs por meio de um loop fechado: contexto → IA → atualização → repositório.

Em uma frase:

PactX é a memória persistente e interoperável do seu projeto para IAs.

# Regras Invariantes
1. **Segurança Zero-Trust:** Todo payload de IA e input externo é considerado não confiável. Toda operação de sistema de arquivos deve impor isolamento de diretório (realpath), proteção anti-symlink, anti-hardlink e sanitização estrutural.
2. **Fail-Closed & Escritas Atômicas:** Mutações em disco devem sempre usar o padrão Escrita-em-Temp + Rename Atômico (`safeAtomicWriteFileSync`), com rollback em caso de erro ou interrupção do processo (`SIGINT`/`SIGTERM`/`SIGHUP`).
3. **Semântica de Patch:** Atualizações parciais de estado NUNCA devem apagar seções, campos não mencionados, ou seções customizadas do usuário no `state.md`.
4. **Zero Dependências Pesadas:** Manter o CLI principal leve, rápido (<50ms de execução) e portável (Node >= 18).
5. **Cobertura de Testes:** Toda nova funcionalidade, correção de bug ou edge case deve incluir testes de regressão automatizados em `test/`.
6. **Padrão English-First:** Todos os logs do CLI, mensagens de erro, templates de scaffolding e prompts padrão devem permanecer em inglês por padrão.
