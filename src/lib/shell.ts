/**
 * src/lib/shell.ts — the chrome every non-landing page shares.
 *
 * The landing and marketplace each grew their own copy of the head/nav/footer;
 * this is the one new pages use so a third copy does not appear. Deliberately
 * plain: the compiled Tailwind sheet and fonts are already served from /public,
 * so a page only needs to fill in the body.
 */

export interface ShellOptions {
  title: string;
  description: string;
  /** Absolute path of this page, for canonical + og:url (e.g. "/blog"). */
  path: string;
  /** cfg.publicBaseUrl — "" omits absolute URLs rather than emitting bad ones. */
  baseUrl?: string;
  /** Nav item to highlight. */
  active?: "marketplace" | "blog";
  /** Extra <head> markup (page-specific styles). */
  head?: string;
  body: string;
}

const BTN =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium hover:-translate-y-0.5 transition-all duration-300";

const ICON_MENU = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;

const navLink = (href: string, label: string, on: boolean): string =>
  `<li class="text-sm font-medium link"><a${on ? ` class="rx-accent"` : ""} href="${href}">${label}</a></li>`;

export function shell(o: ShellOptions): string {
  const base = o.baseUrl ?? "";
  const url = base ? `${base}${o.path}` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${o.title}</title>
<meta name="description" content="${o.description}"/>
<meta name="robots" content="index, follow"/>
<meta name="theme-color" content="#f4f5fb"/>
<meta property="og:title" content="${o.title}"/>
<meta property="og:description" content="${o.description}"/>
<meta property="og:site_name" content="Roam402"/>
<meta property="og:type" content="article"/>
${url ? `<meta property="og:url" content="${url}"/>` : ""}
<meta property="og:image" content="${base}/icons/banner.png"/>
<meta name="twitter:card" content="summary_large_image"/>
${url ? `<link rel="canonical" href="${url}"/>` : ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="icon" href="/favicon.ico" sizes="32x32"/>
<link rel="apple-touch-icon" href="/icons/icon.png"/>
<link rel="preload" href="/fonts/12084922609e6532-s.p.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="preload" href="/fonts/22539d17f3707926-s.p.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="stylesheet" href="/css/landing.css"/>
${o.head ?? ""}
</head>
<body class="min-h-screen bg-background text-foreground antialiased font-heading overflow-x-hidden __variable_f367f3 __variable_b44e54 __variable_315a98">

<header class="sticky top-0 w-full h-16 bg-background/80 backdrop-blur-sm z-50">
  <div class="w-full mx-auto lg:max-w-screen-xl lg:mx-auto px-4 md:px-12 h-full">
    <div class="flex items-center justify-between h-full">
      <div class="flex items-center">
        <a class="flex items-center gap-2" href="/">
          <img src="/icons/roam402.svg" alt="Roam402" width="26" height="26"/>
          <span class="text-xl font-semibold">roam<span class="rx-accent">402</span></span>
        </a>
      </div>
      <div class="hidden lg:flex items-center gap-4">
        <ul class="flex items-center gap-8">
          ${navLink("/#how", "How it works", false)}
          ${navLink("/marketplace", "Marketplace", o.active === "marketplace")}
          ${navLink("/blog", "Blog", o.active === "blog")}
          ${navLink("/llms.txt", "Agent spec", false)}
        </ul>
      </div>
      <div class="flex items-center gap-4">
        <a class="hidden lg:block" href="/playground">
          <button class="${BTN} bg-primary text-primary-foreground hover:opacity-70 hover:ring-4 hover:ring-primary/10 h-9 px-4 py-2">Open playground</button>
        </a>
        <button id="menu-btn" aria-label="Menu" aria-expanded="false" class="${BTN} hover:bg-white/10 hover:text-accent-foreground h-8 w-8 lg:hidden" type="button">${ICON_MENU}</button>
      </div>
    </div>
  </div>
</header>
<div id="m-menu" class="rx-menu lg:hidden">
  <a href="/#how">How it works</a>
  <a href="/marketplace">Marketplace</a>
  <a href="/blog">Blog</a>
  <a href="/playground">Playground</a>
  <a href="/llms.txt">Agent spec</a>
</div>

${o.body}

<footer class="footer flex flex-col relative items-center justify-center border-t border-foreground/5 pb-8 px-6 lg:px-8 w-full max-w-6xl mx-auto lg:pt-12 pt-8 gap-4">
  <div class="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
    <a class="link" href="/marketplace">Marketplace</a>
    <a class="link" href="/blog">Blog</a>
    <a class="link" href="/catalog">Catalog JSON</a>
    <a class="link" href="/playground">Playground</a>
    <a class="link" href="/receipts">Receipts</a>
    <a class="link" href="/llms.txt">llms.txt</a>
  </div>
  <p class="text-sm text-muted-foreground md:mt-0 text-center">© 2026 Roam402 · built by <a class="rx-accent" href="https://agents-trust.ai">Agents-Trust</a></p>
</footer>

<script>
(function () {
  var btn = document.getElementById("menu-btn");
  var menu = document.getElementById("m-menu");
  if (btn && menu) {
    btn.addEventListener("click", function () {
      btn.setAttribute("aria-expanded", menu.classList.toggle("open") ? "true" : "false");
    });
  }
})();
</script>
</body>
</html>`;
}
