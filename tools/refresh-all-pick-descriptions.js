const fs = require("fs");
const path = require("path");
const {
  SITE_URL,
  generateReviewContent,
  getSections,
  renderProductCard,
  renderProductPage,
  replaceOrInsertCard,
} = require("./affiliate-admin/server");
const { writeProductIndex } = require("./generate-product-index");
const { writeLatestPicksPage } = require("./generate-latest-picks");

const ROOT_DIR = path.resolve(__dirname, "..");

function toSentenceCase(value) {
  const text = cleanText(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function truncate(value, maxLength) {
  const text = cleanText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }

  const short = text.slice(0, maxLength - 1);
  const lastSpace = short.lastIndexOf(" ");
  return `${short.slice(0, Math.max(lastSpace, 0))}...`;
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value) {
  return decodeEntities(String(value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extract(pattern, source, fieldName, fileName) {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Could not find ${fieldName} in ${fileName}`);
  }

  return match[1];
}

function extractOptional(pattern, source) {
  const match = source.match(pattern);
  return match ? match[1] : "";
}

function extractAll(pattern, source) {
  return Array.from(source.matchAll(pattern), (match) => match[1]);
}

function normalizeSectionLabel(buttonText) {
  return cleanText(buttonText).replace(/^Back to\s+/i, "").replace(/\s+picks$/i, "");
}

function parseProductJson(html, fileName) {
  const rawJson = extract(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i,
    html,
    "product schema json",
    fileName,
  );
  return JSON.parse(rawJson);
}

function findMetaContent(html, attribute, value) {
  const patterns = [
    new RegExp(`<meta[^>]*${attribute}="${value}"[^>]*content="([^"]+)"[^>]*>`, "i"),
    new RegExp(`<meta[^>]*content="([^"]+)"[^>]*${attribute}="${value}"[^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return cleanText(match[1]);
    }
  }

  return "";
}

function inferBestFor(product) {
  const title = product.shortTitle.toLowerCase();
  const room = product.sectionLabel.toLowerCase();
  return toSentenceCase(
    `Best for shoppers who want a practical ${title} in ${room} spaces and prefer straightforward function over overly decorative extras.`,
  );
}

function inferSkip(product) {
  const title = product.shortTitle.toLowerCase();
  return toSentenceCase(
    `Skip it if you need premium materials or very specific dimensions, because this ${title} is better treated as a style-and-function pick than a precision custom piece.`,
  );
}

function inferWhereItWorks(product) {
  const room = product.sectionLabel;
  const firstBullet = cleanText(product.bullets[0] || "");
  if (firstBullet) {
    return truncate(`${room} spaces are the clearest fit here, especially where ${firstBullet.charAt(0).toLowerCase()}${firstBullet.slice(1)}`, 170);
  }

  return toSentenceCase(`Works best in ${room.toLowerCase()} spaces where you want an easy functional upgrade without changing the whole room.`);
}

function derivePros(product) {
  const bullets = product.bullets
    .map((bullet) => toSentenceCase(bullet))
    .filter(Boolean)
    .slice(0, 3);

  while (bullets.length < 3) {
    const fallback = bullets.length === 0
      ? `Useful day-to-day function for ${product.sectionLabel.toLowerCase()} spaces`
      : bullets.length === 1
        ? `Easy to mix into a room without overcomplicating the layout`
        : `Straightforward pick when you want practical value first`;
    bullets.push(toSentenceCase(fallback));
  }

  return bullets;
}

function deriveCons(product) {
  const text = `${product.shortTitle} ${product.pageSummary} ${product.bullets.join(" ")}`.toLowerCase();
  const cons = ["Exact scale and finish still need a listing check before ordering"];

  if (!/solid wood|real wood|solid metal|genuine leather|100%/.test(text)) {
    cons.push("Material quality details are limited, so expectations should stay practical");
  } else if (/assembly|assemble|drawer|shelf|cabinet|table|desk|dresser|bookcase|stand/.test(text)) {
    cons.push("Setup time may be a factor depending on the piece and room placement");
  }

  return cons.slice(0, 2).map(toSentenceCase);
}

function buildFallbackReview(product) {
  const primaryBullet = cleanText(product.bullets[0] || product.pageSummary || "");
  const cardCopy = truncate(
    primaryBullet || `A practical ${product.shortTitle.toLowerCase()} pick for more functional, better-finished rooms.`,
    165,
  );
  const pageSummary = truncate(
    product.pageSummary || primaryBullet || `A practical ${product.shortTitle.toLowerCase()} pick for everyday rooms.`,
    170,
  );

  return {
    cardCopy,
    pageSummary,
    whoItsBestFor: inferBestFor(product),
    whoShouldSkipIt: inferSkip(product),
    whereItWorksBest: inferWhereItWorks(product),
    pros: derivePros(product),
    cons: deriveCons(product),
  };
}

function resolveSectionFromCards(fileName, sectionPages, sectionsById) {
  for (const [pageFile, html] of sectionPages.entries()) {
    const hrefIndex = html.indexOf(`href="${fileName}"`);
    if (hrefIndex < 0) {
      continue;
    }

    const before = html.slice(0, hrefIndex);
    const matches = Array.from(before.matchAll(/<section class="pickSection" id="([^"]+)"/g));
    const sectionId = matches[matches.length - 1]?.[1];
    if (sectionId && sectionsById.get(sectionId)) {
      return sectionsById.get(sectionId);
    }

    const section = Array.from(sectionsById.values()).find((entry) => entry.pageFile === pageFile);
    if (section) {
      return section;
    }
  }

  return null;
}

function inferSectionFromContent(productText, sectionsById) {
  const text = cleanText(productText).toLowerCase();
  const rules = [
    { id: "bedroom", keywords: ["bedroom", "nightstand", "dresser", "bed", "wardrobe", "armoire", "vanity"] },
    { id: "outdoor", keywords: ["outdoor", "patio", "porch", "garden", "bistro", "rocking chair", "lantern"] },
    { id: "small", keywords: ["organizer", "hamper", "entryway", "console", "side table", "cart", "storage rack"] },
    { id: "living", keywords: ["mirror", "wall art", "bookshelf", "sofa", "chair", "coffee table", "tv stand", "lamp", "sconce", "shelf"] },
  ];

  for (const rule of rules) {
    if (sectionsById.get(rule.id) && rule.keywords.some((keyword) => text.includes(keyword))) {
      return sectionsById.get(rule.id);
    }
  }

  return sectionsById.get("living") || sectionsById.get("small") || Array.from(sectionsById.values())[0] || null;
}

function resolveSectionInfo(fileName, sectionUrl, sectionButtonText, productText, sectionsByUrl, sectionsById, sectionsByLabel, sectionPages) {
  const direct = sectionsByUrl.get(sectionUrl);
  if (direct) {
    return direct;
  }

  const fragment = String(sectionUrl).split("#")[1] || "";
  if (fragment && sectionsById.get(fragment)) {
    return sectionsById.get(fragment);
  }

  const normalizedLabel = normalizeSectionLabel(sectionButtonText).toLowerCase();
  if (normalizedLabel && sectionsByLabel.get(normalizedLabel)) {
    return sectionsByLabel.get(normalizedLabel);
  }

  return resolveSectionFromCards(fileName, sectionPages, sectionsById) || inferSectionFromContent(productText, sectionsById);
}

function parsePickFile(fileName, sectionsByUrl, sectionsById, sectionsByLabel, sectionPages) {
  const fullPath = path.join(ROOT_DIR, fileName);
  const html = fs.readFileSync(fullPath, "utf8");
  const productJson = parseProductJson(html, fileName);
  const imageUrls = extractAll(/<meta property="og:image" content="([^"]+)"/gi, html);
  const sectionUrl = extractOptional(/<a class="btn" href="([^"]+)">Back to [\s\S]*?<\/a>/i, html);
  const sectionButtonText = extractOptional(/<a class="btn" href="[^"]+">([\s\S]*?)<\/a>/i, html);
  const priceLabel = extract(
    /<a[\s\S]*?class="btn btn--primary"[\s\S]*?>\s*([\s\S]*?)\s*<\/a>/i,
    html,
    "price label",
    fileName,
  );
  const bullets = extractAll(/<li>([\s\S]*?)<\/li>/gi, html).map(cleanText).filter(Boolean);
  const sectionInfo = resolveSectionInfo(
    fileName,
    sectionUrl,
    sectionButtonText,
    `${productJson.name} ${productJson.description} ${bullets.join(" ")}`,
    sectionsByUrl,
    sectionsById,
    sectionsByLabel,
    sectionPages,
  );
  if (!sectionInfo) {
    throw new Error(`Could not map section placement for ${fileName}`);
  }

  const availabilityUrl = productJson?.offers?.availability || "https://schema.org/InStock";
  const availability = String(availabilityUrl).split("/").pop() || "InStock";

  return {
    affiliateUrl: productJson.offers.url,
    imageUrl: imageUrls[0],
    imageUrls: imageUrls.length ? imageUrls : productJson.image || [],
    sectionId: sectionInfo.id,
    sectionLabel: sectionInfo.label || normalizeSectionLabel(sectionButtonText),
    sectionPageFile: sectionInfo.pageFile,
    sectionUrl,
    asin: cleanText(productJson.sku),
    brand: cleanText(productJson.brand?.name || ""),
    fullTitle: cleanText(productJson.name),
    shortTitle: cleanText(extract(/<h1 class="pageHead__title">([\s\S]*?)<\/h1>/i, html, "short title", fileName)),
    cardCopy: (
      findMetaContent(html, "name", "description") ||
      cleanText(productJson.description || "") ||
      findMetaContent(html, "property", "og:description")
    ).replace(/^Affiliate pick:\s*[^.]+\.\s*/i, ""),
    pageSummary: cleanText(extract(/<p class="pageHead__sub">([\s\S]*?)<\/p>/i, html, "page summary", fileName)),
    price: productJson.offers.price ? String(productJson.offers.price) : "",
    priceLabel: cleanText(priceLabel),
    availability,
    pageFile: fileName,
    productUrl: `${SITE_URL}/${fileName}`,
    metaDescription:
      findMetaContent(html, "name", "description") || cleanText(productJson.description || ""),
    ogTitle: findMetaContent(html, "property", "og:title") || `${cleanText(productJson.name)} | Dreamy Decor`,
    ogDescription:
      findMetaContent(html, "property", "og:description") ||
      cleanText(extract(/<p class="pageHead__sub">([\s\S]*?)<\/p>/i, html, "page summary", fileName)),
    twitterDescription:
      findMetaContent(html, "name", "twitter:description") ||
      findMetaContent(html, "property", "og:description") ||
      cleanText(extract(/<p class="pageHead__sub">([\s\S]*?)<\/p>/i, html, "page summary", fileName)),
    altText:
      findMetaContent(html, "property", "og:image:alt") ||
      cleanText(extractOptional(/<img[\s\S]*?class="pickDetail__img"[\s\S]*?alt="([^"]+)"/i, html)) ||
      `${cleanText(productJson.name)} product photo`,
    imageWidth: findMetaContent(html, "property", "og:image:width"),
    imageHeight: findMetaContent(html, "property", "og:image:height"),
    bullets,
  };
}

function buildDataWithReview(product, review) {
  const cardCopy = review.cardCopy;
  const pageSummary = review.pageSummary;
  return {
    ...product,
    cardCopy,
    pageSummary,
    review,
    metaDescription: `Affiliate pick: ${product.shortTitle}. ${cardCopy}`.slice(0, 158),
    ogDescription: pageSummary,
    twitterDescription: pageSummary,
  };
}

async function run() {
  const sections = await getSections();
  const sectionsByUrl = new Map(sections.map((section) => [section.sectionUrl, section]));
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const sectionsByLabel = new Map(sections.map((section) => [section.label.toLowerCase(), section]));
  const pickFiles = fs
    .readdirSync(ROOT_DIR)
    .filter((entry) => /^pick-.*\.html$/i.test(entry))
    .sort((a, b) => a.localeCompare(b));

  const sectionPages = new Map();
  for (const section of sections) {
    sectionPages.set(section.pageFile, fs.readFileSync(path.join(ROOT_DIR, section.pageFile), "utf8"));
  }

  let updated = 0;
  let usingFallback = false;
  for (const fileName of pickFiles) {
    const product = parsePickFile(fileName, sectionsByUrl, sectionsById, sectionsByLabel, sectionPages);
    let review;

    if (!usingFallback) {
      try {
        review = await generateReviewContent({
          shortTitle: product.shortTitle,
          brand: product.brand,
          fullTitle: product.fullTitle,
          bullets: product.bullets,
          price: product.price,
          sectionLabel: product.sectionLabel,
        });
      } catch (error) {
        if (/429|free-models-per-day|rate limit/i.test(String(error.message || error))) {
          usingFallback = true;
          console.warn(`OpenRouter rate limit reached at ${fileName}. Switching remaining pages to local fallback copy.`);
        } else {
          throw error;
        }
      }
    }

    if (!review) {
      review = buildFallbackReview(product);
    }

    const nextData = buildDataWithReview(product, review);
    const nextHtml = renderProductPage(nextData);
    fs.writeFileSync(path.join(ROOT_DIR, fileName), nextHtml, "utf8");

    const currentSectionHtml = sectionPages.get(product.sectionPageFile);
    const nextSectionHtml = replaceOrInsertCard(
      currentSectionHtml,
      product.sectionId,
      renderProductCard(nextData, fileName),
      fileName,
      product.affiliateUrl,
      product.sectionPageFile,
    );
    sectionPages.set(product.sectionPageFile, nextSectionHtml);
    updated += 1;
    console.log(`Updated ${updated}/${pickFiles.length}: ${fileName}`);
  }

  for (const [pageFile, html] of sectionPages.entries()) {
    fs.writeFileSync(path.join(ROOT_DIR, pageFile), html, "utf8");
  }

  writeProductIndex();
  writeLatestPicksPage();
  console.log(`Refreshed ${updated} pick pages.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
