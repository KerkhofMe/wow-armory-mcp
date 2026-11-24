const fetch = globalThis.fetch;
const loopback = new URL(process.env.MOCK_BATTLENET_ORIGIN);
if (loopback.protocol !== 'http:' || loopback.hostname !== '127.0.0.1') {
  throw new Error('Tests require a loopback mock upstream');
}

globalThis.fetch = (input, init) => {
  const url = new URL(input);
  if (!/^https:\/\/(?:oauth\.battle\.net|(?:us|eu|kr|tw)\.api\.blizzard\.com)$/.test(url.origin)) {
    throw new Error('Unexpected upstream request in test');
  }
  const local = new URL(loopback);
  local.pathname = url.pathname;
  local.search = url.search;
  const headers = new Headers(init.headers);
  headers.set('x-test-upstream', url.origin);
  return fetch(local, { ...init, headers });
};
