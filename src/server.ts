import { McpServer } from '@modelcontextprotocol/server';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import metadata from '../package.json' with { type: 'json' };
import { BlizzardClient, BlizzardError, regions } from './blizzard.js';
import type { Character } from './blizzard.js';
import * as profiles from './profiles.js';

const namePart = z.string().trim().min(1).max(50)
  .refine(value => /^\p{L}[\p{L}\p{M}]*$/u.test(value), 'Use one part of the character name, including any accents.');

const lookup = z.strictObject({
  region: z.enum(regions).describe('WoW Forever region: us (Americas/Oceania), eu, kr, or tw.'),
  name: namePart.describe('The first part of the character name, including accents. Case-insensitive.'),
  surname: namePart.describe('The second part of the character name, including accents. Case-insensitive.'),
});

const paging = {
  limit: z.number().int().min(1).max(100).default(25).describe('Page size, 1–100 (default 25).'),
  offset: z.number().int().min(0).max(1_000_000).default(0).describe('Zero-based offset; use next_offset for the next page.'),
};

const search = z.string().trim().min(1).max(100).optional()
  .describe('Optional case-insensitive substring of the localized name, applied before pagination.');

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
    const character = { region: input.region, name: normalize(input.name), surname: normalize(input.surname) };
    const response = schema.safeParse(await blizzard.character(character, suffix));
    if (!response.success) {
      throw new BlizzardError('INVALID_RESPONSE', 'Battle.net returned an unexpected character data format.');
    }
    return { lookup: character, ...response.data };
  }

  register('wow_character_summary',
    'Look up a public WoW Forever character by first name and surname: level, ruleset, race, class, faction, guild, item levels, and achievement points when available.',
    lookup,
    input => read(input, '', profiles.summary),
  );

  register('wow_character_equipment',
    'Get equipped items for a WoW Forever character, including gear slot, item ID, name, quality, and item level.',
    lookup,
    input => read(input, '/equipment', profiles.equipment),
  );

  register('wow_character_achievements',
    'Get achievement totals and a page of completed achievements for a WoW Forever character. Optionally filter by achievement name.',
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
    'Get a page of collected mounts or battle pets for a WoW Forever character. Optionally filter by name.',
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

  register('wow_character_talents',
    'Get active and alternate talent builds for a WoW Forever character: points spent per tree and ranks of learned talents.',
    lookup,
    input => read(input, '/specializations', profiles.talents),
  );

  register('wow_character_pvp',
    'Get PvP rank, honorable kills, and available battleground results for a WoW Forever character.',
    lookup,
    input => read(input, '/pvp-summary', profiles.pvpSummary),
  );

  return server;
}
