import type { Command } from 'commander';
import { TREE_REF } from '../session.js';

export function registerMcpCommand(program: Command, version: string) {
  program
    .command('mcp')
    .description('Serve the agent commands as MCP tools over stdio')
    .option('--ref <ref>', `Session of this ref, ${TREE_REF} for the file browser`)
    .addHelpText('after', `
Session (first match wins, looked up on every tool call):
  --ref <ref>            Session of this ref
  DIFFITY_SESSION_ID     Session with this id
  default                Last opened diff view, else the file browser

Examples:
  $ claude mcp add diffity -- diffity mcp
  $ claude mcp add diffity-main -- diffity mcp --ref main`)
    .action(async (opts: { ref?: string }) => {
      const { runMcpServer } = await import('../mcp.js');
      await runMcpServer({ ref: opts.ref }, version);
    });
}
