import yaml from 'yaml';
import { NormalizedTranscript, DeterministicExtractionResult } from './types';

export interface ModelExtractOptions {
  model?: string; // ex: 'gemini-2.5-flash', 'claude-3-5-haiku', 'gpt-4o-mini', 'qwen2.5-coder'
  apiKey?: string;
  endpoint?: string;
}

export const EXTRACTION_SYSTEM_PROMPT = `You are a surgical context extractor for the pactx closed-loop memory engine.
Your task is to analyze a development chat transcript and extract genuine architectural decisions, proven runtime facts, requirements, and rejected hypotheses (Negative Knowledge).

CRITICAL RULES:
1. Prioritize NEGATIVE KNOWLEDGE (rejected_hypotheses). Explicitly capture approaches, libraries, or architectures that were discussed and rejected.
2. For each decision, requirement, fact, and rejected hypothesis, include an Evidence Span indicating the approximate turn or quote where it occurred (e.g. "(evidence: turn 2 - 'We should not use JWT')").
3. Respect and incorporate pre-extracted deterministic signals (micro-anchors, git diffs, inline code annotations).
4. DO NOT invent or extrapolate decisions. If something was just a casual exploration without confirmation, DO NOT record it.
5. Output MUST contain a valid \`\`\`pactx-update block.

Schema format to output:
\`\`\`pactx-update
version: "1.1"
source:
  type: "conversation"
  model: "<model_name>"
  session_topic: "<session_topic>"
state:
  active_task: "<active_task>"
  status: "IN_PROGRESS | BLOCKED | COMPLETED"
  recommended_model: "Medium | High"
  completed_items:
    - "<completed item>"
  new_facts:
    - "<proven fact> (evidence: turn X)"
  rejected_hypotheses:
    - "<tested & rejected hypothesis> (evidence: turn Y)"
  next_action: "<immediate next action>"
new_requirements:
  - id: "auto"
    type: "functional | security | performance | compliance"
    title: "<title>"
    statement: "<statement>"
new_decisions:
  - id: "auto"
    title: "<title>"
    reason: "<reason> (evidence: turn Z)"
    decision: "<decision>"
    satisfies: []
superseded_decisions: []
new_glossary_terms: []
\`\`\``;

export function formatDeterministicUpdateBlock(
  deterministicData: DeterministicExtractionResult,
  baseRevision: string = ''
): string {
  const payload = {
    version: '1.1',
    base_revision: baseRevision,
    source: {
      type: 'conversation',
      model: 'deterministic-extractor',
      session_topic: 'Offline transcript extraction',
    },
    state: {
      active_task: deterministicData.candidateUpdate.state?.active_task || 'Extracted Session Tasks',
      status: deterministicData.candidateUpdate.state?.status || 'IN_PROGRESS',
      recommended_model: deterministicData.candidateUpdate.state?.recommended_model || 'Medium',
      completed_items: deterministicData.candidateUpdate.state?.completed_items || [],
      new_facts: deterministicData.candidateUpdate.state?.new_facts || [],
      rejected_hypotheses: deterministicData.candidateUpdate.state?.rejected_hypotheses || [],
      next_action: deterministicData.candidateUpdate.state?.next_action || 'Review and continue development',
    },
    new_requirements: deterministicData.candidateUpdate.new_requirements || [],
    new_decisions: deterministicData.candidateUpdate.new_decisions || [],
    superseded_decisions: deterministicData.candidateUpdate.superseded_decisions || [],
    new_glossary_terms: deterministicData.candidateUpdate.new_glossary_terms || [],
  };

  return `\`\`\`pactx-update\n${yaml.stringify(payload)}\`\`\``;
}

export function detectProvider(options: ModelExtractOptions): 'gemini' | 'claude' | 'openai' | 'ollama' {
  const model = (options.model || '').toLowerCase();
  const endpoint = (options.endpoint || '').toLowerCase();
  const key = options.apiKey || '';

  if (model.includes('gemini') || key.startsWith('AIza')) return 'gemini';
  if (model.includes('claude') || model.includes('anthropic') || key.startsWith('sk-ant')) return 'claude';
  if (model.includes('gpt') || model.includes('o1') || model.includes('o3') || model.includes('openai') || key.startsWith('sk-')) return 'openai';
  if (model.includes('ollama') || model.includes('qwen') || model.includes('llama') || endpoint.includes('11434')) return 'ollama';

  // Fallback defaults
  if (key.startsWith('sk-ant')) return 'claude';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-')) return 'openai';
  return 'gemini';
}

export async function extractWithModel(
  transcript: NormalizedTranscript,
  deterministicData: DeterministicExtractionResult,
  options: ModelExtractOptions
): Promise<string> {
  const provider = detectProvider(options);

  const deterministicSummary = `Pre-extracted deterministic signals:
- Anchors captured: ${deterministicData.anchorsCount}
- Inline code annotations: ${JSON.stringify(deterministicData.inlineCodeAnnotations)}
- Git modified files: ${JSON.stringify(deterministicData.gitSignals.modifiedFiles)}
- Candidate decisions: ${JSON.stringify(deterministicData.candidateUpdate.new_decisions)}
- Candidate rejected hypotheses: ${JSON.stringify(deterministicData.candidateUpdate.state?.rejected_hypotheses)}
- Candidate facts: ${JSON.stringify(deterministicData.candidateUpdate.state?.new_facts)}`;

  const transcriptTurnsText = transcript.turns
    .map(t => `[Turn ${t.index}] ${t.role.toUpperCase()}:\n${t.content}`)
    .join('\n\n');

  const fullPrompt = `${deterministicSummary}\n\n=== FULL TRANSCRIPT ===\n${transcriptTurnsText}`;

  if (provider === 'gemini') {
    const model = options.model || 'gemini-2.5-flash';
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.PACTX_API_KEY || '';
    if (!apiKey) throw new Error('API key is required for Gemini extraction (provide --api-key or GEMINI_API_KEY env).');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${EXTRACTION_SYSTEM_PROMPT}\n\n${fullPrompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text;
  }

  if (provider === 'claude') {
    const model = options.model || 'claude-3-5-haiku-20241022';
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || process.env.PACTX_API_KEY || '';
    if (!apiKey) throw new Error('API key is required for Claude extraction (provide --api-key or ANTHROPIC_API_KEY env).');

    const url = options.endpoint || 'https://api.anthropic.com/v1/messages';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.1,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: fullPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    const text = data.content?.[0]?.text || '';
    return text;
  }

  if (provider === 'openai') {
    const model = options.model || 'gpt-4o-mini';
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY || process.env.PACTX_API_KEY || '';
    if (!apiKey) throw new Error('API key is required for OpenAI extraction (provide --api-key or OPENAI_API_KEY env).');

    const url = options.endpoint || 'https://api.openai.com/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: fullPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return text;
  }

  // Ollama
  const endpoint = options.endpoint || 'http://127.0.0.1:11434';
  const model = options.model || 'qwen2.5-coder';
  const url = `${endpoint}/api/chat`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: fullPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama API error (${res.status}): ${errText}`);
  }

  const data: any = await res.json();
  const text = data.message?.content || '';
  return text;
}
