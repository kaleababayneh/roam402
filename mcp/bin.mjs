#!/usr/bin/env node
// Published entrypoint — runs the TS source via tsx (dev) or dist (when built).
import "tsx/esm";
await import("./src/index.ts");
