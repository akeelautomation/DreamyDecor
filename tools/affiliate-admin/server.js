const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");
const { writeProductIndex } = require("../generate-product-index");
const { writeLatestPicksPage } = require("../generate-latest-picks");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

function loadEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return;
  }

  const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value.replace(/\\n/g, "\n");
    }
  }
}

loadEnvFile(path.join(ROOT_DIR, ".env.local"));
loadEnvFile(path.join(ROOT_DIR, ".env"));
loadEnvFile(path.join(ROOT_DIR, ".dev.vars"));

const PUBLIC_DIR = path.join(__dirname, "public");
const PICKS_HUB_PATH = path.join(ROOT_DIR, "picks.html");
const SITE_URL = "https://dreamydecor.ai";
const PORT = Number(process.env.PORT || 4311);
const OPENROUTER_API_URL = process.env.OPENROUTER_API_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";
const OPENROUTER_REFERER = process.env.OPENROUTER_HTTP_REFERER || SITE_URL;
const OPENROUTER_TITLE = "Dreamy Decor Affiliate Admin";
const SECTION_PAGE_CONFIG = [
  { id: "living", pageFile: "picks-living.html" },
  { id: "bedroom", pageFile: "picks-bedroom.html" },
  { id: "outdoor", pageFile: "picks-outdoor.html" },
  { id: "small", pageFile: "picks-small-wins.html" },
];

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

const REVIEW_SECTION_CONFIG = [
  { key: "whoItsBestFor", label: "Who It's Best For", type: "text" },
  { key: "whoShouldSkipIt", label: "Who Should Skip It", type: "text" },
  { key: "whereItWorksBest", label: "Where It Works Best", type: "text" },
  { key: "pros", label: "Pros", type: "list" },
  { key: "cons", label: "Cons", type: "list" },
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

function deriveMetaDescription(shortTitle, cardCopy) {
  return truncate(`Affiliate pick: ${shortTitle}. ${cardCopy}`, 158);
}

function normalizeGeneratedText(value) {
  return toAsciiText(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGeneratedParagraph(value) {
  const text = normalizeGeneratedText(value).replace(/^[\-*\u2022\d.)\s]+/, "");
  return text ? toSentenceCase(text) : "";
}

function normalizeGeneratedList(values, minimum, maximum) {
  const rawValues = Array.isArray(values)
    ? values
    : String(values ?? "")
        .split(/\r?\n|[;\u2022]/)
        .map((entry) => entry.trim());

  const unique = [];
  for (const value of rawValues) {
    const normalized = normalizeGeneratedParagraph(value);
    if (!normalized || unique.includes(normalized)) {
      continue;
    }

    unique.push(normalized);
    if (unique.length >= maximum) {
      break;
    }
  }

  if (unique.length < minimum) {
    throw new Error(`Expected at least ${minimum} list items from the AI response.`);
  }

  return unique;
}

function getConfigValue(name, fallback = "") {
  const processValue = process.env[name];
  if (processValue != null && String(processValue).trim()) {
    return String(processValue).trim();
  }

  return fallback;
}

function extractJsonObject(text) {
  const source = String(text ?? "").trim();
  const fencedMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : source;
  const start = candidate.indexOf("{");

  if (start < 0) {
    throw new Error("The AI response did not contain a JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, index + 1));
      }
    }
  }

  throw new Error("The AI response contained an incomplete JSON object.");
}

function extractMessageText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part?.type === "text" && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }

  return "";
}

function normalizeReviewContent(rawReview) {
  const review = {
    cardCopy: truncate(normalizeGeneratedParagraph(rawReview?.cardCopy), 165),
    pageSummary: truncate(normalizeGeneratedParagraph(rawReview?.pageSummary), 170),
    whoItsBestFor: normalizeGeneratedParagraph(rawReview?.whoItsBestFor),
    whoShouldSkipIt: normalizeGeneratedParagraph(rawReview?.whoShouldSkipIt),
    whereItWorksBest: normalizeGeneratedParagraph(rawReview?.whereItWorksBest),
    pros: normalizeGeneratedList(rawReview?.pros, 3, 3),
    cons: normalizeGeneratedList(rawReview?.cons, 1, 2),
  };

  for (const section of REVIEW_SECTION_CONFIG.filter((entry) => entry.type === "text")) {
    if (!review[section.key]) {
      throw new Error(`The AI response was missing "${section.label}".`);
    }
  }

  if (!review.cardCopy) {
    throw new Error('The AI response was missing "cardCopy".');
  }

  if (!review.pageSummary) {
    throw new Error('The AI response was missing "pageSummary".');
  }

  return review;
}

function extractFieldValueFromText(text, fieldName) {
  const escapedName = escapeRegExp(fieldName);
  const patterns = [
    new RegExp(`^\\s*${escapedName}\\s*:\\s*(.+)$`, "im"),
    new RegExp(`^\\s*[*-]?\\s*${escapedName}\\s*:\\s*(.+)$`, "im"),
    new RegExp(`^\\s*#{1,6}\\s*${escapedName}\\s*$([\\s\\S]*?)(?=^\\s*#{1,6}\\s+|\\Z)`, "im"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const value = normalizeGeneratedText(match[1] || "");
    if (value) {
      return value;
    }
  }

  return "";
}

function extractListFromText(text, fieldName) {
  const escapedName = escapeRegExp(fieldName);
  const blockPattern = new RegExp(
    `^\\s*(?:[*-]?\\s*)?${escapedName}\\s*:?\\s*$([\\s\\S]*?)(?=^\\s*(?:[*-]?\\s*)?(?:cardCopy|pageSummary|whoItsBestFor|whoShouldSkipIt|whereItWorksBest|pros|cons)\\s*:|\\Z)`,
    "im",
  );
  const blockMatch = text.match(blockPattern);
  const source = blockMatch?.[1] || extractFieldValueFromText(text, fieldName);

  return String(source ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

function parseReviewResponseText(text) {
  try {
    return extractJsonObject(text);
  } catch (_error) {
    const fallback = {
      cardCopy: extractFieldValueFromText(text, "cardCopy"),
      pageSummary: extractFieldValueFromText(text, "pageSummary"),
      whoItsBestFor: extractFieldValueFromText(text, "whoItsBestFor"),
      whoShouldSkipIt: extractFieldValueFromText(text, "whoShouldSkipIt"),
      whereItWorksBest: extractFieldValueFromText(text, "whereItWorksBest"),
      pros: extractListFromText(text, "pros"),
      cons: extractListFromText(text, "cons"),
    };

    if (fallback.cardCopy && fallback.pageSummary && fallback.pros.length && fallback.cons.length) {
      return fallback;
    }

    throw _error;
  }
}

function buildReviewRequestBody({ model, systemPrompt, userPrompt, attempt }) {
  const base = {
    model,
    temperature: attempt === 0 ? 0.2 : 0.1,
    max_completion_tokens: attempt === 0 ? 1200 : 1500,
    reasoning: { effort: "none", exclude: true },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (attempt === 0) {
    return {
      ...base,
      response_format: { type: "json_object" },
    };
  }

  return base;
}

async function generateReviewContent({ shortTitle, brand, fullTitle, bullets, price, sectionLabel }) {
  const apiKey = getConfigValue("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env.local, your shell environment, or Cloudflare secrets before analyzing products.");
  }

  const apiUrl = getConfigValue("OPENROUTER_API_BASE_URL", OPENROUTER_API_URL);
  const model = getConfigValue("OPENROUTER_MODEL", OPENROUTER_MODEL);

  const promptPayload = {
    shortTitle,
    brand,
    fullTitle,
    section: sectionLabel,
    price: price ? `$${price}` : "Not available",
    amazonFeatures: bullets,
  };

  const systemPrompt =
    "You write affiliate product copy for a home decor site. Rewrite product information into grounded buying guidance. Do not copy Amazon feature wording, do not mention Amazon, and do not invent dimensions, materials, hardware, or performance claims that are not supported by the provided details. If information is limited, say so briefly and honestly. If exact size is not provided, tell the reader to check the listing dimensions instead of guessing. Return valid JSON only.";

  const userPrompt = [
    "Create structured product notes using this schema:",
    "{",
    '  "cardCopy": "1-2 sentences, concise and editorial, 100-165 characters if possible",',
    '  "pageSummary": "1 sentence, room-focused subtitle, 170 characters or less",',
    '  "whoItsBestFor": "1-2 sentences",',
    '  "whoShouldSkipIt": "1-2 sentences",',
    '  "whereItWorksBest": "1-2 sentences",',
    '  "pros": ["3 concise items"],',
    '  "cons": ["1-2 concise items"]',
    "}",
    "Rules:",
    "- Keep the tone practical, specific, and honest.",
    "- Rephrase ideas instead of echoing the supplied features.",
    "- Pros and cons must be concise, plain-text list items.",
    "- Do not make up exact dimensions, included hardware, wash instructions, or material percentages unless they are in the source details.",
    "- Keep pros to exactly 3 items and cons to 1-2 items.",
    "- Keep every field compact. Avoid long paragraphs.",
    "- If the response starts to get long, shorten it instead of adding more detail.",
    "",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n");

  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-Title": OPENROUTER_TITLE,
      },
      body: JSON.stringify(buildReviewRequestBody({ model, systemPrompt, userPrompt, attempt })),
    });

    if (!response.ok) {
      const rawError = await response.text();
      let message = rawError;
      try {
        const parsed = JSON.parse(rawError);
        message = parsed?.error?.message || parsed?.message || rawError;
      } catch (_error) {
        // Keep raw text when the response body is not JSON.
      }

      if (response.status === 401) {
        if (/user not found/i.test(message)) {
          throw new Error(
            "OpenRouter rejected the API key with 'User not found'. The key in OPENROUTER_API_KEY is invalid, revoked, or belongs to a missing account. Create a fresh OpenRouter key and replace the value in .dev.vars, then restart the affiliate admin.",
          );
        }

        throw new Error(
          `OpenRouter authentication failed (${response.status}). Replace OPENROUTER_API_KEY with a valid key and restart the affiliate admin. Details: ${message}`,
        );
      }

      throw new Error(`OpenRouter request failed (${response.status}): ${message}`);
    }

    const payload = await response.json();
    const messageText = extractMessageText(payload?.choices?.[0]?.message?.content);
    const finishReason = payload?.choices?.[0]?.finish_reason;

    try {
      const parsed = parseReviewResponseText(messageText);
      return normalizeReviewContent(parsed);
    } catch (error) {
      lastError = error;
      if (finishReason !== "length" && attempt === 2) {
        throw new Error(`AI review generation failed: ${error.message}`);
      }
    }
  }

  throw new Error(`AI review generation failed: ${lastError?.message || "unexpected response format"}`);
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
  const sections = [];

  for (const config of SECTION_PAGE_CONFIG) {
    const html = await fs.readFile(path.join(ROOT_DIR, config.pageFile), "utf8");
    const match = html.match(
      new RegExp(`<section class="pickSection" id="${escapeRegExp(config.id)}"[\\s\\S]*?<h2 class="sectionTitle">([^<]+)</h2>`, "i"),
    );

    if (!match) {
      continue;
    }

    sections.push({
      id: config.id,
      label: cleanText(match[1]),
      pageFile: config.pageFile,
      sectionUrl: `${config.pageFile}#${config.id}`,
    });
  }

  return sections;
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

function normalizeOptionalInput(value) {
  return String(value ?? "").trim();
}

function inputMatchesProvidedValue(inputValue, providedValue) {
  const normalizedInput = normalizeOptionalInput(inputValue);
  return !normalizedInput || normalizedInput === normalizeOptionalInput(providedValue);
}

function canReuseProvidedAnalysis(input, analysis) {
  if (!analysis || typeof analysis !== "object" || !analysis.review) {
    return false;
  }

  const inputImageUrls = normalizeImageUrls(input.imageUrls?.length ? input.imageUrls : input.imageUrl);
  const analysisImageUrls = normalizeImageUrls(analysis.imageUrls?.length ? analysis.imageUrls : analysis.imageUrl);

  if (
    normalizeOptionalInput(input.affiliateUrl) !== normalizeOptionalInput(analysis.affiliateUrl) ||
    JSON.stringify(inputImageUrls) !== JSON.stringify(analysisImageUrls)
  ) {
    return false;
  }

  return (
    inputMatchesProvidedValue(input.sectionId, analysis.sectionId) &&
    inputMatchesProvidedValue(input.shortTitle, analysis.shortTitle) &&
    inputMatchesProvidedValue(input.cardCopy, analysis.cardCopy) &&
    inputMatchesProvidedValue(input.pageSummary, analysis.pageSummary) &&
    inputMatchesProvidedValue(input.altText, analysis.altText)
  );
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

  const shortTitle = amazonData.shortTitle;
  const cardCopy = input.cardCopy?.trim() || amazonData.review.cardCopy;
  const pageSummary = input.pageSummary?.trim() || amazonData.review.pageSummary;
  const sectionId = amazonData.sectionId;
  const pageSlug = slugify(shortTitle) || slugify(amazonData.slugHint) || amazonData.asin.toLowerCase();
  const pageFile = `pick-${pageSlug}.html`;
  const primaryImageUrl = imageUrls[0];
  const imageSize = extractImageSize(primaryImageUrl);
  const ogTitle = `${shortTitle} | Dreamy Decor`;
  const metaDescription = deriveMetaDescription(shortTitle, cardCopy);
  const productUrl = `${SITE_URL}/${pageFile}`;

  return {
    affiliateUrl: input.affiliateUrl,
    imageUrl: primaryImageUrl,
    imageUrls,
    sectionId,
    sectionLabel: sections.find((section) => section.id === sectionId)?.label || "Decor Picks",
    sectionPageFile: sections.find((section) => section.id === sectionId)?.pageFile || "picks.html",
    sectionUrl: sections.find((section) => section.id === sectionId)?.sectionUrl || `picks.html#${sectionId}`,
    asin: amazonData.asin,
    brand: amazonData.brand,
    fullTitle: amazonData.fullTitle,
    shortTitle,
    cardCopy,
    pageSummary,
    review: amazonData.review,
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

function renderReviewMarkup(review) {
  return REVIEW_SECTION_CONFIG.map((section) => {
    const value = review[section.key];
    if (section.type === "list") {
      return `            <section class="pickDetail__section pickDetail__section--list">
              <h2 class="pickDetail__sectionTitle">${escapeHtml(section.label)}</h2>
              <ul class="pickDetail__list">
${value.map((item) => `                <li>${escapeHtml(item)}</li>`).join("\n")}
              </ul>
            </section>`;
    }

    return `            <section class="pickDetail__section">
              <h2 class="pickDetail__sectionTitle">${escapeHtml(section.label)}</h2>
              <p class="pickDetail__sectionCopy">${escapeHtml(value)}</p>
            </section>`;
  }).join("\n");
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
              <div class="pickDetail__meta">ASIN ${escapeHtml(data.asin)}</div>
            </div>

            <div class="pickDetail__notes">
${renderReviewMarkup(data.review)}
            </div>

            <div class="actions actions--spread">
              <a class="btn" href="${escapeHtml(data.sectionUrl)}">Back to ${escapeHtml(data.sectionLabel)} picks</a>
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
          <div class="footNote">Curated picks and practical guides for finishing a room.</div>
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
                <a class="btn" href="${escapeHtml(pageFile)}">Details</a>
                <a class="btn btn--primary" href="${escapeHtml(data.affiliateUrl)}" target="_blank"
                  rel="noopener noreferrer nofollow sponsored">
                  ${escapeHtml(data.priceLabel)}
                </a>
              </div>
            </div>
          </article>`;
}

function replaceOrInsertCard(listHtml, sectionId, cardHtml, pageFile, affiliateUrl, pageLabel) {
  const withoutExistingCard = listHtml.replace(/<article class="productCard">[\s\S]*?<\/article>\s*/gi, (block) => {
    return block.includes(`href="${pageFile}"`) || block.includes(`href="${affiliateUrl}"`) ? "" : block;
  });
  const sectionMarker = `<section class="pickSection" id="${sectionId}"`;
  const sectionIndex = withoutExistingCard.indexOf(sectionMarker);

  if (sectionIndex < 0) {
    throw new Error(`Could not find section "${sectionId}" inside ${pageLabel}`);
  }

  const gridMarker = '<div class="cardGrid">';
  const gridIndex = withoutExistingCard.indexOf(gridMarker, sectionIndex);

  if (gridIndex < 0) {
    throw new Error(`Could not find card grid for section "${sectionId}" inside ${pageLabel}`);
  }

  const insertIndex = gridIndex + gridMarker.length;
  return `${withoutExistingCard.slice(0, insertIndex)}\n${cardHtml}${withoutExistingCard.slice(insertIndex)}`;
}

async function writeProductFiles(data) {
  const pageHtml = renderProductPage(data);
  await fs.writeFile(path.join(ROOT_DIR, data.pageFile), pageHtml, "utf8");

  const sectionPagePath = path.join(ROOT_DIR, data.sectionPageFile);
  const picksHtml = await fs.readFile(sectionPagePath, "utf8");
  const cardHtml = renderProductCard(data, data.pageFile);
  const updatedPicksHtml = replaceOrInsertCard(
    picksHtml,
    data.sectionId,
    cardHtml,
    data.pageFile,
    data.affiliateUrl,
    data.sectionPageFile,
  );
  await fs.writeFile(sectionPagePath, updatedPicksHtml, "utf8");

  let productIndexUpdated = true;
  let productIndexError = null;
  let latestPageUpdated = true;
  let latestPageError = null;

  try {
    writeProductIndex();
  } catch (error) {
    productIndexUpdated = false;
    productIndexError = error.message || "Product index refresh failed.";
  }

  try {
    writeLatestPicksPage();
  } catch (error) {
    latestPageUpdated = false;
    latestPageError = error.message || "Latest picks refresh failed.";
  }

  return {
    pageFile: data.pageFile,
    sectionPagePath,
    productIndexUpdated,
    productIndexError,
    latestPageUpdated,
    latestPageError,
  };
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

  const brand = normalizeBrand(rawBrand, fullTitle);
  const shortTitle = input.shortTitle?.trim() || titleFromAmazonTitle(fullTitle, brand);
  const sectionIds = sections.map((section) => section.id);
  const sectionId = input.sectionId || inferSectionId(`${shortTitle} ${pathInfo.slugHint}`, sectionIds);
  const sectionLabel = sections.find((section) => section.id === sectionId)?.label || "Decor Picks";
  const price = extractMoney(html);
  const review = await generateReviewContent({
    shortTitle,
    brand,
    fullTitle,
    bullets,
    price,
    sectionLabel,
  });

  const analysis = createAnalysis(
    input,
    {
      asin: pathInfo.asin,
      slugHint: pathInfo.slugHint,
      fullTitle,
      brand,
      bullets,
      price,
      availability,
      shortTitle,
      sectionId,
      review,
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
        const requestBody = await readRequestBody(req);
        const analysis = canReuseProvidedAnalysis(requestBody, requestBody.analysis)
          ? requestBody.analysis
          : await analyzeAffiliateInput(requestBody);
        if (!analysis.price) {
          throw new Error(
            "Could not extract a live Amazon price. Pinterest product tags need price metadata, so publishing was blocked.",
          );
        }
        const publishResult = await writeProductFiles(analysis);
        json(res, 200, {
          ok: true,
          pageFile: publishResult.pageFile,
          pagePath: path.join(ROOT_DIR, publishResult.pageFile),
          picksHubPath: PICKS_HUB_PATH,
          sectionPagePath: publishResult.sectionPagePath,
          productIndexUpdated: publishResult.productIndexUpdated,
          productIndexError: publishResult.productIndexError,
          latestPageUpdated: publishResult.latestPageUpdated,
          latestPageError: publishResult.latestPageError,
          analysis: { ...analysis, pageFile: publishResult.pageFile, productUrl: `${SITE_URL}/${publishResult.pageFile}` },
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
  analyzeAffiliateInput,
  createServer,
  generateReviewContent,
  getSections,
  renderProductCard,
  renderProductPage,
  replaceOrInsertCard,
  writeProductFiles,
};
