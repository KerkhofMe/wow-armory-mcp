import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('container entry point speaks MCP over stdio without Blizzard credentials', { timeout: 20_000 }, async () => {
  const client = new Client({ name: 'container-smoke-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: 'docker',
    args: ['run', '--rm', '-i', '--network', 'none', 'wow-armory-mcp:local'],
  });
  const transportErrors = [];
  client.onerror = error => transportErrors.push(error);

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === 'wow_character_summary'));
    const result = await client.callTool({
      name: 'wow_character_summary',
      arguments: { region: 'us', name: 'Alara', surname: 'Windward' },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text, /^MISSING_CREDENTIALS:/);
  } finally {
    await client.close();
  }
  assert.deepEqual(transportErrors, []);
});
