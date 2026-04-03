const fs = require("fs");
const path = require("path");
const { collectProducts } = require("./generate-product-index");

const ROOT = path.resolve(__dirname, "..");
const PICKS_LATEST_FILE = path.join(ROOT, "picks-latest.html");
const MAX_PRODUCTS = 30;
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatAddedAt(value) {
  const timestamp = getTimestamp(value);
  if (!timestamp) {
    return "Added date unavailable";
  }

  return `Added ${DATE_FORMATTER.format(timestamp)}`;
}

function sortLatest(products) {
  return products.slice().sort((a, b) => {
    return (
      getTimestamp(b.addedAt) - getTimestamp(a.addedAt) ||
      a.order - b.order ||
      a.title.localeCompare(b.title)
    );
  });
}

function renderProductCard(product) {
  const title = escapeHtml(product.title);
  const description = escapeHtml(product.description);
  const roomDisplay = escapeHtml((product.rooms || [product.room]).join(" / "));
  const roomLabel = escapeHtml(
    Array.isArray(product.roomPages) && product.roomPages.length > 1
      ? "Browse Related Picks"
      : `Browse ${product.room}`,
  );

  return `        <article class="productCard">
          <a class="productCard__imgLink" href="${escapeHtml(product.url)}" aria-label="View ${title}">
            <img class="productCard__img" src="${escapeHtml(product.image)}" alt="${title} product photo" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/600x400?text=Product+Image+Coming+Soon'" />
          </a>
          <div class="productCard__body">
            <div class="productCard__top">
              <div class="productCard__t">${title}</div>
              <div class="productCard__price">${escapeHtml(formatAddedAt(product.addedAt))}</div>
            </div>
            <p class="productCard__c">${description}</p>
            <div class="finePrint">Room: ${roomDisplay}</div>
            <div class="productCard__a">
              <a class="btn" href="${escapeHtml(product.roomPage)}">${roomLabel}</a>
              <a class="btn btn--primary" href="${escapeHtml(product.url)}">View Product</a>
            </div>
          </div>
        </article>`;
}

function renderGeneratedBlock(products) {
  const latestProducts = sortLatest(products).slice(0, MAX_PRODUCTS);
  const summary =
    products.length > MAX_PRODUCTS
      ? `Showing the newest ${MAX_PRODUCTS} of ${products.length} decor picks. When a new product is added, the oldest item drops off this page.`
      : `Showing all ${products.length} decor picks. This page will cap itself at ${MAX_PRODUCTS} products as the catalog grows.`;

  return `      <!-- latest-generated:start -->
      <p class="searchSummary" data-latest-summary>${escapeHtml(summary)}</p>
      <div class="cardGrid" data-latest-results aria-live="polite" aria-busy="false">
${latestProducts.map(renderProductCard).join("\n")}
      </div>
      <!-- latest-generated:end -->`;
}

function writeLatestPicksPage() {
  const products = collectProducts();
  const html = fs.readFileSync(PICKS_LATEST_FILE, "utf8");
  const generatedBlock = renderGeneratedBlock(products);
  const markerPattern = / {6}<!-- latest-generated:start -->[\s\S]*? {6}<!-- latest-generated:end -->/;

  if (!markerPattern.test(html)) {
    throw new Error("Could not find latest-generated markers in picks-latest.html");
  }

  const updatedHtml = html.replace(markerPattern, generatedBlock);

  fs.writeFileSync(PICKS_LATEST_FILE, updatedHtml, "utf8");
  return { outputFile: PICKS_LATEST_FILE, count: Math.min(products.length, MAX_PRODUCTS), total: products.length };
}

if (require.main === module) {
  const result = writeLatestPicksPage();
  console.log(
    `Wrote ${result.count} latest products (${result.total} total picks) to ${path.relative(ROOT, result.outputFile)}`,
  );
}

module.exports = {
  writeLatestPicksPage,
};
