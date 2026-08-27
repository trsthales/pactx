import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bootstrapPactx } from '../core/bootstrap';
import { appendSessionAnchor } from '../telemetry/anchorScanner';
import { calculateContextHealth } from '../telemetry/contextHealth';
import { parseAndValidateUpdate } from '../update/parser';
import { buildMutationPlan } from '../update/planner';
import { applyMutationPlan } from '../update/applier';
import { saveProposal, getProposal, removeProposal } from './proposals';

export function registerMcpTools(server: McpServer, cwd: string = process.cwd()): void {
  // 1. pactx_record_anchor
  server.tool(
    'pactx_record_anchor',
    {
      type: z.enum(['dec', 'fact', 'rej', 'req', 'task']).describe('Anchor category'),
      payload: z.union([z.string(), z.record(z.string(), z.any())]).describe('Anchor payload string or structured JSON'),
    },
    async ({ type, payload }) => {
      try {
        const { contextDir } = bootstrapPactx(cwd, { autoRecovery: true });
        appendSessionAnchor(contextDir, {
          type,
          payload,
          rawText: typeof payload === 'string' ? payload : JSON.stringify(payload),
          source: 'ai_comment',
          capturedAt: new Date().toISOString(),
        });
        const snippet = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Anchor recorded [${type.toUpperCase()}]: "${snippet.substring(0, 100)}"`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `❌ Error recording anchor: ${err.message}` }],
        };
      }
    }
  );

  // 2. pactx_get_context_health
  server.tool(
    'pactx_get_context_health',
    {
      modelName: z.string().optional().describe('Model identifier e.g. claude-3-7-sonnet'),
      estimatedTokensUsed: z.number().describe('Estimated total tokens consumed so far in the session'),
    },
    async ({ modelName, estimatedTokensUsed }) => {
      try {
        const health = calculateContextHealth({
          modelName,
          estimatedTokensUsed,
          confidence: 'estimated',
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(health, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `❌ Error calculating context health: ${err.message}` }],
        };
      }
    }
  );

  // 3. pactx_propose_mutation
  server.tool(
    'pactx_propose_mutation',
    {
      payload: z.string().describe('pactx-update block or YAML content to propose for review'),
    },
    async ({ payload }) => {
      try {
        const { projectRoot, contextDir } = bootstrapPactx(cwd, { autoRecovery: true });
        const { payload: parsedPayload, canonicalHash, warnings } = parseAndValidateUpdate(payload);
        const plan = buildMutationPlan(projectRoot, parsedPayload, canonicalHash, warnings);
        const proposalId = `PROP-${canonicalHash.substring(0, 8).toUpperCase()}`;

        saveProposal(contextDir, {
          proposalId,
          canonicalHash,
          proposedAt: new Date().toISOString(),
          plan,
          payload: parsedPayload,
          rawInput: payload,
          warnings,
        });

        return {
          content: [
            {
              type: 'text',
              text: `✅ Proposal generated successfully (ID: ${proposalId}). The developer can review and apply it in the terminal with: pactx update --proposal ${proposalId}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `❌ Error generating proposal: ${err.message}` }],
        };
      }
    }
  );

  // 4. pactx_apply_mutation
  server.tool(
    'pactx_apply_mutation',
    {
      proposalId: z.string().describe('The proposal ID (e.g. PROP-A3F2D1B8)'),
    },
    async ({ proposalId }) => {
      try {
        const { projectRoot, contextDir } = bootstrapPactx(cwd, { autoRecovery: true });
        const proposal = getProposal(contextDir, proposalId);
        if (!proposal) {
          return {
            isError: true,
            content: [{ type: 'text', text: `❌ Proposal not found: ${proposalId}` }],
          };
        }

        applyMutationPlan(projectRoot, proposal.plan);
        removeProposal(contextDir, proposalId);

        return {
          content: [
            {
              type: 'text',
              text: `✅ Proposal ${proposal.proposalId} successfully committed to canonical repository state!`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `❌ Error applying mutation: ${err.message}` }],
        };
      }
    }
  );
}
