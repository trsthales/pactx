import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

export function initProject(cwd: string = process.cwd()): void {
    const contextDir = path.join(cwd, '.ai-context');
    const decisionsDir = path.join(contextDir, 'decisions');

    if (fs.existsSync(contextDir)) {
        console.log(pc.yellow('⚠ .ai-context já existe neste diretório.'));
        return;
    }

    fs.mkdirSync(decisionsDir, { recursive: true });

    fs.writeFileSync(
        path.join(contextDir, 'project.md'),
        `---
spec_version: "1.0"
project: "Nome do Projeto"
version: "0.1.0"
stack: ["Node.js", "TypeScript", "PostgreSQL"]
---
# Visão do Projeto
Descreva brevemente o objetivo do sistema.

# Regras Invioláveis
1. Todo código novo deve conter testes de unidade.
2. Nunca assuma causas de bugs sem evidências no runtime.
`
    );

    fs.writeFileSync(
        path.join(contextDir, 'state.md'),
        `---
spec_version: "1.0"
sprint: "SPRINT_01"
active_task: "TASK-01"
recommended_model: "Medium"
status: "IN_PROGRESS"
---
# Objetivo Atual
Configuração da arquitetura base e validações.

# O que foi feito recentemente
- [x] Inicialização do repositório.

# Hipóteses Descartadas / Erros Conhecidos (NÃO REPETIR)
- (Registre aqui o que você testou e não funcionou para a IA não tentar de novo)

# Próxima Ação Imediata
Iniciar implementação do módulo principal.
`
    );

    fs.writeFileSync(
        path.join(contextDir, 'glossary.md'),
        `# Glossário & Contratos
- **User**: Representa o usuário autenticado no sistema.
- **Tenant**: Identificador da organização.
`
    );

    fs.writeFileSync(
        path.join(decisionsDir, 'DEC-001.md'),
        `---
id: "DEC-001"
title: "Decisão Arquitetural Inicial"
status: "active"
date: "${new Date().toISOString().split('T')[0]}"
---
# Decisão
Definida a stack base e estrutura modular.

# Motivo
Simplicidade e facilidade de manutenção no longo prazo.
`
    );

    console.log(pc.green('✔ Estrutura .ai-context criada com sucesso!'));
    console.log(pc.cyan('👉 Edite os arquivos em .ai-context/ e rode a ferramenta para copiar o contexto.'));
}