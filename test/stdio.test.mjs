import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const endpoint = '/profile/wow/character/draenor/%C3%A9owyn';
const lookup = { region: 'eu', realm: ' Draenor ', name: ' E\u0301owyn ' };
const normalized = { region: 'eu', realm: 'draenor', name: 'éowyn' };
const tools = {
  summary: 'wow_character_summary',
  equipment: 'wow_character_equipment',
  achievements: 'wow_character_achievements',
  collection: 'wow_character_collection',
  mythic: 'wow_character_mythic_plus',
  pvp: 'wow_character_pvp',
};

const character = { id: 42, name: 'Éowyn', level: 80, realm: { id: 1, name: 'Draenor', slug: 'draenor' } };
const run = {
  dungeon: { id: 8, name: 'Example Dungeon' },
  keystone_level: 12,
  is_completed_within_time: true,
  members: [{ character }],
};
const fixtures = new Map([
  ['', { ...character, character_class: { id: 1, name: 'Warrior' }, equipped_item_level: 650, _links: {} }],
  ['/equipment', { equipped_items: [{ item: { id: 1 }, slot: { type: 'HEAD', name: 'Head' }, name: 'Helm', level: { value: 650 } }] }],
  ['/achievements', {
    total_points: 10,
    total_quantity: 2,
    achievements: [
      { achievement: { id: 1, name: 'Explore a Zone' }, completed_timestamp: 1_700_000_000_000 },
      { achievement: { id: 2, name: 'Explore a Dungeon' }, criteria: { is_completed: true } },
      { achievement: { id: 3, name: 'Explore a Continent' }, completed_timestamp: null, criteria: { is_completed: false } },
    ],
  }],
  ['/collections/mounts', {
    mounts: Array.from({ length: 225 }, (_, index) => ({ mount: { id: index + 1, name: `Mount ${index + 1}` } })),
  }],
  ['/collections/pets', {
    pets: [{ id: 12, species: { id: 4, name: 'Cat' }, name: 'Croissant', level: 25 }],
  }],
  ['/mythic-keystone-profile', {
    character, current_mythic_rating: { rating: 2500 },
    seasons: [{ id: 1 }, { id: 2 }],
    current_period: { period: { id: 17 }, best_runs: [run] },
  }],
  ['/mythic-keystone-profile/season/2', {
    character, season: { id: 2 }, mythic_rating: { rating: 2600 }, best_runs: [run, { ...run, keystone_level: 13 }],
  }],
  ['/pvp-summary', {
    character, honor_level: 35, honorable_kills: 42,
    brackets: [{ href: `https://eu.api.blizzard.com${endpoint}/pvp-bracket/2v2?namespace=profile-eu` }],
  }],
  ['/pvp-bracket/2v2', { character, rating: 1900, season_match_statistics: { played: 25, won: 15, lost: 10 } }],
]);

async function connect(t, options = {}) {
  const requests = [];
  const mock = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method, host: request.headers['x-test-upstream'],
      auth: request.headers.authorization, path: url.pathname, query: url.search, body,
      contentType: request.headers['content-type'],
    });
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/token') {
      return response.end(JSON.stringify({ access_token: 'mock-token', token_type: 'bearer', expires_in: 3600 }));
    }
    if (!url.pathname.startsWith(endpoint) || !fixtures.has(url.pathname.slice(endpoint.length))) {
      response.statusCode = 404;
      return response.end('{"detail":"upstream-only information"}');
    }
    return response.end(JSON.stringify(fixtures.get(url.pathname.slice(endpoint.length))));
  });
  mock.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => mock.close(resolve)));
  await once(mock, 'listening');

  const client = new Client({ name: 'armory-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import', fileURLToPath(new URL('./mock-upstream.mjs', import.meta.url)),
      fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    ],
    env: {
      BLIZZARD_CLIENT_ID: 'test-client',
      BLIZZARD_CLIENT_SECRET: 'test-secret',
      MOCK_BATTLENET_ORIGIN: `http://127.0.0.1:${mock.address().port}`,
    },
    stderr: 'pipe',
  });
  const protocolErrors = [];
  let stderr = '';
  client.onerror = error => protocolErrors.push(error);
  transport.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    await client.close();
    assert.deepEqual(protocolErrors, []);
    assert.doesNotMatch(stderr, /test-client|test-secret|mock-token/);
  });
  await client.connect(transport, options);
  return { client, requests };
}

const call = (client, name, args) => client.callTool({ name, arguments: args });
async function data(client, name, args = {}) {
  const result = await call(client, name, { ...lookup, ...args });
  assert.notEqual(result.isError, true, result.content[0]?.text);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}

test('SDK client discovers and calls all tools over real stdio with a mock Battle.net HTTP server', { timeout: 15_000 }, async t => {
  const { client, requests } = await connect(t);
  const listed = (await client.listTools()).tools;
  assert.deepEqual(listed.map(tool => tool.name).sort(), Object.values(tools).sort());
  assert.ok(listed.every(tool => tool.annotations.readOnlyHint && tool.description));
  assert.deepEqual(listed.find(tool => tool.name === tools.summary).inputSchema.required, ['region', 'realm', 'name']);
  assert.equal(requests.length, 0, 'discovery should not make upstream calls');

  const invalid = await call(client, tools.summary, { ...lookup, name: '../other' });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /character name/i);
  const oversized = await call(client, tools.collection, { ...lookup, collection: 'mounts', limit: 101 });
  assert.equal(oversized.isError, true);
  assert.equal(requests.length, 0, 'invalid inputs should not make upstream calls');

  const summary = await data(client, tools.summary);
  assert.deepEqual(summary, {
    ...character, lookup: normalized, character_class: { id: 1, name: 'Warrior' }, equipped_item_level: 650,
  });
  const equipment = await data(client, tools.equipment);
  assert.equal(equipment.equipped_items[0].level.value, 650);

  const achievements = await data(client, tools.achievements, { search: 'EXPLORE', limit: 1 });
  assert.equal(achievements.total_points, 10);
  assert.equal(achievements.total, 2);
  assert.equal(achievements.next_offset, 1);
  assert.deepEqual(achievements.items.map(row => row.achievement.id), [1]);
  const last = await data(client, tools.achievements, { search: 'explore', offset: achievements.next_offset });
  assert.equal(last.next_offset, null);
  assert.deepEqual(last.items.map(row => row.achievement.id), [2]);

  const mounts = await data(client, tools.collection, { collection: 'mounts', limit: 100, offset: 100 });
  assert.equal(mounts.total, 225);
  assert.equal(mounts.items.length, 100);
  assert.equal(mounts.items[0].mount.id, 101);
  assert.equal(mounts.next_offset, 200);
  const pets = await data(client, tools.collection, { collection: 'pets', search: 'CROISSANT' });
  assert.equal(pets.items[0].species.name, 'Cat');

  const mythic = await data(client, tools.mythic);
  assert.equal(mythic.current_mythic_rating.rating, 2500);
  assert.deepEqual(mythic.seasons, [{ id: 1 }, { id: 2 }]);
  assert.equal(mythic.best_runs.items[0].keystone_level, 12);
  assert.ok(!('members' in mythic.best_runs.items[0]));
  const season = await data(client, tools.mythic, { season_id: 2, offset: 1 });
  assert.equal(season.mythic_rating.rating, 2600);
  assert.equal(season.best_runs.items[0].keystone_level, 13);

  const pvp = await data(client, tools.pvp);
  assert.equal(pvp.honor_level, 35);
  assert.deepEqual(pvp.brackets, ['2v2']);
  const bracket = await data(client, tools.pvp, { bracket: '2v2' });
  assert.equal(bracket.rating, 1900);
  assert.equal(bracket.season_match_statistics.won, 15);

  const missing = await call(client, tools.summary, { ...lookup, name: 'Unknown' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /NOT_FOUND:.*realm slug/);
  assert.doesNotMatch(missing.content[0].text, /upstream-only/);

  assert.deepEqual(requests[0], {
    method: 'POST', host: 'https://oauth.battle.net', auth: `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`,
    path: '/token', query: '', body: 'grant_type=client_credentials',
    contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
  });
  assert.deepEqual(requests.slice(1).map(request => request.path), [
    endpoint, ...[
      '/equipment', '/achievements', '/achievements', '/collections/mounts', '/collections/pets',
      '/mythic-keystone-profile', '/mythic-keystone-profile/season/2', '/pvp-summary', '/pvp-bracket/2v2',
    ].map(suffix => endpoint + suffix),
    '/profile/wow/character/draenor/unknown',
  ]);
  assert.ok(requests.slice(1).every(request => request.method === 'GET'
    && request.host === 'https://eu.api.blizzard.com'
    && request.query === '?namespace=profile-eu&locale=en_GB'
    && request.auth === 'Bearer mock-token'));
});

test('2025-era MCP clients can also list tools and call a profile over stdio', { timeout: 15_000 }, async t => {
  const { client, requests } = await connect(t, { prior: { kind: 'legacy' } });
  assert.equal((await client.listTools()).tools.length, 6);
  assert.equal((await data(client, tools.summary)).name, 'Éowyn');
  assert.equal(requests.length, 2);
});
