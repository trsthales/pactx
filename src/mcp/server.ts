import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerMcpResources } from './resources';
import { registerMcpTools } from './tools';

export function createPactxMcpServer(cwd: string = process.cwd()): McpServer {
  const server = new McpServer({
    name: '@trsthales/pactx',
    version: '0.4.0',
  });

  registerMcpResources(server, cwd);
  registerMcpTools(server, cwd);

  return server;
}

export async function startMcpServer(cwd: string = process.cwd()): Promise<void> {
  const server = createPactxMcpServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
