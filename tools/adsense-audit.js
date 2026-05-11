const fs = require("fs");
const path = require("path");
const { SITE_URL } = require("./site-config");

const ROOT_DIR = path.resolve(__dirname, "..");
const ROOT_HTML = () => fs.readdirSync(ROOT_DIR).filter((file) => file.endsWith(".html"));
const oldDomainPattern = new RegExp(["dreamydecor", "ai"].join("\\."), "i");
const placeholderSlugPattern = new RegExp(["real", "lowercase", "kebab", "case", "topic"].join("-"), "i");
const stockScalePattern = new RegExp(["Check scale", "before you shop"].join(" "), "i");
const stockMaintenancePattern = new RegExp(["Think about maintenance", "as part of the design"].join(" "), "i");
const stockRepetitionPattern = new RegExp(["Use repetition", "to make the decision look deliberate"].join(" "), "i");
const conflictMarkerPattern = new RegExp(`^(${["<".repeat(7), "=".repeat(7), ">".repeat(7)].join("|")}) `, "m");
const BANNED_PATTERNS = [
  { label: "old-domain", pattern: oldDomainPattern },
  { label: "placeholder-slug", pattern: placeholderSlugPattern },
  { label: "stock-filler-scale", pattern: stockScalePattern },
  { label: "stock-filler-maintenance", pattern: stockMaintenancePattern },
  { label: "stock-filler-repetition", pattern: stockRepetitionPattern },
  { label: "merge-conflict-marker", pattern: conflictMarkerPattern },
];

const textFiles = (dir) => {
  const ignored = new Set([".git", "node_modules", ".wrangler", ".blog-generator-tmp", ".playwright-cli"]);
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...textFiles(fullPath));
    } else if (/\.(html|js|json|md|txt|xml|example|css)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), "utf8");
const publicPathToFile = (url) => {
  const parsed = new URL(url);
  if (parsed.origin !== SITE_URL) return "";
  if (parsed.pathname === "/") return "index.html";
  return `${parsed.pathname.replace(/^\/+/, "")}.html`;
};
const hasNoIndex = (html) => /<meta\s+name=["']robots["'][^>]*noindex/i.test(html);
const canonical = (html) => {
  const match = html.match(/<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  return match ? match[1] : "";
};

const failures = [];
const fail = (message) => failures.push(message);

for (const filePath of textFiles(ROOT_DIR)) {
  const rel = path.relative(ROOT_DIR, filePath);
  const content = fs.readFileSync(filePath, "utf8");
  for (const banned of BANNED_PATTERNS) {
    if (banned.pattern.test(content)) {
      fail(`${rel}: contains ${banned.label}`);
    }
  }
}

for (const file of ["robots.txt", "sitemap.xml", "ads.txt"]) {
  if (!fs.existsSync(path.join(ROOT_DIR, file))) {
    fail(`${file}: missing`);
    continue;
  }
  const content = read(file);
  if (/<!doctype html|<html[\s>]/i.test(content)) {
    fail(`${file}: contains HTML instead of crawler text/XML`);
  }
}

const sitemap = read("sitemap.xml");
const sitemapUrls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)).map((match) => match[1]);
if (sitemapUrls.length < 80 || sitemapUrls.length > 160) {
  fail(`sitemap.xml: expected cleaned blog inventory of 80-160 URLs, found ${sitemapUrls.length}`);
}

for (const loc of sitemapUrls) {
  const file = publicPathToFile(loc);
  if (!file || !fs.existsSync(path.join(ROOT_DIR, file))) {
    fail(`sitemap.xml: ${loc} does not map to an existing local HTML file`);
    continue;
  }

  const html = read(file);
  if (hasNoIndex(html)) fail(`${file}: sitemap page is noindexed`);
  if (canonical(html) !== loc) fail(`${file}: canonical "${canonical(html)}" does not match sitemap URL "${loc}"`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${file}: missing title`);
  if (!/<meta\s+name=["']description["'][^>]*content=["'][^"']{40,}["']/i.test(html)) {
    fail(`${file}: missing useful meta description`);
  }
  for (const policyLink of ["about-us.html", "contact-us.html", "privacy.html", "affiliate-disclosure.html"]) {
    if (!html.includes(policyLink)) fail(`${file}: missing footer/policy link ${policyLink}`);
  }
}

for (const file of ROOT_HTML()) {
  const html = read(file);
  if (file.startsWith("pick-") && !hasNoIndex(html)) fail(`${file}: product detail page should be noindex,follow`);
  if (file.startsWith("picks-") && file !== "picks.html" && !hasNoIndex(html)) {
    fail(`${file}: affiliate category page should be noindex,follow`);
  }
  if (file === "search.html" && !hasNoIndex(html)) fail("search.html: search page should be noindex,follow");
}

const blogHtml = read("blog.html");
for (const match of blogHtml.matchAll(/href=["']([^"']+\.html)["']/g)) {
  const href = match[1];
  if (href.startsWith("blog-") && !fs.existsSync(path.join(ROOT_DIR, href))) {
    fail(`blog.html: links to missing article ${href}`);
  }
}

if (failures.length) {
  console.error(`AdSense audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`AdSense audit passed: ${sitemapUrls.length} curated URLs, crawler files present, weak pages hidden.`);
