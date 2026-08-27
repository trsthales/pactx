import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bootstrapPactx } from '../core/bootstrap';
import { composeContext } from '../composer';
import { getTelemetryData, getStatusData } from '../commands/status';
import { calculateContextHealth } from '../telemetry/contextHealth';

export function registerMcpResources(server: McpServer, cwd: string = process.cwd()): void {
  // 1. pactx://context
  server.resource('context', 'pactx://context', async (uri) => {
    const { projectRoot } = bootstrapPactx(cwd, { autoRecovery: false });
    const text = composeContext(projectRoot);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text,
        },
      ],
    };
  });

  // 2. pactx://health
  server.resource('health', 'pactx://health', async (uri) => {
    const { contextDir } = bootstrapPactx(cwd, { autoRecovery: false });
    const telemetry = getTelemetryData(contextDir);
    const health = telemetry.healthReport || calculateContextHealth({ estimatedTokensUsed: 0 });
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(health, null, 2),
        },
      ],
    };
  });

  // 3. pactx://status
  server.resource('status', 'pactx://status', async (uri) => {
    const statusData = getStatusData(cwd);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(statusData, null, 2),
        },
      ],
    };
  });
}
