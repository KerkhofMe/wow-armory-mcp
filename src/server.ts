import { McpServer } from '@modelcontextprotocol/server';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import metadata from '../package.json' with { type: 'json' };
import { BlizzardClient, BlizzardError, regions } from './blizzard.js';
import type { Character } from './blizzard.js';
import * as profiles from './profiles.js';

const lookup = z.strictObject({
  region: z.enum(regions).describe('Retail region: us (Americas/Oceania), eu, kr, or tw.'),
  realm: z.string().trim().min(1).max(100)
    .refine(value => /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u.test(value),
      'Use the realm slug from the Armory URL, e.g. area-52 or malganis.')
    .describe('Exact realm slug from the Armory URL, e.g. area-52 or malganis; not the realm display name.'),
  name: z.string().trim().min(1).max(50)
    .refine(value => /^\p{L}[\p{L}\p{M}]*$/u.test(value), 'Use the character name, including any accents.')
    .describe('Character name as shown in-game, including accents. Case-insensitive.'),
});

const paging = {
  limit: z.number().int().min(1).max(100).default(25).describe('Page size, 1–100 (default 25).'),
  offset: z.number().int().min(0).max(1_000_000).default(0).describe('Zero-based offset; use next_offset for the next page.'),
};

const search = z.string().trim().min(1).max(100).optional()
  .describe('Optional case-insensitive substring of the localized name, applied before pagination.');

const bracketSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const normalize = (value: string) => value.toLowerCase().normalize('NFC');
const matchesName = (name: string | undefined, query: string | undefined) =>
  query === undefined || (name !== undefined && normalize(name).includes(normalize(query)));

export function createServer(blizzard: BlizzardClient): McpServer {
  const server = new McpServer({ name: metadata.name, version: metadata.version }, { maxToolInputElements: 32 });

  function register<Input>(
    tool: string,
    description: string,
    inputSchema: StandardSchemaWithJSON<unknown, Input>,
    run: (input: Input) => Promise<Record<string, unknown>>,
  ) {
    server.registerTool(tool, {
      description,
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async input => {
      try {
        const output = await run(input);
        return { structuredContent: output, content: [{ type: 'text', text: JSON.stringify(output) }] };
      } catch (error) {
        if (error instanceof BlizzardError) {
          return { isError: true, content: [{ type: 'text', text: `${error.code}: ${error.message}` }] };
        }
        console.error(`Unexpected error in ${tool}.`);
        return { isError: true, content: [{ type: 'text', text: 'INTERNAL_ERROR: Could not complete the lookup.' }] };
      }
    });
  }

  async function read<S extends z.ZodObject>(input: Character, suffix: string, schema: S) {
    const character = { region: input.region, realm: normalize(input.realm), name: normalize(input.name) };
    const response = schema.safeParse(await blizzard.character(character, suffix));
    if (!response.success) {
      throw new BlizzardError('INVALID_RESPONSE', 'Battle.net returned an unexpected character data format.');
    }
    return { lookup: character, ...response.data };
  }

  register('wow_character_summary',
    'Look up a public World of Warcraft Retail character: level, race, class, active specialization, faction, guild, item levels, and achievement points when available.',
    lookup,
    input => read(input, '', profiles.summary),
  );

  register('wow_character_equipment',
    'Get currently equipped items for a Retail character, including gear slot, item ID, name, quality, and item level.',
    lookup,
    input => read(input, '/equipment', profiles.equipment),
  );

  register('wow_character_achievements',
    'Get achievement totals and a page of completed achievements for a Retail character. Optionally filter by achievement name.',
    lookup.extend({ ...paging, search }),
    async input => {
      const { achievements, ...info } = await read(input, '/achievements', profiles.achievements);
      const completed = achievements
        .filter(row => row.completed_timestamp != null || row.criteria?.is_completed === true)
        .filter(row => matchesName(row.achievement.name, input.search))
        .map(({ criteria, ...row }) => row);
      return { ...info, ...profiles.page(completed, input.offset, input.limit) };
    },
  );

  register('wow_character_collection',
    'Get a page of collected mounts or battle pets for a Retail character. Optionally filter by name.',
    lookup.extend({
      collection: z.enum(['mounts', 'pets']).describe('Which collection to query: mounts or battle pets.'),
      ...paging,
      search,
    }),
    async input => {
      const { collection, offset, limit, search } = input;
      if (collection === 'mounts') {
        const { lookup, mounts } = await read(input, '/collections/mounts', profiles.mounts);
        return { lookup, collection, ...profiles.page(mounts.filter(row => matchesName(row.mount.name, search)), offset, limit) };
      }
      const { lookup, pets } = await read(input, '/collections/pets', profiles.pets);
      return {
        lookup,
        collection,
        ...profiles.page(pets.filter(row => matchesName(row.species.name, search)
          || matchesName(row.name, search)), offset, limit),
      };
    },
  );

  register('wow_character_mythic_plus',
    'Get current Mythic+ rating, current-period best runs, and available season IDs, or get best runs and rating for a specific season. Run results are paginated.',
    lookup.extend({
      season_id: z.number().int().positive().max(2_147_483_647).optional()
        .describe('Season ID from a previous lookup; omit for current-period data.'),
      ...paging,
    }),
    async input => {
      const { season_id, offset, limit } = input;
      if (season_id !== undefined) {
        const { best_runs, ...info } = await read(input, `/mythic-keystone-profile/season/${season_id}`, profiles.mythicSeason);
        return { ...info, best_runs: profiles.page(best_runs ?? [], offset, limit) };
      }
      const { current_period, ...info } = await read(input, '/mythic-keystone-profile', profiles.mythicProfile);
      return {
        ...info,
        period: current_period?.period,
        best_runs: profiles.page(current_period?.best_runs ?? [], offset, limit),
      };
    },
  );

  register('wow_character_pvp',
    'Get PvP honor level, honorable kills, and available bracket slugs, or get rating and match statistics for one specific bracket.',
    lookup.extend({
      bracket: z.string().trim().max(50).regex(bracketSlug).optional()
        .describe('Bracket slug from the PvP summary (e.g. 2v2 or 3v3); omit for the summary.'),
    }),
    async input => {
      if (input.bracket !== undefined) {
        const result = await read(input, `/pvp-bracket/${input.bracket}`, profiles.pvpBracket);
        return { bracket: input.bracket, ...result };
      }
      const { brackets, ...info } = await read(input, '/pvp-summary', profiles.pvpSummary);
      // Take IDs from the links without following them.
      const slugs = (brackets ?? []).flatMap(({ href }) => {
        const slug = /\/pvp-bracket\/([a-z0-9-]+)(?=[?/#]|$)/.exec(href)?.[1];
        return slug && bracketSlug.test(slug) ? [slug] : [];
      });
      return { ...info, brackets: [...new Set(slugs)] };
    },
  );

  return server;
}
