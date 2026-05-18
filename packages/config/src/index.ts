import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  API_PORT: z.coerce.number().default(3001),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DATABASE_URL: z.string().default("postgresql://localhost:5432/pulseguard"),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
