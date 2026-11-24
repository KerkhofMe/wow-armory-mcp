import * as z from 'zod/v4';

const id = z.object({ id: z.number().int() });
const named = id.extend({ name: z.string() });
const typeLabel = z.object({ type: z.string(), name: z.string() });
const selfLink = z.object({ self: z.object({ href: z.string() }) });

export const summary = z.object({
  id: z.number().int(),
  name: z.string(),
  surname: z.string(),
  level: z.number().int(),
  ruleset: named,
  race: named.optional(),
  character_class: named.optional(),
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
  _links: selfLink,
  mounts: z.array(z.object({
    mount: named,
    is_favorite: z.boolean().optional(),
  })).default([]),
});

export const pets = z.object({
  _links: selfLink,
  pets: z.array(z.object({
    id: z.number().int().optional(),
    species: named,
    name: z.string().optional(),
    level: z.number().int().optional(),
    quality: typeLabel.optional(),
    is_favorite: z.boolean().optional(),
  })).default([]),
});

export const talents = z.object({
  character: id,
  specialization_groups: z.array(z.object({
    is_active: z.boolean(),
    specializations: z.array(z.object({
      specialization: named,
      spent_points: z.number().int(),
      talents: z.array(z.object({ talent: named, talent_rank: z.number().int() })),
    })).default([]),
  })),
});

const matches = z.object({ played: z.number().int(), won: z.number().int(), lost: z.number().int() });

export const pvpSummary = z.object({
  character: id,
  honorable_kills: z.number().int(),
  pvp_rank: z.number().int(),
  pvp_map_statistics: z.array(z.object({
    world_map: named,
    match_statistics: matches,
  })).optional(),
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
