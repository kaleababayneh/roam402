/**
 * Recapture public/images/dashboard.png from the live agents-trust.com
 * observatory so the landing's "live data" preview stays honest.
 *
 *   pnpm landing:capture
 *
 * Drives the locally installed Chrome via puppeteer-core (devDependency,
 * no bundled browser). Set CHROME_PATH to override the binary location.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const puppeteer = await import("puppeteer-core").then(
  (m) => m.default,
  () => {
    console.error("puppeteer-core missing — run: pnpm add -Dw puppeteer-core");
    process.exit(1);
  }
);

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../public/images/dashboard.png");
const profile = mkdtempSync(join(tmpdir(), "roam402-capture-"));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profile,
  args: ["--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
  await page.goto("https://agents-trust.com", { waitUntil: "networkidle2", timeout: 45_000 });
  await new Promise((r) => setTimeout(r, 3000)); // charts + tickers settle
  const raw = OUT + ".2x.png";
  await page.screenshot({ path: raw });
  execFileSync("sips", ["--resampleWidth", "1920", raw, "--out", OUT], { stdio: "ignore" });
  rmSync(raw, { force: true });
  console.log("captured →", OUT);
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
