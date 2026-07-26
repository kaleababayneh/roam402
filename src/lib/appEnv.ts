/** App-wide Hono env: per-request correlation id, set by the rid middleware
 *  in index.ts and read anywhere a log line or error needs it. */
export type AppEnv = { Variables: { rid: string } };
