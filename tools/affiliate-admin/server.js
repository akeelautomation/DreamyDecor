const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const PICKS_PATH = path.join(ROOT_DIR, "picks.html");
const SITE_URL = "https://dreamydecor.ai";
const STUDIO_URL = "https://dreamydecor.pages.dev/studio";
const PORT = Number(process.env.PORT || 4311);

const AMAZON_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

const SECTION_FALLBACKS = [
  { id: "bedroom", keywords: ["nightstand", "dresser", "bed", "wardrobe", "armoire"] },
  { id: "kitchen", keywords: ["bar stool", "stool", "dining", "kitchen", "buffet", "cabinet", "cart"] },
  { id: "lighting", keywords: ["lamp", "light", "lighting", "chandelier", "pendant", "lantern", "sconce"] },
  { id: "rugs", keywords: ["rug", "runner"] },
  { id: "outdoor", keywords: ["outdoor", "patio", "bistro", "rocking chair"] },
  {
    id: "decor",
    keywords: ["mirror", "wall art", "art set", "vase", "basket", "macrame", "decor", "hanging"],
  },
  { id: "small", keywords: ["organizer", "hamper", "pedestal", "entryway", "console table", "side table"] },
  {
    id: "living",
    keywords: ["bookshelf", "sofa", "chair", "coffee table", "tv stand", "bean bag", "sectional"],
  },
];

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeJson(value) {
  return JSON.stringify(value, null, 8).replace(/<\/script/gi, "<\\/script");
}

function toAsciiText(value) {
  return String(value ?? "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

function decodeHtml(value) {
  if (!value) {
    return "";
  }

  const named = {
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lt: "<",
    gt: ">",
    mdash: "-",
    ndash: "-",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    trade: "TM",
    reg: "(R)",
    copy: "(C)",
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, token) => {
    if (token[0] === "#") {
      const isHex = token[1]?.toLowerCase() === "x";
      const codePoint = parseInt(token.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    }

    return Object.prototype.hasOwnProperty.call(named, token) ? named[token] : _;
  });
}

function stripTags(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
}

function cleanText(value) {
  return toAsciiText(decodeHtml(stripTags(value || "")))
    .replace(/[\u3010\u3011]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function toSentenceCase(value) {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function normalizeInchCopy(value) {
  return value
    .replace(/(\d+)\s*Inch\b/gi, "$1-inch")
    .replace(/(\d+)\s*Inches\b/gi, "$1-inch")
    .replace(/\bTV\b/g, "TV");
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  const short = value.slice(0, maxLength - 1);
  const lastSpace = short.lastIndexOf(" ");
  return `${short.slice(0, Math.max(lastSpace, 0))}...`;
}

function titleFromAmazonTitle(fullTitle, brand) {
  const primary = cleanText(fullTitle).split(",")[0] || cleanText(fullTitle);
  const normalized = normalizeInchCopy(primary).replace(/\s+/g, " ").trim();

  if (!brand) {
    return normalized;
  }

  const brandPattern = new RegExp(`^${escapeRegExp(brand)}\\s+`, "i");
  const withoutBrand = normalized.replace(brandPattern, "").trim();
  return withoutBrand ? `${brand} ${withoutBrand}` : normalized;
}

function normalizeBrand(rawBrand, fullTitle) {
  const cleaned = cleanText(rawBrand).replace(/^Visit the\s+/i, "").replace(/\s+Store$/i, "").replace(/^Brand:\s*/i, "").trim();
  if (cleaned) {
    return cleaned;
  }

  return cleanText(fullTitle).split(/\s+/).slice(0, 2).join(" ");
}

function normalizeBulletCopy(value) {
  const text = cleanText(value);
  const hardStarts = ["This", "More than", "Constructed", "Built", "Use", "With its", "Designed", "Made"];

  for (const start of hardStarts) {
    const normalized = text.replace(new RegExp(`^[^.!?]{0,48}\\b(${escapeRegExp(start)})\\b`, "i"), "$1");
    if (normalized !== text) {
      return toSentenceCase(normalized.trim());
    }
  }

  const markers = ["This", "The", "More than", "Constructed", "Built", "Use", "With its", "Designed", "Made"];

  for (const marker of markers) {
    const match = new RegExp(`\\b${escapeRegExp(marker)}\\b`, "i").exec(text);
    const index = match?.index ?? -1;
    if (index <= 0 || index > 56) {
      continue;
    }

    const prefix = text.slice(0, index).trim();
    if (!/[.!?]/.test(prefix) && prefix.split(/\s+/).length <= 8) {
      return toSentenceCase(text.slice(index).trim());
    }
  }

  return text;
}

function chooseBestBullets(bullets) {
  return bullets
    .map((bullet) => normalizeBulletCopy(bullet))
    .filter(Boolean)
    .filter((bullet) => bullet.length > 35)
    .filter((bullet) => !/^\d/.test(bullet))
    .slice(0, 4);
}

function deriveSummary(bullets, shortTitle) {
  const firstBullet = bullets[0];
  if (firstBullet) {
    return truncate(toSentenceCase(firstBullet), 170);
  }

  return `${shortTitle} with affiliate-ready product details and Pinterest-friendly metadata.`;
}

function deriveCardCopy(bullets, shortTitle) {
  const candidate = bullets.find((bullet) => !/^\d/.test(bullet)) || bullets[0];
  if (candidate) {
    return truncate(toSentenceCase(candidate), 165);
  }

  return `A practical ${shortTitle.toLowerCase()} pick for updated spaces and cleaner styling decisions.`;
}

function deriveMetaDescription(shortTitle, cardCopy) {
  return truncate(`Affiliate pick: ${shortTitle}. ${cardCopy}`, 158);
}

function deriveStudioCopy(shortTitle) {
  return "Upload your space and preview how this piece fits your layout before you buy.";
}

function normalizeMoneyValue(value) {
  const match = String(value ?? "").match(/([0-9][0-9,]*)(?:\.([0-9]{1,2}))?/);
  if (!match) {
    return "";
  }

  const dollars = match[1].replace(/,/g, "");
  const cents = (match[2] || "00").padEnd(2, "0").slice(0, 2);
  return `${dollars}.${cents}`;
}

function extractMoney(html) {
  const scopedAnchors = [
    'id="corePriceDisplay_desktop_feature_div"',
    'id="corePrice_feature_div"',
    'id="apex_desktop"',
    'id="desktop_buybox"',
    'id="corePrice_mobile_feature_div"',
  ];

  const scopedPatterns = [
    /class="[^"]*\b(?:priceToPay|apex-price-to-pay-value|apex-pricetopay-value)\b[^"]*"[\s\S]*?<span class="a-offscreen">\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
    /class="[^"]*\b(?:priceToPay|apex-price-to-pay-value|apex-pricetopay-value)\b[^"]*"[\s\S]*?<span class="a-price-whole">([0-9][0-9,]*)<span class="a-price-decimal">\.<\/span><\/span>\s*<span class="a-price-fraction">([0-9]{2})/i,
    /<span id="apex-pricetopay-accessibility-label"[^>]*>\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
    /<span class="a-offscreen">\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  ];

  for (const anchor of scopedAnchors) {
    const index = html.indexOf(anchor);
    if (index < 0) {
      continue;
    }

    const slice = html.slice(index, index + 20000);
    for (const pattern of scopedPatterns) {
      const match = slice.match(pattern);
      if (!match) {
        continue;
      }

      const value = match[2] ? `${match[1]}.${match[2]}` : match[1];
      const normalized = normalizeMoneyValue(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  const fallbackPatterns = [
    /class="[^"]*\b(?:priceToPay|apex-price-to-pay-value|apex-pricetopay-value)\b[^"]*"[\s\S]*?<span class="a-offscreen">\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
    /class="[^"]*\b(?:priceToPay|apex-price-to-pay-value|apex-pricetopay-value)\b[^"]*"[\s\S]*?<span class="a-price-whole">([0-9][0-9,]*)<span class="a-price-decimal">\.<\/span><\/span>\s*<span class="a-price-fraction">([0-9]{2})/i,
    /<span id="apex-pricetopay-accessibility-label"[^>]*>\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
    /id="priceblock_(?:our|deal|sale|pospromoprice)"[^>]*>\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
    /"priceAmount"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/i,
    /"displayPrice"\s*:\s*"\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"/i,
    /"buyingPrice"\s*:\s*"\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"/i,
  ];

  for (const pattern of fallbackPatterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const value = match[2] ? `${match[1]}.${match[2]}` : match[1];
    const normalized = normalizeMoneyValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function extractAvailability(html) {
  const match =
    html.match(/<div id="availability"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i) ||
    html.match(/<div id="availabilityInsideBuyBox_feature_div"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);

  const text = cleanText(match?.[1] || "").toLowerCase();
  return text.includes("currently unavailable") || text.includes("out of stock") ? "OutOfStock" : "InStock";
}

function extractImageSize(url) {
  const square = url.match(/_SL(\d+)_/i);
  if (square) {
    return { width: square[1], height: square[1] };
  }

  return { width: "", height: "" };
}

function normalizeImageUrls(input) {
  const values = Array.isArray(input) ? input : [input];
  const cleaned = [];

  for (const value of values) {
    for (const part of String(value ?? "").split(/\r?\n/)) {
      const url = part.trim();
      if (!url || cleaned.includes(url)) {
        continue;
      }

      cleaned.push(url);
    }
  }

  return cleaned;
}

function inferSectionId(productText, sectionIds) {
  const haystack = productText.toLowerCase();
  const available = new Set(sectionIds);

  for (const fallback of SECTION_FALLBACKS) {
    if (!available.has(fallback.id)) {
      continue;
    }

    if (fallback.keywords.some((keyword) => haystack.includes(keyword))) {
      return fallback.id;
    }
  }

  return available.has("small") ? "small" : sectionIds[0] || "small";
}

function extractAmazonPathInfo(urlString) {
  const url = new URL(urlString);
  const parts = url.pathname.split("/").filter(Boolean);
  const dpIndex = parts.findIndex((part) => part.toLowerCase() === "dp");
  const gpIndex = parts.findIndex((part) => part.toLowerCase() === "product");
  const asin = dpIndex >= 0 ? parts[dpIndex + 1] : gpIndex >= 1 ? parts[gpIndex + 1] : "";
  const slugParts = dpIndex > 0 ? parts.slice(0, dpIndex) : [];
  return {
    asin: cleanText(asin).toUpperCase(),
    slugHint: slugParts.join(" "),
    canonicalUrl: `https://${url.hostname}/dp/${cleanText(asin).toUpperCase()}`,
  };
}

async function getSections() {
  const html = await fs.readFile(PICKS_PATH, "utf8");
  return Array.from(html.matchAll(/<section class="pickSection" id="([^"]+)"[\s\S]*?<h2 class="sectionTitle">([^<]+)<\/h2>/g)).map(
    (match) => ({
      id: match[1],
      label: cleanText(match[2]),
    }),
  );
}

async function resolveAffiliateUrl(affiliateUrl) {
  const response = await fetch(affiliateUrl, {
    method: "GET",
    redirect: "manual",
    headers: AMAZON_HEADERS,
  });

  const location = response.headers.get("location") || response.url || affiliateUrl;
  return new URL(location, affiliateUrl).toString();
}

async function fetchAmazonHtml(canonicalUrl) {
  const response = await fetch(canonicalUrl, {
    headers: AMAZON_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Amazon returned ${response.status} for ${canonicalUrl}`);
  }

  return response.text();
}

function extractMatch(html, regex) {
  const match = html.match(regex);
  return match ? cleanText(match[1]) : "";
}

function extractBullets(html) {
  const sectionMatch = html.match(/<div id="feature-bullets"[\s\S]*?<ul[\s\S]*?<\/ul>/i);
  if (!sectionMatch) {
    return [];
  }

  return chooseBestBullets(
    Array.from(sectionMatch[0].matchAll(/<li[^>]*>\s*<span class="a-list-item">([\s\S]*?)<\/span>\s*<\/li>/gi)).map(
      (match) => match[1],
    ),
  );
}

function createAnalysis(input, amazonData, sections) {
  const imageUrls = normalizeImageUrls(input.imageUrls?.length ? input.imageUrls : input.imageUrl);
  if (!imageUrls.length) {
    throw new Error("At least one image URL is required.");
  }

  const sectionIds = sections.map((section) => section.id);
  const shortTitle = input.shortTitle?.trim() || titleFromAmazonTitle(amazonData.fullTitle, amazonData.brand);
  const cardCopy = input.cardCopy?.trim() || deriveCardCopy(amazonData.bullets, shortTitle);
  const pageSummary = input.pageSummary?.trim() || deriveSummary(amazonData.bullets, shortTitle);
  const sectionId = input.sectionId || inferSectionId(`${shortTitle} ${amazonData.slugHint}`, sectionIds);
  const pageSlug = slugify(shortTitle) || slugify(amazonData.slugHint) || amazonData.asin.toLowerCase();
  const pageFile = `pick-${pageSlug}.html`;
  const primaryImageUrl = imageUrls[0];
  const imageSize = extractImageSize(primaryImageUrl);
  const ogTitle = `${shortTitle} | Dreamy Decor`;
  const metaDescription = deriveMetaDescription(shortTitle, cardCopy);
  const studioEnabled = Boolean(input.studioEnabled);
  const productUrl = `${SITE_URL}/${pageFile}`;

  return {
    affiliateUrl: input.affiliateUrl,
    imageUrl: primaryImageUrl,
    imageUrls,
    studioEnabled,
    sectionId,
    sectionLabel: sections.find((section) => section.id === sectionId)?.label || "Decor Picks",
    asin: amazonData.asin,
    brand: amazonData.brand,
    fullTitle: amazonData.fullTitle,
    shortTitle,
    cardCopy,
    pageSummary,
    bullets: amazonData.bullets.length ? amazonData.bullets : [cardCopy],
    price: amazonData.price,
    priceLabel: "Check Latest Price on Amazon",
    availability: amazonData.availability,
    pageFile,
    productUrl,
    metaDescription,
    ogTitle,
    ogDescription: pageSummary,
    twitterDescription: pageSummary,
    altText: input.altText?.trim() || `${shortTitle} product photo`,
    studioCopy: deriveStudioCopy(shortTitle),
    imageWidth: imageSize.width,
    imageHeight: imageSize.height,
  };
}

async function findExistingPickFile({ asin, affiliateUrl, pageFile }) {
  const entries = await fs.readdir(ROOT_DIR);
  const pickFiles = entries.filter((entry) => /^pick-.*\.html$/i.test(entry));

  for (const file of pickFiles) {
    const content = await fs.readFile(path.join(ROOT_DIR, file), "utf8");
    if (content.includes(asin) || content.includes(affiliateUrl) || file === pageFile) {
      return file;
    }
  }

  return pageFile;
}

function renderStudioBand(studioEnabled, studioCopy) {
  if (!studioEnabled) {
    return "";
  }

  return `
            <section class="ctaBand" aria-label="Transform your decor with AI">
              <div>
                <div class="ctaBand__k">AI Studio</div>
                <div class="ctaBand__t">Transform Your Decor with our AI</div>
                <div class="ctaBand__s">${escapeHtml(studioCopy)}</div>
              </div>
              <div class="ctaBand__a">
                <a
                  class="btn btn--primary"
                  href="${escapeHtml(STUDIO_URL)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open AI Studio
                </a>
              </div>
            </section>`;
}

function renderStudioButton(studioEnabled) {
  if (!studioEnabled) {
    return "";
  }

  return `
                <a class="btn" href="${escapeHtml(STUDIO_URL)}" target="_blank"
                  rel="noopener noreferrer">
                  Transform with AI Studio
                </a>`;
}

function renderOgImageTags(data) {
  const tags = [];

  data.imageUrls.forEach((imageUrl, index) => {
    tags.push(`    <meta property="og:image" content="${escapeHtml(imageUrl)}" />`);
    if (index === 0) {
      tags.push(`    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />`);
      tags.push(`    <meta property="og:image:alt" content="${escapeHtml(data.altText)}" />`);
      if (data.imageWidth && data.imageHeight) {
        tags.push(`    <meta property="og:image:width" content="${escapeHtml(data.imageWidth)}" />`);
        tags.push(`    <meta property="og:image:height" content="${escapeHtml(data.imageHeight)}" />`);
      }
    }
  });

  return tags.join("\n");
}

function renderGalleryMarkup(data) {
  const thumbButtons = data.imageUrls
    .map(
      (imageUrl, index) => `              <button
                class="pickDetail__thumb${index === 0 ? " is-active" : ""}"
                type="button"
                data-gallery-thumb
                data-image="${escapeHtml(imageUrl)}"
                aria-label="Show product image ${index + 1}"
                aria-pressed="${index === 0 ? "true" : "false"}"
              >
                <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(`${data.shortTitle} image ${index + 1}`)}" loading="lazy" decoding="async" />
              </button>`,
    )
    .join("\n");

  const media = `          <div class="pickDetail__media">
            <img
              class="pickDetail__img"
              src="${escapeHtml(data.imageUrl)}"
              alt="${escapeHtml(data.altText)}"
              loading="eager"
              decoding="async"
              referrerpolicy="no-referrer"
              data-gallery-main
              onerror="this.src='https://placehold.co/600x400?text=Product+Image+Coming+Soon'"
            />${data.imageUrls.length > 1 ? `
            <div class="pickDetail__thumbs" aria-label="More product images">
${thumbButtons}
            </div>` : ""}
          </div>`;

  const script = data.imageUrls.length > 1
    ? `
    <script>
      document.addEventListener("DOMContentLoaded", function () {
        var mainImage = document.querySelector("[data-gallery-main]");
        var thumbs = Array.prototype.slice.call(document.querySelectorAll("[data-gallery-thumb]"));
        if (!mainImage || !thumbs.length) {
          return;
        }

        thumbs.forEach(function (thumb) {
          thumb.addEventListener("click", function () {
            var imageUrl = thumb.getAttribute("data-image");
            if (!imageUrl) {
              return;
            }

            mainImage.src = imageUrl;
            thumbs.forEach(function (item) {
              item.classList.remove("is-active");
              item.setAttribute("aria-pressed", "false");
            });
            thumb.classList.add("is-active");
            thumb.setAttribute("aria-pressed", "true");
          });
        });
      });
    </script>`
    : "";

  return { media, script };
}

function renderProductPage(data) {
  const gallery = renderGalleryMarkup(data);
  const productMetaTags = data.price
    ? `
    <meta property="product:price:amount" content="${escapeHtml(data.price)}" />
    <meta property="product:price:currency" content="USD" />`
    : "";

  const productJson = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: data.fullTitle,
    image: data.imageUrls,
    description: data.metaDescription,
    sku: data.asin,
    brand: { "@type": "Brand", name: data.brand },
    offers: {
      "@type": "Offer",
      url: data.affiliateUrl,
      itemCondition: "https://schema.org/NewCondition",
      availability: `https://schema.org/${data.availability}`,
    },
    url: data.productUrl,
  };

  if (data.price) {
    productJson.offers.priceCurrency = "USD";
    productJson.offers.price = data.price;
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="p:domain_verify" content="9c6037d438a25ef0f7bd7f38b3ce4d23" />
    <meta
      name="description"
      content="${escapeHtml(data.metaDescription)}"
    />

    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="DREAMY DECOR" />
    <meta property="og:url" content="${escapeHtml(data.productUrl)}" />
    <meta property="og:title" content="${escapeHtml(data.ogTitle)}" />
    <meta
      property="og:description"
      content="${escapeHtml(data.ogDescription)}"
    />
${renderOgImageTags(data)}
    <meta property="product:retailer_item_id" content="${escapeHtml(data.asin)}" />
    <meta property="product:brand" content="${escapeHtml(data.brand)}" />
    <meta property="product:condition" content="new" />
    <meta property="product:availability" content="${data.availability === "InStock" ? "instock" : "oos"}" />${productMetaTags}

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(data.ogTitle)}" />
    <meta
      name="twitter:description"
      content="${escapeHtml(data.twitterDescription)}"
    />
    <meta name="twitter:image" content="${escapeHtml(data.imageUrl)}" />

    <script type="application/ld+json">${safeJson(productJson)}</script>

    <title>DREAMY DECOR | ${escapeHtml(data.shortTitle)}</title>
    <link rel="canonical" href="${escapeHtml(data.productUrl)}" />

    <link rel="icon" href="static/favicon.svg?v=20260214" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600..900&family=Space+Grotesk:wght@400..700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="static/style.css?v=20260215" />
  </head>
  <body>
    <div class="bg" aria-hidden="true"></div>

    <header class="top">
      <a class="brand" href="./" aria-label="DREAMY DECOR home">
        <span class="brand__mark" aria-hidden="true">DD</span>
        <span class="brand__word">DREAMY DECOR</span>
      </a>
      <nav class="nav" aria-label="Primary">
        <a class="nav__link" href="studio.html">AI Studio</a>
        <a class="nav__link nav__link--active" href="picks.html">Decor Picks</a>
        <a class="nav__link" href="blog.html">Blog</a>
      </nav>
    </header>

    <main class="shell">
      <section class="page">
        <div class="pageHead">
          <div class="pageHead__kicker">Decor Pick</div>
          <h1 class="pageHead__title">${escapeHtml(data.shortTitle)}</h1>
          <p class="pageHead__sub">${escapeHtml(data.pageSummary)}</p>
          <div class="notice">
            <span class="notice__k">Note</span>
            <span class="notice__v">
              This page contains affiliate links. If you buy through them, we may earn a commission at no extra cost
              to you.
            </span>
          </div>
        </div>

        <section class="pickDetail" aria-label="Product details">
${gallery.media}
          <div class="pickDetail__panel">
            <div class="pickDetail__priceRow">
              <div class="pickDetail__price">${escapeHtml(data.priceLabel)}</div>
              <div class="pickDetail__meta">ASIN ${escapeHtml(data.asin)}</div>
            </div>

            <ul class="pickDetail__bullets">
${data.bullets.map((bullet) => `              <li>${escapeHtml(toSentenceCase(bullet))}</li>`).join("\n")}
            </ul>${renderStudioBand(data.studioEnabled, data.studioCopy)}

            <div class="actions actions--spread">
              <a class="btn" href="picks.html#${escapeHtml(data.sectionId)}">Back to ${escapeHtml(data.sectionLabel)} picks</a>
              <a
                class="btn btn--primary"
                href="${escapeHtml(data.affiliateUrl)}"
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
              >
                ${escapeHtml(data.priceLabel)}
              </a>
            </div>

            <div class="finePrint">Availability and pricing can change at any time. Check Amazon for the latest details before buying.</div>
          </div>
        </section>
      </section>

      <section class="footer">
        <div class="footer__left">
          <div class="footBrand">DREAMY DECOR</div>
          <div class="footNote">Curated picks, practical guides, and an AI studio.</div>
        </div>
        <div class="footer__right">
          <a class="nav__link" href="privacy.html">Privacy</a>
        </div>
      </section>
    </main>${gallery.script}
  </body>
</html>
`;
}

function renderProductCard(data, pageFile) {
  return `          <article class="productCard">
            <a class="productCard__imgLink" href="${escapeHtml(pageFile)}" aria-label="View details">
              <img class="productCard__img" src="${escapeHtml(data.imageUrl)}"
                alt="${escapeHtml(data.altText)}" loading="lazy" decoding="async"
                referrerpolicy="no-referrer"
                onerror="this.src='https://placehold.co/600x400?text=Product+Image+Coming+Soon'" />
            </a>
            <div class="productCard__body">
              <div class="productCard__top">
                <div class="productCard__t">${escapeHtml(data.shortTitle)}</div>
                <div class="productCard__price">${escapeHtml(data.priceLabel)}</div>
              </div>
              <p class="productCard__c">
                ${escapeHtml(data.cardCopy)}
              </p>
              <div class="productCard__a">
                <a class="btn" href="${escapeHtml(pageFile)}">Details</a>${renderStudioButton(data.studioEnabled)}
                <a class="btn btn--primary" href="${escapeHtml(data.affiliateUrl)}" target="_blank"
                  rel="noopener noreferrer nofollow sponsored">
                  ${escapeHtml(data.priceLabel)}
                </a>
              </div>
            </div>
          </article>`;
}

function replaceOrInsertCard(picksHtml, sectionId, cardHtml, pageFile, affiliateUrl) {
  const withoutExistingCard = picksHtml.replace(/<article class="productCard">[\s\S]*?<\/article>\s*/gi, (block) => {
    return block.includes(`href="${pageFile}"`) || block.includes(`href="${affiliateUrl}"`) ? "" : block;
  });
  const sectionMarker = `<section class="pickSection" id="${sectionId}"`;
  const sectionIndex = withoutExistingCard.indexOf(sectionMarker);

  if (sectionIndex < 0) {
    throw new Error(`Could not find section "${sectionId}" inside picks.html`);
  }

  const gridMarker = '<div class="cardGrid">';
  const gridIndex = withoutExistingCard.indexOf(gridMarker, sectionIndex);

  if (gridIndex < 0) {
    throw new Error(`Could not find card grid for section "${sectionId}" inside picks.html`);
  }

  const insertIndex = gridIndex + gridMarker.length;
  return `${withoutExistingCard.slice(0, insertIndex)}\n${cardHtml}${withoutExistingCard.slice(insertIndex)}`;
}

async function writeProductFiles(data) {
  const pageHtml = renderProductPage(data);
  await fs.writeFile(path.join(ROOT_DIR, data.pageFile), pageHtml, "utf8");

  const picksHtml = await fs.readFile(PICKS_PATH, "utf8");
  const cardHtml = renderProductCard(data, data.pageFile);
  const updatedPicksHtml = replaceOrInsertCard(picksHtml, data.sectionId, cardHtml, data.pageFile, data.affiliateUrl);
  await fs.writeFile(PICKS_PATH, updatedPicksHtml, "utf8");

  return data.pageFile;
}

async function analyzeAffiliateInput(input) {
  if (!input?.affiliateUrl || !normalizeImageUrls(input.imageUrls?.length ? input.imageUrls : input.imageUrl).length) {
    throw new Error("Affiliate URL and at least one image URL are required.");
  }

  const sections = await getSections();
  const resolvedUrl = await resolveAffiliateUrl(input.affiliateUrl);
  const pathInfo = extractAmazonPathInfo(resolvedUrl);

  if (!pathInfo.asin) {
    throw new Error("Could not extract an ASIN from the affiliate link.");
  }

  const html = await fetchAmazonHtml(pathInfo.canonicalUrl);
  const fullTitle = extractMatch(html, /<span id="productTitle"[^>]*>([\s\S]*?)<\/span>/i);
  const rawBrand = extractMatch(html, /<a id="bylineInfo"[^>]*>([\s\S]*?)<\/a>/i);
  const bullets = extractBullets(html);
  const availability = extractAvailability(html);

  if (!fullTitle) {
    throw new Error("Could not read the Amazon product title.");
  }

  const analysis = createAnalysis(
    input,
    {
      asin: pathInfo.asin,
      slugHint: pathInfo.slugHint,
      fullTitle,
      brand: normalizeBrand(rawBrand, fullTitle),
      bullets,
      price: extractMoney(html),
      availability,
    },
    sections,
  );

  const pageFile = await findExistingPickFile(analysis);
  return {
    ...analysis,
    pageFile,
    productUrl: `${SITE_URL}/${pageFile}`,
  };
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.join(PUBLIC_DIR, pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : "application/octet-stream";

    res.writeHead(200, { "content-type": contentType });
    res.end(file);
  } catch (error) {
    res.writeHead(404);
    res.end("Not found");
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === "GET" && requestUrl.pathname === "/api/sections") {
        json(res, 200, { sections: await getSections() });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/analyze") {
        const analysis = await analyzeAffiliateInput(await readRequestBody(req));
        json(res, 200, { analysis });
        return;
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/publish") {
        const analysis = await analyzeAffiliateInput(await readRequestBody(req));
        if (!analysis.price) {
          throw new Error(
            "Could not extract a live Amazon price. Pinterest product tags need price metadata, so publishing was blocked.",
          );
        }
        const pageFile = await writeProductFiles(analysis);
        json(res, 200, {
          ok: true,
          pageFile,
          pagePath: path.join(ROOT_DIR, pageFile),
          picksPath: PICKS_PATH,
          analysis: { ...analysis, pageFile, productUrl: `${SITE_URL}/${pageFile}` },
        });
        return;
      }

      await serveStatic(req, res);
    } catch (error) {
      json(res, 500, { error: error.message || "Unexpected error" });
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Affiliate admin app running at http://localhost:${PORT}`);
  });
}

module.exports = {
  PORT,
  SITE_URL,
  STUDIO_URL,
  analyzeAffiliateInput,
  createServer,
  getSections,
  renderProductPage,
  writeProductFiles,
};
