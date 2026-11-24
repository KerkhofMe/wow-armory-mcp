import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { BlizzardClient } from './blizzard.js';
import { createServer } from './server.js';

serveStdio(() => createServer(new BlizzardClient(process.env)), {
  onerror: () => console.error('WoW Armory MCP stdio transport error.'),
});
