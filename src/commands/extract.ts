import fs from 'node:fs';
import readline from 'node:readline';
import pc from 'picocolors';
import { bootstrapPactx } from '../core/bootstrap';
import { getCurrentContextRevision } from '../composer';
import { detectAndNormalizeTranscript } from '../extract/detector';
import { extractDeterministicData } from '../extract/deterministic';
import { extractWithModel, formatDeterministicUpdateBlock, ModelExtractOptions } from '../extract/modelExtractor';
import { parseAndValidateUpdate } from '../update/parser';
import { buildMutationPlan } from '../update/planner';
import { applyMutationPlan } from '../update/applier';

export interface ExtractCommandOptions extends ModelExtractOptions {
  stdin?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  force?: boolean;
}

export async function executeExtract(
  cwd: string = process.cwd(),
  file?: string,
  options: ExtractCommandOptions = {}
): Promise<void> {
  let rawInput = '';

  if (file) {
    if (!fs.existsSync(file)) {
      throw new Error(`Transcript file not found: ${file}`);
    }
    rawInput = fs.readFileSync(file, 'utf-8');
  } else if (options.stdin) {
    if (process.stdin.isTTY) {
      throw new Error('No data received from pipe. Use: cat transcript.json | pactx extract --stdin');
    }
    rawInput = fs.readFileSync(0, 'utf-8');
  } else {
    try {
      const clipboardy = (await import('clipboardy')).default;
      rawInput = await clipboardy.read();
    } catch {
      throw new Error('Could not read clipboard. Provide a file path or use --stdin.');
    }
  }

  if (!rawInput || !rawInput.trim()) {
    throw new Error('Transcript input is empty.');
  }

  const { projectRoot, contextDir } = bootstrapPactx(cwd, { autoRecovery: true });
  const baseRevision = getCurrentContextRevision(contextDir);

  // 1. Normalização do Transcript
  const transcript = detectAndNormalizeTranscript(rawInput);
  console.log(pc.bold(pc.cyan(`\n🔍 Transcript detected: ${transcript.source.toUpperCase()} (${transcript.turns.length} turns)`)));

  // 2. Extração Determinística Local (Fase 1)
  const deterministicData = extractDeterministicData(transcript, projectRoot);
  console.log(pc.dim(`   • Micro-anchors: ${deterministicData.anchorsCount}`));
  console.log(pc.dim(`   • Code annotations: ${deterministicData.inlineCodeAnnotations.length}`));
  console.log(pc.dim(`   • Git modified files: ${deterministicData.gitSignals.modifiedFiles.length}`));

  // 3. Extração Semântica com Modelo ou Fallback Offline (Fase 2)
  const apiKey = options.apiKey || process.env.PACTX_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  const isOllama = options.model?.includes('ollama') || options.endpoint?.includes('11434');

  let extractedBlock = '';
  if (apiKey || isOllama) {
    console.log(pc.cyan(`🤖 Running semantic extraction with model '${options.model || 'auto'}'...`));
    extractedBlock = await extractWithModel(transcript, deterministicData, {
      model: options.model,
      apiKey,
      endpoint: options.endpoint,
    });
  } else {
    console.log(pc.yellow(`ℹ Running in offline deterministic mode (${deterministicData.anchorsCount} anchors + git signals). For full semantic extraction, provide --api-key.`));
    extractedBlock = formatDeterministicUpdateBlock(deterministicData, baseRevision);
  }

  // 4. Modo --dry-run
  if (options.dryRun) {
    console.log(pc.bold(pc.yellow('\n🔍 --dry-run mode: Candidate pactx-update block extracted:\n')));
    console.log(extractedBlock);
    console.log('');
    return;
  }

  // 5. Ingress Transacional Seguro via Pipeline Padrão
  const { payload, canonicalHash, warnings } = parseAndValidateUpdate(extractedBlock);
  if (!payload.base_revision) {
    payload.base_revision = baseRevision;
  }

  const plan = buildMutationPlan(projectRoot, payload, canonicalHash, warnings);

  console.log(pc.bold(pc.cyan('\n📦 Candidate Mutation Plan from Transcript:')));
  console.log(pc.dim('────────────────────────────────────────────────────────────────────────────'));

  if (plan.isAlreadyApplied) {
    console.log(pc.yellow(`ℹ This update was already applied previously (Hash: ${canonicalHash.substring(0, 8)}). Completed (No-Op).`));
    return;
  }

  if (plan.warnings.length > 0) {
    console.log(pc.bold(pc.yellow('⚠️ WARNINGS:')));
    plan.warnings.forEach(w => console.log(pc.yellow(`  • ${w}`)));
    console.log('');
  }

  const hasStaleContext = plan.warnings.some(w => w.includes('Stale Context'));
  if (options.yes && hasStaleContext && !options.force) {
    console.error(pc.red('✖ Error: Stale Context detected with -y/--yes flag.'));
    console.error(pc.yellow('  The update was based on an outdated revision of the repository.'));
    console.error(pc.yellow('  To force application without interactive confirmation, use:'));
    console.error(pc.cyan('    pactx extract -y --force\n'));
    process.exit(1);
  }

  if (plan.operations.stateUpdate) {
    console.log(pc.cyan('📝 .ai-context/state.md'));
    console.log(`   • Active Task: "${plan.operations.stateUpdate.activeTask}" [${plan.operations.stateUpdate.status}]`);
    console.log(`   • Next Action: "${plan.operations.stateUpdate.nextAction}"`);
    plan.operations.stateUpdate.newFacts.forEach(f => console.log(pc.green(`   • [+] Fact: "${f}"`)));
    plan.operations.stateUpdate.newRejectedHypotheses.forEach(h => console.log(pc.magenta(`   • [+] Discarded Hypothesis: "${h}"`)));
  }

  if (plan.operations.createdRequirements && plan.operations.createdRequirements.length > 0) {
    console.log(pc.magenta('📋 .ai-context/requirements.md [CREATE]'));
    for (const req of plan.operations.createdRequirements) {
      console.log(`   • [${req.id}] "${req.title}" (${req.type})`);
      if (req.statement) {
        console.log(`     Statement: "${req.statement}"`);
      }
    }
  }

  for (const adr of plan.operations.createdAdrs) {
    console.log(pc.green(`🏛️  .ai-context/decisions/${adr.id}.md [CREATE]`));
    console.log(`   • Title: "${adr.title}"`);
    if (adr.satisfies && adr.satisfies.length > 0) {
      console.log(`   • Satisfies: ${adr.satisfies.join(', ')}`);
    }
    console.log(`   • Decision: "${adr.decision}"`);
  }

  for (const adr of plan.operations.supersededAdrs) {
    console.log(pc.yellow(`🏛️  .ai-context/decisions/${adr.id}.md [SUPERSEDE]`));
    console.log(`   • Superseded by: ${adr.supersededBy} (${adr.reason})`);
  }

  for (const term of plan.operations.appendedGlossaryTerms) {
    console.log(pc.blue(`📖 .ai-context/glossary.md [APPEND]`));
    console.log(`   • ${term.term}: "${term.definition}"`);
  }

  console.log(pc.dim('────────────────────────────────────────────────────────────────────────────\n'));

  const proceed = options.yes ? true : await new Promise<boolean>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(pc.bold('? Apply canonical changes from transcript to repository? (Y/n) '), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim() === '');
    });
  });

  if (!proceed) {
    console.log(pc.yellow('✖ Operation cancelled by user.'));
    return;
  }

  plan.isForced = !!options.force;
  applyMutationPlan(projectRoot, plan);
  console.log(pc.green('\n✔ Canonical state updated successfully from transcript!'));
  console.log(pc.dim('📋 Audit ledger recorded in .ai-context/.pactx/ledger.json\n'));
}
