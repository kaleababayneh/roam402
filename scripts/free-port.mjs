#!/usr/bin/env node
/**
 * scripts/free-port.mjs — kill anything holding the dev ports, verify free.
 * Runs automatically before `pnpm dev` (predev hook). Ends the recurring
 * zombie-workerd problem: an orphaned workerd keeps the socket open,
 * accepts connections, and never answers — silently eating every client.
 */
import { execSync } from "node:child_process";

const PORTS = process.argv.slice(2).length ? process.argv.slice(2) : ["8787", "8988"];

for (const port of PORTS) {
  try {
    const out = execSync(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
    const pids = [...new Set(out.split("\n").filter(Boolean))];
    for (const pid of pids) {
      // Kill supervising ancestry first — wrangler dev respawns workerd, so
      // killing only the listener breeds immortal zombies.
      let target = pid;
      const chain = [pid];
      for (let up = 0; up < 3; up++) {
        try {
          const ppid = execSync(`ps -o ppid= -p ${target}`, { encoding: "utf8" }).trim();
          if (!ppid || ppid === "1") break;
          const cmd = execSync(`ps -o command= -p ${ppid}`, { encoding: "utf8" });
          if (/wrangler|workerd/.test(cmd)) {
            chain.push(ppid);
            target = ppid;
          } else break;
        } catch { break; }
      }
      for (const p of chain.reverse()) {
        try {
          execSync(`kill -9 ${p}`);
          console.log(`free-port: killed pid ${p} (chain for :${port})`);
        } catch { /* gone */ }
      }
    }
  } catch { /* nothing listening — good */ }
}

// Verify with patience: kill again + re-check for up to 5s — kernel socket
// release and workerd child teardown can lag the kill by a beat.
for (const port of PORTS) {
  let free = false;
  for (let i = 0; i < 10 && !free; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const holders = execSync(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
      for (const pid of new Set(holders.split("\n").filter(Boolean))) {
        try { execSync(`kill -9 ${pid}`); } catch { /* gone */ }
      }
    } catch {
      free = true;
    }
  }
  if (!free) {
    console.error(`free-port: :${port} STILL held after 5s of kills — investigate manually`);
    process.exit(1);
  }
}
console.log(`free-port: ${PORTS.map((p) => `:${p}`).join(" ")} clear`);
