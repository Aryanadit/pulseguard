import { z } from "zod";

export const RateLimitEventSchema = z.object({
  timestamp: z.coerce.number().int().positive(),
  identifier: z.string().min(1),
  endpoint: z.string().min(1),
  tier: z.string().min(1),
  allowed: z.union([z.boolean(), z.string()]).transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    return value === "true";
  }),
  remaining: z.coerce.number().int().nonnegative(),
  latencyMs: z.coerce.number().nonnegative(),
});

export type RateLimitEvent = z.infer<typeof RateLimitEventSchema>;

export function validateRateLimitEvent(data: unknown): RateLimitEvent {
  return RateLimitEventSchema.parse(data);
}
