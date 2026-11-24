import * as z from 'zod/v4';

const id = z.object({ id: z.number().int() });
const named = id.extend({ name: z.string() });
const typeLabel = z.object({ type: z.string(), name: z.string() });

export const summary = z.object({
  id: z.number().int(),
  name: z.string(),
  level: z.number().int(),
  realm: named.extend({ slug: z.string() }),
  race: named.optional(),
  character_class: named.optional(),
  active_spec: named.optional(),
  faction: typeLabel.optional(),
  guild: named.optional(),
  achievement_points: z.number().int().optional(),
  average_item_level: z.number().optional(),
  equipped_item_level: z.number().optional(),
});

export const equipment = z.object({
  equipped_items: z.array(z.object({
    item: id,
    name: z.string(),
    slot: typeLabel,
    quality: typeLabel.optional(),
    level: z.object({ value: z.number() }).optional(),
  })),
});

export const achievements = z.object({
  total_points: z.number().int(),
  total_quantity: z.number().int(),
  achievements: z.array(z.object({
    achievement: id.extend({ name: z.string().optional() }),
    completed_timestamp: z.number().int().nullish(),
    criteria: z.object({ is_completed: z.boolean().optional() }).optional(),
  })),
});

export const mounts = z.object({
  mounts: z.array(z.object({
    mount: named,
    is_favorite: z.boolean().optional(),
  })),
});

export const pets = z.object({
  pets: z.array(z.object({
    id: z.number().int().optional(),
    species: named,
    name: z.string().optional(),
    level: z.number().int().optional(),
    quality: typeLabel.optional(),
    is_favorite: z.boolean().optional(),
  })),
});

const rating = z.object({ rating: z.number() });
const run = z.object({
  dungeon: named,
  keystone_level: z.number().int(),
  completed_timestamp: z.number().int().optional(),
  duration: z.number().optional(),
  is_completed_within_time: z.boolean().optional(),
  mythic_rating: rating.optional(),
  map_rating: rating.optional(),
});

export const mythicProfile = z.object({
  character: id,
  current_mythic_rating: rating.optional(),
  current_period: z.object({
    period: id,
    best_runs: z.array(run).optional(),
  }).optional(),
  seasons: z.array(id).optional(),
});

export const mythicSeason = z.object({
  character: id,
  season: id,
  mythic_rating: rating.optional(),
  best_runs: z.array(run).optional(),
});

const matches = z.object({ played: z.number().int(), won: z.number().int(), lost: z.number().int() });

export const pvpSummary = z.object({
  character: id,
  honor_level: z.number().int(),
  honorable_kills: z.number().int().optional(),
  brackets: z.array(z.object({ href: z.string() })).optional(),
});

export const pvpBracket = z.object({
  character: id,
  rating: z.number().int(),
  season: id.optional(),
  tier: id.optional(),
  weekly_match_statistics: matches.optional(),
  season_match_statistics: matches.optional(),
});

export function page<T>(items: T[], offset: number, limit: number) {
  return {
    total: items.length,
    offset,
    limit,
    next_offset: offset + limit < items.length ? offset + limit : null,
    items: items.slice(offset, offset + limit),
  };
}
