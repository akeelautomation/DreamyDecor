(function () {
  const SEARCH_PATH = "search.html";
  const QUERY_PARAM = "q";
  const IMAGE_FALLBACK = "https://placehold.co/600x400?text=Product+Image+Coming+Soon";
  const ROOM_ORDER = {
    "Living Room": 1,
    Bedroom: 2,
    Outdoor: 3,
    "Small Wins": 4,
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getCurrentQuery() {
    return new URLSearchParams(window.location.search).get(QUERY_PARAM) || "";
  }

  function syncSearchInputs(value) {
    document.querySelectorAll('input[name="q"]').forEach((input) => {
      if (input.value !== value) {
        input.value = value;
      }
    });
  }

  function buildHeaderSearch() {
    const header = document.querySelector(".top");
    const brand = header && header.querySelector(".brand");
    const nav = header && header.querySelector(".nav");

    if (!header || !brand || !nav || header.querySelector(".siteSearch")) {
      return;
    }

    const aside = document.createElement("div");
    aside.className = "top__aside";

    const form = document.createElement("form");
    form.className = "siteSearch";
    form.method = "get";
    form.action = SEARCH_PATH;
    form.setAttribute("role", "search");
    form.setAttribute("aria-label", "Search Dreamy Decor products");
    form.innerHTML =
      '<label class="srOnly" for="siteSearchInput">Search Dreamy Decor products</label>' +
      '<input id="siteSearchInput" class="siteSearch__input" type="search" name="q" placeholder="Search products" autocomplete="off" />' +
      '<button class="siteSearch__btn" type="submit">Search</button>';

    aside.appendChild(form);
    aside.appendChild(nav);
    header.appendChild(aside);

    syncSearchInputs(getCurrentQuery());
  }

  function hydrateProducts() {
    if (!Array.isArray(window.DREAMY_DECOR_PRODUCTS)) {
      return [];
    }

    return window.DREAMY_DECOR_PRODUCTS.map((product) => {
      const rooms = Array.isArray(product.rooms) && product.rooms.length ? product.rooms : [product.room];
      const titleKey = normalize(product.title);
      const descriptionKey = normalize(product.description);
      const roomKey = normalize(rooms.join(" "));

      return {
        ...product,
        rooms,
        titleKey,
        descriptionKey,
        roomKey,
        searchKey: `${titleKey} ${roomKey} ${descriptionKey}`.trim(),
      };
    });
  }

  function searchProducts(products, query) {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
      return products
        .slice()
        .sort(
          (a, b) =>
            (ROOM_ORDER[a.room] || 99) - (ROOM_ORDER[b.room] || 99) || a.title.localeCompare(b.title),
        );
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return products
      .filter((product) => terms.every((term) => product.searchKey.includes(term)))
      .map((product) => {
        let score = 0;

        if (product.titleKey.includes(normalizedQuery)) score += 220;
        if (product.roomKey.includes(normalizedQuery)) score += 80;
        if (product.searchKey.includes(normalizedQuery)) score += 40;

        for (const term of terms) {
          if (product.titleKey.startsWith(term)) score += 30;
          if (product.titleKey.includes(term)) score += 18;
          if (product.roomKey.includes(term)) score += 8;
          if (product.descriptionKey.includes(term)) score += 4;
        }

        return { product, score };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          (ROOM_ORDER[a.product.room] || 99) - (ROOM_ORDER[b.product.room] || 99) ||
          a.product.title.localeCompare(b.product.title),
      )
      .map(({ product }) => product);
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

    return `
      <article class="productCard">
        <a class="productCard__imgLink" href="${escapeHtml(product.url)}" aria-label="View ${title}">
          <img class="productCard__img" src="${escapeHtml(product.image)}" alt="${title} product photo" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.src='${IMAGE_FALLBACK}'" />
        </a>
        <div class="productCard__body">
          <div class="productCard__top">
            <div class="productCard__t">${title}</div>
            <div class="productCard__price">${roomDisplay}</div>
          </div>
          <p class="productCard__c">${description}</p>
          <div class="productCard__a">
            <a class="btn" href="${escapeHtml(product.roomPage)}">${roomLabel}</a>
            <a class="btn btn--primary" href="${escapeHtml(product.url)}">View Product</a>
          </div>
        </div>
      </article>
    `;
  }

  function setupSearchPage() {
    const root = document.querySelector("[data-search-page]");
    if (!root) {
      return;
    }

    const form = root.querySelector("[data-search-form]");
    const input = root.querySelector("[data-search-input]");
    const summary = root.querySelector("[data-search-summary]");
    const results = root.querySelector("[data-search-results]");
    const products = hydrateProducts();

    if (!form || !input || !summary || !results) {
      return;
    }

    function render(query) {
      const trimmedQuery = query.trim();
      const matches = searchProducts(products, trimmedQuery);
      results.setAttribute("aria-busy", "true");

      if (!products.length) {
        summary.textContent = "Product search is unavailable right now.";
        results.innerHTML =
          '<article class="searchEmpty"><h2 class="searchEmpty__title">Search index missing</h2><p class="searchEmpty__copy">The products-only search index was not loaded, so no results can be shown.</p></article>';
        results.setAttribute("aria-busy", "false");
        return;
      }

      if (trimmedQuery) {
        const label = matches.length === 1 ? "result" : "results";
        summary.textContent = `${matches.length} product ${label} for "${trimmedQuery}"`;
      } else {
        summary.textContent = `Showing all ${products.length} decor picks.`;
      }

      if (!matches.length) {
        results.innerHTML =
          '<article class="searchEmpty"><h2 class="searchEmpty__title">No matching products</h2><p class="searchEmpty__copy">Try a broader product word like chair, mirror, dresser, shelf, or patio.</p></article>';
        results.setAttribute("aria-busy", "false");
        return;
      }

      results.innerHTML = matches.map(renderProductCard).join("");
      results.setAttribute("aria-busy", "false");
    }

    function updateUrl(query) {
      const url = new URL(window.location.href);
      if (query) {
        url.searchParams.set(QUERY_PARAM, query);
      } else {
        url.searchParams.delete(QUERY_PARAM);
      }
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = input.value.trim();
      updateUrl(query);
      syncSearchInputs(query);
      render(query);
    });

    input.addEventListener("search", () => {
      const query = input.value.trim();
      updateUrl(query);
      syncSearchInputs(query);
      render(query);
    });

    root.querySelectorAll("[data-search-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const query = chip.getAttribute("data-search-chip") || "";
        input.value = query;
        updateUrl(query);
        syncSearchInputs(query);
        render(query);
      });
    });

    const initialQuery = getCurrentQuery().trim();
    input.value = initialQuery;
    syncSearchInputs(initialQuery);
    render(initialQuery);
  }

  buildHeaderSearch();
  setupSearchPage();
})();
