import * as z from 'zod/v4';

export const regions = ['us', 'eu', 'kr', 'tw'] as const;
export type Region = typeof regions[number];

const regionLocales: Record<Region, string> = {
  us: 'en_US',
  eu: 'en_GB',
  kr: 'ko_KR',
  tw: 'zh_TW',
};

export type Character = { region: Region; realm: string; name: string };

type RequestKind = 'profile' | 'detail' | 'oauth';
type ErrorCode =
  | 'MISSING_CREDENTIALS'
  | 'AUTHENTICATION_FAILED'
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

export class BlizzardError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
}

const tokenSchema = z.object({
  access_token: z.string().regex(/^[A-Za-z0-9._~+/-]+=*$/),
  expires_in: z.number().int().positive(),
  token_type: z.string().regex(/^bearer$/i),
});

type Token = { value: string; renewAt: number };

export class BlizzardClient {
  #token?: Token;
  #refresh?: Promise<Token>;

  constructor(
    private readonly env: { BLIZZARD_CLIENT_ID?: string; BLIZZARD_CLIENT_SECRET?: string },
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async character({ region, realm, name }: Character, suffix = ''): Promise<unknown> {
    const url = new URL(
      `/profile/wow/character/${encodeURIComponent(realm)}/${encodeURIComponent(name)}${suffix}`,
      `https://${region}.api.blizzard.com`,
    );
    url.searchParams.set('namespace', `profile-${region}`);
    url.searchParams.set('locale', regionLocales[region]);
    const kind = suffix ? 'detail' : 'profile';
    const token = await this.#getToken();
    const request = (value: string) => this.#send(url, kind, {
      headers: { Authorization: `Bearer ${value}`, Accept: 'application/json' },
    });

    try {
      return await request(token.value);
    } catch (error) {
      if (!(error instanceof BlizzardError) || error.code !== 'AUTHENTICATION_FAILED') throw error;
      if (this.#token === token) this.#token = undefined;
      return request((await this.#getToken()).value);
    }
  }

  #getToken(): Promise<Token> {
    if (this.#token && this.#token.renewAt > this.now()) return Promise.resolve(this.#token);
    this.#refresh ??= this.#requestToken()
      .then(token => (this.#token = token))
      .finally(() => { this.#refresh = undefined; });
    return this.#refresh;
  }

  async #requestToken(): Promise<Token> {
    const id = this.env.BLIZZARD_CLIENT_ID?.trim();
    const secret = this.env.BLIZZARD_CLIENT_SECRET?.trim();
    if (!id || !secret) {
      throw new BlizzardError(
        'MISSING_CREDENTIALS',
        'Set BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in the MCP server environment.',
      );
    }

    const issuedAfter = this.now();
    const response = await this.#send(new URL('https://oauth.battle.net/token'), 'oauth', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    const token = tokenSchema.safeParse(response);
    if (!token.success) {
      throw new BlizzardError('INVALID_RESPONSE', 'Battle.net returned an invalid OAuth token response.');
    }
    const ttl = token.data.expires_in * 1_000;
    return { value: token.data.access_token, renewAt: issuedAfter + ttl - Math.min(60_000, ttl / 10) };
  }

  async #send(url: URL, kind: RequestKind, init: RequestInit): Promise<unknown> {
    const signal = AbortSignal.timeout(10_000);
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, signal, redirect: 'error' });
    } catch {
      throw transportError(signal);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw httpError(response, kind, this.now());
    }
    try {
      return await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new BlizzardError('INVALID_RESPONSE', 'Battle.net returned invalid JSON.');
      }
      throw transportError(signal);
    }
  }
}

function transportError(signal: AbortSignal): BlizzardError {
  return signal.aborted
    ? new BlizzardError('TIMEOUT', 'Battle.net did not respond within 10 seconds. Try again later.')
    : new BlizzardError('NETWORK_ERROR', 'Could not reach Battle.net. Check network connectivity and try again.');
}

function httpError({ status, headers }: Response, kind: RequestKind, now: number): BlizzardError {
  if ([401, 403, 400].includes(status) && kind === 'oauth') {
    return new BlizzardError(
      'AUTHENTICATION_FAILED',
      'Battle.net rejected the OAuth request. Check that the app credentials are correct and active.',
    );
  }
  if (status === 401) {
    return new BlizzardError('AUTHENTICATION_FAILED', 'Battle.net rejected the access token (HTTP 401).');
  }
  if (status === 403) {
    return new BlizzardError('ACCESS_DENIED', 'Battle.net denied access to this character data (HTTP 403).');
  }
  if (status === 404 && kind !== 'oauth') {
    const subject = kind === 'profile' ? 'Character profile' : 'Character data';
    return new BlizzardError(
      'NOT_FOUND',
      `${subject} not found. Check the region, realm slug, and name. Private or inactive profiles and missing activity data may also return 404.`,
    );
  }
  if (status === 429) {
    const retryAfter = headers.get('retry-after');
    const seconds = retryAfter && (/^\d+$/.test(retryAfter)
      ? Number(retryAfter)
      : Math.max(0, Math.ceil((Date.parse(retryAfter) - now) / 1_000)));
    const wait = typeof seconds === 'number' && Number.isSafeInteger(seconds) ? ` in ${seconds} seconds` : ' later';
    return new BlizzardError('RATE_LIMITED', `Battle.net rate limit reached. Retry${wait}.`);
  }
  if (status >= 500) {
    return new BlizzardError('UPSTREAM_UNAVAILABLE', `Battle.net is temporarily unavailable (HTTP ${status}).`);
  }
  return new BlizzardError('UPSTREAM_ERROR', `Battle.net returned HTTP ${status}.`);
}
