(function () {
  const IMAGE_FALLBACK = "https://placehold.co/600x400?text=Product+Image+Coming+Soon";
  const DEFAULT_LIMIT = 30;
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

  function readProducts() {
    if (!Array.isArray(window.DREAMY_DECOR_PRODUCTS)) {
      return [];
    }

    return window.DREAMY_DECOR_PRODUCTS.map((product) => {
      const rooms = Array.isArray(product.rooms) && product.rooms.length ? product.rooms : [product.room];
      const addedAtMs = Date.parse(product.addedAt || "") || 0;

      return {
        ...product,
        rooms,
        addedAtMs,
      };
    });
  }

  function formatAddedAt(value) {
    const timestamp = Date.parse(value || "");
    if (!timestamp) {
      return "Added date unavailable";
    }

    return `Added ${DATE_FORMATTER.format(timestamp)}`;
  }

  function sortLatest(products) {
    return products.slice().sort((a, b) => {
      return (
        b.addedAtMs - a.addedAtMs ||
        (a.order || 99) - (b.order || 99) ||
        a.title.localeCompare(b.title)
      );
    });
  }

  function renderProductCard(product) {
    const title = escapeHtml(product.title);
    const description = escapeHtml(product.description);
    const roomDisplay = escapeHtml(product.rooms.join(" / "));
    const roomLabel = escapeHtml(
      Array.isArray(product.roomPages) && product.roomPages.length > 1
        ? "Browse Related Picks"
        : `Browse ${product.room}`,
    );

    return `
      <article class="productCard">
        <a class="productCard__imgLink" href="${escapeHtml(product.url)}" aria-label="View ${title}">
          <img class="productCard__img" src="${escapeHtml(product.image)}" alt="${title} product photo" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.src='${IMAGE_FALLBACK}'" />
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
      </article>
    `;
  }

  function setupLatestPage() {
    const root = document.querySelector("[data-latest-page]");
    if (!root) {
      return;
    }

    const summary = root.querySelector("[data-latest-summary]");
    const results = root.querySelector("[data-latest-results]");
    const limit = Number.parseInt(root.getAttribute("data-max-products") || `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT;
    const products = sortLatest(readProducts());
    const latestProducts = products.slice(0, limit);

    if (!summary || !results) {
      return;
    }

    results.setAttribute("aria-busy", "true");

    if (!products.length) {
      summary.textContent = "Latest products are unavailable right now.";
      results.innerHTML =
        '<article class="searchEmpty"><h2 class="searchEmpty__title">Latest picks unavailable</h2><p class="searchEmpty__copy">The product index was not loaded, so the latest products page cannot be built yet.</p></article>';
      results.setAttribute("aria-busy", "false");
      return;
    }

    if (products.length > limit) {
      summary.textContent = `Showing the newest ${limit} of ${products.length} decor picks. When a new product is added, the oldest item drops off this page.`;
    } else {
      summary.textContent = `Showing all ${products.length} decor picks. This page will cap itself at ${limit} products as the catalog grows.`;
    }

    results.innerHTML = latestProducts.map(renderProductCard).join("");
    results.setAttribute("aria-busy", "false");
  }

  setupLatestPage();
})();
