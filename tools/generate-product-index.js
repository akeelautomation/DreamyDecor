const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_FILE = path.join(ROOT, "static", "product-index.js");
const PICK_PAGES = [
  { file: "picks-living.html", room: "Living Room", roomPage: "picks-living.html", order: 1 },
  { file: "picks-bedroom.html", room: "Bedroom", roomPage: "picks-bedroom.html", order: 2 },
  { file: "picks-outdoor.html", room: "Outdoor", roomPage: "picks-outdoor.html", order: 3 },
  { file: "picks-small-wins.html", room: "Small Wins", roomPage: "picks-small-wins.html", order: 4 },
];

function resolveLocalPagePath(url) {
  return path.join(ROOT, String(url || "").split(/[?#]/, 1)[0]);
}

function getAddedAt(url, fallbackFile) {
  const candidates = [resolveLocalPagePath(url), path.join(ROOT, fallbackFile)];

  for (const candidate of candidates) {
    try {
      const stats = fs.statSync(candidate);
      const preferredDate =
        Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime;
      return preferredDate.toISOString();
    } catch (error) {
      // Try the next fallback path.
    }
  }

  return null;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value) {
  return decodeEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extract(pattern, block, fieldName, fileName) {
  const match = block.match(pattern);
  if (!match) {
    throw new Error(`Could not find ${fieldName} in ${fileName}`);
  }
  return cleanText(match[1]);
}

function extractAttr(pattern, block, fieldName, fileName) {
  const match = block.match(pattern);
  if (!match) {
    throw new Error(`Could not find ${fieldName} in ${fileName}`);
  }
  return match[1].trim();
}

function collectProducts() {
  const productsByUrl = new Map();

  for (const page of PICK_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, page.file), "utf8");
    const matches = html.matchAll(/<article class="productCard">([\s\S]*?)<\/article>/g);

    for (const [_, block] of matches) {
      const url = extractAttr(/<a class="productCard__imgLink" href="([^"]+)"/, block, "product url", page.file);
      const image = extractAttr(/<img class="productCard__img" src="([^"]+)"/, block, "product image", page.file);
      const title = extract(/<div class="productCard__t">([\s\S]*?)<\/div>/, block, "product title", page.file);
      const description = extract(/<p class="productCard__c">\s*([\s\S]*?)\s*<\/p>/, block, "product description", page.file);

      const existing = productsByUrl.get(url);
      if (existing) {
        if (!existing.rooms.includes(page.room)) {
          existing.rooms.push(page.room);
        }
        if (!existing.roomPages.includes(page.roomPage)) {
          existing.roomPages.push(page.roomPage);
        }
        existing.order = Math.min(existing.order, page.order);
        continue;
      }

      productsByUrl.set(url, {
        title,
        description,
        url,
        image,
        addedAt: getAddedAt(url, page.file),
        room: page.room,
        rooms: [page.room],
        roomPage: page.roomPage,
        roomPages: [page.roomPage],
        order: page.order,
      });
    }
  }

  return Array.from(productsByUrl.values());
}

function writeProductIndex() {
  const products = collectProducts();
  const fileContents = `window.DREAMY_DECOR_PRODUCTS = ${JSON.stringify(products, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_FILE, fileContents, "utf8");
  return { outputFile: OUTPUT_FILE, count: products.length };
}

if (require.main === module) {
  const result = writeProductIndex();
  console.log(`Wrote ${result.count} products to ${path.relative(ROOT, result.outputFile)}`);
}

module.exports = {
  collectProducts,
  writeProductIndex,
};
