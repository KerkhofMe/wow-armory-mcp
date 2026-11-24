import assert from 'node:assert/strict';
import test from 'node:test';
import { BlizzardClient } from '../dist/blizzard.js';

const env = { BLIZZARD_CLIENT_ID: 'test-client', BLIZZARD_CLIENT_SECRET: 'test-secret' };
const character = { region: 'us', realm: 'area-52', name: 'álara' };
const token = (id, expires_in = 100) => Response.json({
  access_token: `token-${id}`,
  expires_in,
  token_type: 'bearer',
});

test('OAuth refresh is shared and the token is renewed before expiry', async () => {
  let time = 0;
  let oauthCalls = 0;
  const requests = [];
  const blizzard = new BlizzardClient(env, async (url, init) => {
    if (url.hostname === 'oauth.battle.net') {
      return token(++oauthCalls);
    }
    requests.push([url.toString(), init.headers.Authorization]);
    return Response.json({ id: 1 });
  }, () => time);

  await Promise.all([
    blizzard.character(character),
    blizzard.character({ region: 'kr', realm: '아즈샤라', name: '별빛' }),
    blizzard.character({ region: 'tw', realm: '世界之樹', name: '星光' }),
  ]);
  assert.equal(oauthCalls, 1);
  assert.deepEqual(requests.map(([url, auth]) => {
    const parsed = new URL(url);
    return [parsed.hostname, decodeURIComponent(parsed.pathname), parsed.search, auth];
  }), [
    ['us.api.blizzard.com', '/profile/wow/character/area-52/álara', '?namespace=profile-us&locale=en_US', 'Bearer token-1'],
    ['kr.api.blizzard.com', '/profile/wow/character/아즈샤라/별빛', '?namespace=profile-kr&locale=ko_KR', 'Bearer token-1'],
    ['tw.api.blizzard.com', '/profile/wow/character/世界之樹/星光', '?namespace=profile-tw&locale=zh_TW', 'Bearer token-1'],
  ]);

  time = 89_999;
  await blizzard.character(character);
  assert.equal(oauthCalls, 1);
  time = 90_000;
  await blizzard.character(character);
  assert.equal(oauthCalls, 2);
  assert.equal(requests.at(-1)[1], 'Bearer token-2');
});

test('a rejected bearer token is refreshed and retried at most once', async () => {
  let oauthCalls = 0;
  const authorizations = [];
  const blizzard = new BlizzardClient(env, async (url, init) => {
    if (url.hostname === 'oauth.battle.net') return token(++oauthCalls);
    authorizations.push(init.headers.Authorization);
    return new Response(null, { status: 401 });
  });

  await assert.rejects(blizzard.character(character), { code: 'AUTHENTICATION_FAILED' });
  assert.equal(oauthCalls, 2);
  assert.deepEqual(authorizations, ['Bearer token-1', 'Bearer token-2']);
});

test('missing credentials and rejected OAuth never reach the profile endpoint', async () => {
  const absent = new BlizzardClient({}, () => assert.fail('Unexpected outbound request'));
  await assert.rejects(absent.character(character), { code: 'MISSING_CREDENTIALS' });

  let oauthCalls = 0;
  const rejected = new BlizzardClient(env, async (url) => {
    assert.equal(url.toString(), 'https://oauth.battle.net/token');
    oauthCalls++;
    return new Response(env.BLIZZARD_CLIENT_SECRET, { status: 401 });
  });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(rejected.character(character), error => {
      assert.equal(error.code, 'AUTHENTICATION_FAILED');
      assert.doesNotMatch(error.message, /test-secret/);
      return true;
    });
  }
  assert.equal(oauthCalls, 2);
});

test('respect rate limits, report upstream failures, and never echo error bodies', async () => {
  const replies = [
    new Response('private detail', { status: 429, headers: { 'Retry-After': 'Thu, 01 Jan 1970 00:00:15 GMT' } }),
    new Response('private detail', { status: 503 }),
    new Response('private detail', { status: 200 }),
  ];
  const blizzard = new BlizzardClient(env, async url =>
    url.hostname === 'oauth.battle.net' ? token(1) : replies.shift(), () => 10_000);

  await assert.rejects(blizzard.character(character), {
    code: 'RATE_LIMITED',
    message: 'Battle.net rate limit reached. Retry in 5 seconds.',
  });
  await assert.rejects(blizzard.character(character), {
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Battle.net is temporarily unavailable (HTTP 503).',
  });
  await assert.rejects(blizzard.character(character), {
    code: 'INVALID_RESPONSE',
    message: 'Battle.net returned invalid JSON.',
  });
  assert.equal(replies.length, 0);
});
