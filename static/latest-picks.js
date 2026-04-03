(function () {
  const IMAGE_FALLBACK = "https://placehold.co/600x400?text=Product+Image+Coming+Soon";
  const DEFAULT_LIMIT = 30;
  const ROOM_PAGES = [
    { room: "Living Room", roomPage: "picks-living.html", roomOrder: 1 },
    { room: "Bedroom", roomPage: "picks-bedroom.html", roomOrder: 2 },
    { room: "Outdoor", roomPage: "picks-outdoor.html", roomOrder: 3 },
    { room: "Small Wins", roomPage: "picks-small-wins.html", roomOrder: 4 },
  ];
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

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function readFallbackProducts() {
    if (!Array.isArray(window.DREAMY_DECOR_PRODUCTS)) {
      return new Map();
    }

    return new Map(
      window.DREAMY_DECOR_PRODUCTS.map((product) => {
        const rooms = Array.isArray(product.rooms) && product.rooms.length ? product.rooms : [product.room];

        return [
          product.url,
          {
            ...product,
            rooms,
            roomPages: Array.isArray(product.roomPages) && product.roomPages.length ? product.roomPages : [product.roomPage],
            addedAtMs: getTimestamp(product.addedAt),
          },
        ];
      }),
    );
  }

  async function fetchPage(url) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Request failed for ${url} with ${response.status}`);
    }

    return {
      html: await response.text(),
      lastModified: response.headers.get("last-modified") || "",
    };
  }

  async function fetchLastModified(url) {
    try {
      const headResponse = await fetch(url, {
        method: "HEAD",
        credentials: "same-origin",
        cache: "no-store",
      });

      if (headResponse.ok) {
        const lastModified = headResponse.headers.get("last-modified");
        if (lastModified) {
          return lastModified;
        }
      }
    } catch (error) {
      // Fall through to GET fallback.
    }

    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        return "";
      }

      return response.headers.get("last-modified") || "";
    } catch (error) {
      return "";
    }
  }

  function mergeRoomInfo(target, room, roomPage) {
    if (!target.rooms.includes(room)) {
      target.rooms.push(room);
    }

    if (!target.roomPages.includes(roomPage)) {
      target.roomPages.push(roomPage);
    }
  }

  function extractProductsFromRoomPage(page, roomConfig, fallbackProducts) {
    const doc = parseHtml(page.html);
    const cards = Array.from(doc.querySelectorAll("article.productCard"));
    const products = [];

    cards.forEach((card, cardIndex) => {
      const link = card.querySelector(".productCard__imgLink");
      const image = card.querySelector(".productCard__img");
      const title = card.querySelector(".productCard__t");
      const description = card.querySelector(".productCard__c");

      if (!link || !image || !title || !description) {
        return;
      }

      const url = link.getAttribute("href");
      if (!url) {
        return;
      }

      const fallback = fallbackProducts.get(url);

      products.push({
        title: title.textContent.trim(),
        description: description.textContent.trim(),
        url,
        image: image.getAttribute("src") || IMAGE_FALLBACK,
        room: roomConfig.room,
        rooms: fallback && Array.isArray(fallback.rooms) ? fallback.rooms.slice() : [roomConfig.room],
        roomPage: roomConfig.roomPage,
        roomPages:
          fallback && Array.isArray(fallback.roomPages) && fallback.roomPages.length
            ? fallback.roomPages.slice()
            : [roomConfig.roomPage],
        order: roomConfig.roomOrder,
        cardOrder: cardIndex,
        roomPageAddedAt: page.lastModified,
        addedAt: fallback ? fallback.addedAt : page.lastModified,
        addedAtMs: fallback && fallback.addedAtMs ? fallback.addedAtMs : getTimestamp(page.lastModified),
      });

      if (!products[products.length - 1].rooms.includes(roomConfig.room)) {
        products[products.length - 1].rooms.unshift(roomConfig.room);
      }
      if (!products[products.length - 1].roomPages.includes(roomConfig.roomPage)) {
        products[products.length - 1].roomPages.unshift(roomConfig.roomPage);
      }
    });

    return products;
  }

  async function loadProductsFromRoomPages(fallbackProducts) {
    const roomResults = await Promise.all(
      ROOM_PAGES.map(async (roomConfig) => {
        const page = await fetchPage(roomConfig.roomPage);
        return extractProductsFromRoomPage(page, roomConfig, fallbackProducts);
      }),
    );

    const productsByUrl = new Map();

    roomResults.flat().forEach((product) => {
      const existing = productsByUrl.get(product.url);
      if (existing) {
        mergeRoomInfo(existing, product.room, product.roomPage);
        existing.order = Math.min(existing.order, product.order);
        existing.cardOrder = Math.min(existing.cardOrder, product.cardOrder);
        return;
      }

      productsByUrl.set(product.url, product);
    });

    return Array.from(productsByUrl.values());
  }

  async function enrichWithLiveTimestamps(products, fallbackProducts) {
    return Promise.all(
      products.map(async (product) => {
        const lastModified = await fetchLastModified(product.url);
        const fallback = fallbackProducts.get(product.url);
        const addedAt =
          lastModified ||
          product.roomPageAddedAt ||
          product.addedAt ||
          (fallback ? fallback.addedAt : "") ||
          "";

        return {
          ...product,
          addedAt,
          addedAtMs: getTimestamp(addedAt),
        };
      }),
    );
  }

  function sortLatest(products) {
    return products.slice().sort((a, b) => {
      return (
        b.addedAtMs - a.addedAtMs ||
        a.order - b.order ||
        a.cardOrder - b.cardOrder ||
        a.title.localeCompare(b.title)
      );
    });
  }

  function formatAddedAt(value) {
    const timestamp = getTimestamp(value);
    if (!timestamp) {
      return "Added date unavailable";
    }

    return `Added ${DATE_FORMATTER.format(timestamp)}`;
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

  async function setupLatestPage() {
    const root = document.querySelector("[data-latest-page]");
    if (!root) {
      return;
    }

    const summary = root.querySelector("[data-latest-summary]");
    const results = root.querySelector("[data-latest-results]");
    const limit = Number.parseInt(root.getAttribute("data-max-products") || `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT;
    const fallbackProducts = readFallbackProducts();
    const hasServerRenderedResults = results && results.children.length > 0;

    if (!summary || !results) {
      return;
    }

    results.setAttribute("aria-busy", "true");
    if (!hasServerRenderedResults) {
      summary.textContent = "Loading the latest decor picks from the live room pages...";
    }

    let products = [];
    let usedFallback = false;

    try {
      const roomProducts = await loadProductsFromRoomPages(fallbackProducts);
      products = sortLatest(await enrichWithLiveTimestamps(roomProducts, fallbackProducts));
    } catch (error) {
      usedFallback = true;
      products = sortLatest(Array.from(fallbackProducts.values()));
    }

    const latestProducts = products.slice(0, limit);

    if (usedFallback && hasServerRenderedResults) {
      results.setAttribute("aria-busy", "false");
      return;
    }

    if (!products.length) {
      if (hasServerRenderedResults) {
        results.setAttribute("aria-busy", "false");
        return;
      }
      summary.textContent = "Latest products are unavailable right now.";
      results.innerHTML =
        '<article class="searchEmpty"><h2 class="searchEmpty__title">Latest picks unavailable</h2><p class="searchEmpty__copy">No live room-page products or fallback product index could be loaded.</p></article>';
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
