const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env.local");
const BLOG_INDEX_PATH = path.join(ROOT_DIR, "blog.html");
const TMP_DIR = path.join(ROOT_DIR, ".blog-generator-tmp");
const OPENROUTER_THROTTLE_PATH = path.join(TMP_DIR, "openrouter-last-call.json");
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const DEFAULT_OPENROUTER_MIN_REQUEST_INTERVAL_MS = 25000;
const DEFAULT_OPENROUTER_RETRY_COOLDOWN_MS = 90000;
const MIN_WORDS = 1100;
const MAX_WORDS = 1200;

const ALLOWED_TAGS = [
  "living room",
  "bedroom",
  "bathroom",
  "kitchen",
  "outdoor",
  "small spaces",
  "lighting",
  "rugs",
  "storage",
  "entryway",
  "home office",
  "plants",
  "decor",
];

const AD_FRIENDLY_CONTENT_RULES = `Ad-network quality rules:
- Write original, reader-first content with specific decor decisions, tradeoffs, common mistakes, and practical next steps.
- Keep it family-safe and brand-safe. Avoid adult or sexual content, graphic violence, hate, harassment, weapons, drugs, gambling, politics, medical claims, financial claims, illegal activity, and unsafe instructions.
- Do not write clickbait, misleading promises, fake expertise, fake personal experience, copied product claims, or thin filler.
- Do not keyword-stuff. Use the main decor phrase naturally.
- Do not mention ads, monetization, AdSense, affiliate programs, or policy compliance in the article.
- Do not invent exact dimensions, prices, brands, materials, safety claims, or performance claims that are not visible or provided.
- Make the post useful enough to stand alone without ads: include placement guidance, what to measure or check, when to skip an idea, and how to avoid clutter.`;

const REQUIRED_ENV = [
  "OPENROUTER_API_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_BASE_URL",
];

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
};

const requireEnv = () => {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment values: ${missing.join(", ")}`);
  }
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatCategoryLabel = (value) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return text;
  }
  return /\bdecor$/i.test(text) ? text : `${text} decor`;
};

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 78);

const normalizeBaseUrl = (value) => String(value || "").replace(/\/+$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readIntegerEnv = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const readOpenRouterThrottleState = () => {
  if (!fs.existsSync(OPENROUTER_THROTTLE_PATH)) {
    return { lastRequestAt: 0, cooldownUntil: 0 };
  }

  try {
    const state = JSON.parse(fs.readFileSync(OPENROUTER_THROTTLE_PATH, "utf8"));
    return {
      lastRequestAt: Number(state.lastRequestAt) || 0,
      cooldownUntil: Number(state.cooldownUntil) || 0,
    };
  } catch {
    return { lastRequestAt: 0, cooldownUntil: 0 };
  }
};

const writeOpenRouterThrottleState = (state) => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(OPENROUTER_THROTTLE_PATH, JSON.stringify(state));
};

const throttleOpenRouter = async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const minRequestIntervalMs = readIntegerEnv(
    "OPENROUTER_MIN_REQUEST_INTERVAL_MS",
    DEFAULT_OPENROUTER_MIN_REQUEST_INTERVAL_MS
  );
  const state = readOpenRouterThrottleState();
  const waitUntil = Math.max(state.lastRequestAt + minRequestIntervalMs, state.cooldownUntil);
  const waitMs = waitUntil - Date.now();

  if (waitMs > 0) {
    console.log(`Waiting ${Math.ceil(waitMs / 1000)}s for OpenRouter pacing...`);
    await sleep(waitMs);
  }

  writeOpenRouterThrottleState({
    lastRequestAt: Date.now(),
    cooldownUntil: Math.max(state.cooldownUntil, Date.now()),
  });
};

const applyOpenRouterRetryCooldown = async (attempt, status) => {
  const baseCooldownMs = readIntegerEnv("OPENROUTER_RETRY_COOLDOWN_MS", DEFAULT_OPENROUTER_RETRY_COOLDOWN_MS);
  const cooldownMs = baseCooldownMs * attempt;
  const state = readOpenRouterThrottleState();
  const cooldownUntil = Date.now() + cooldownMs;

  writeOpenRouterThrottleState({
    lastRequestAt: state.lastRequestAt || Date.now(),
    cooldownUntil: Math.max(state.cooldownUntil, cooldownUntil),
  });

  console.log(`OpenRouter returned ${status}. Cooling down ${Math.ceil(cooldownMs / 1000)}s before retry...`);
  await sleep(cooldownMs);
};

const getContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  throw new Error(`Unsupported image type "${ext}". Use JPG, PNG, or WebP.`);
};

const hmac = (key, value, encoding) => crypto.createHmac("sha256", key).update(value).digest(encoding);
const sha256 = (value, encoding = "hex") => crypto.createHash("sha256").update(value).digest(encoding);

const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const signR2Put = ({ body, contentType, objectKey }) => {
  const endpoint = new URL(process.env.R2_ENDPOINT);
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const encodedKey = objectKey.split("/").map(encodeRfc3986).join("/");
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const payloadHash = sha256(body);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${endpoint.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request"
  );
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    url: `${endpoint.origin}${canonicalUri}`,
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
    },
  };
};

const uploadToR2 = async (imagePath) => {
  const body = fs.readFileSync(imagePath);
  const contentType = getContentType(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const baseName = slugify(path.basename(imagePath, ext)) || "decor-blog-image";
  const objectKey = `blog-generator/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${baseName}${ext}`;
  const signedRequest = signR2Put({ body, contentType, objectKey });
  const response = await fetch(signedRequest.url, {
    method: "PUT",
    headers: signedRequest.headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`R2 upload failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return `${normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL)}/${objectKey}`;
};

const getExistingBlogSlugs = () => {
  const slugs = new Set();

  if (!fs.existsSync(BLOG_INDEX_PATH)) {
    return slugs;
  }

  const html = fs.readFileSync(BLOG_INDEX_PATH, "utf8");
  for (const match of html.matchAll(/href="blog-([^"]+?)\.html"/g)) {
    slugs.add(slugify(match[1]));
  }

  for (const fileName of fs.readdirSync(ROOT_DIR)) {
    const match = fileName.match(/^blog-(.+)\.html$/);
    if (match) {
      slugs.add(slugify(match[1]));
    }
  }

  return slugs;
};

const makeUniqueSlug = (slug, existingSlugs) => {
  if (!existingSlugs.has(slug)) {
    return slug;
  }

  let index = 2;
  let candidate = `${slug}-${index}`;
  while (existingSlugs.has(candidate)) {
    index += 1;
    candidate = `${slug}-${index}`;
  }
  return candidate;
};

const buildPrompt = (imageUrl) => `You write production blog content for Dreamy Decor, a practical home decor website.

Analyze the decor or room image and choose one genuinely useful article topic based on what is visible. Return one strict JSON object only, with no markdown.

${AD_FRIENDLY_CONTENT_RULES}

Hard rules:
- The article body must be 1100-1200 words when counting introParagraphs, quickWin, every section paragraph, and checklist items.
- Never copy labels, placeholder wording, or example values from the JSON shape. Generate real titles, summaries, section headings, paragraphs, and checklist items.
- The topic must be useful and action-oriented, not vague inspiration. It should help a reader fix a real room problem or make a better decor decision.
- Do not write about recipes, food, fashion, beauty, travel, or unrelated lifestyle topics.
- Do not invent brands, prices, product dimensions, or materials that are not visible. Use generic decor guidance unless the image clearly supports a detail.
- Use a natural editorial voice: practical, specific, and calm.
- The title should include the decor topic and the reader benefit.
- Use one tag from this exact list: ${ALLOWED_TAGS.join(", ")}.
- Slug must be lowercase kebab-case without the "blog-" prefix.
- Description must be one sentence under 155 characters.
- Include 5-7 sections. Each section needs 2 paragraphs.
- Checklist must contain 5-7 useful action items.
- Do not include image URLs in the JSON.

Image URL: ${imageUrl}

JSON shape:
{
  "slug": "real-lowercase-kebab-case-topic",
  "tag": "one allowed tag",
  "title": "real decor title with a reader benefit",
  "description": "real one-sentence summary under 155 characters",
  "imageAlt": "real description of the uploaded decor image",
  "introParagraphs": ["real introduction paragraph", "real introduction paragraph"],
  "quickWin": "real immediately useful decor tip",
  "sections": [
    {
      "heading": "1. real section heading",
      "paragraphs": ["real section paragraph", "real section paragraph"]
    }
  ],
  "checklist": ["real action item", "real action item"]
}`;

const buildResizePrompt = ({ blog, imageUrl, wordCount }) => `Rewrite this Dreamy Decor blog JSON so the article body is ${MIN_WORDS}-${MAX_WORDS} words.

Return one strict JSON object only. Keep the exact same JSON shape. Keep 5-7 sections, exactly 2 paragraphs per section, and 5-7 checklist items. Keep the topic useful and decor-specific. Do not include markdown.

${AD_FRIENDLY_CONTENT_RULES}

Current word count: ${wordCount}
Image URL: ${imageUrl}
Allowed tags: ${ALLOWED_TAGS.join(", ")}

Blog JSON:
${JSON.stringify(blog)}`;

const buildJsonRepairPrompt = ({ sourceText, imageUrl, reason }) => `Repair the model output below into one valid Dreamy Decor blog JSON object.

Return strict JSON only. Do not include markdown. Do not explain.

${AD_FRIENDLY_CONTENT_RULES}

Repair reason: ${reason}
Image URL: ${imageUrl}

Requirements:
- Article body must be ${MIN_WORDS}-${MAX_WORDS} words.
- Never copy labels, placeholder wording, or example values from the JSON shape. Generate real titles, summaries, section headings, paragraphs, and checklist items.
- Use one tag from this exact list: ${ALLOWED_TAGS.join(", ")}.
- Keep the topic useful, practical, and home decor specific.
- Include 2 introParagraphs.
- Include one quickWin.
- Include 5-7 sections.
- Each section must have a heading and exactly 2 paragraphs.
- Include 5-7 checklist items.
- Do not include image URLs in the JSON.

JSON shape:
{
  "slug": "real-lowercase-kebab-case-topic",
  "tag": "one allowed tag",
  "title": "real decor title with a reader benefit",
  "description": "real one-sentence summary under 155 characters",
  "imageAlt": "real description of the uploaded decor image",
  "introParagraphs": ["real introduction paragraph", "real introduction paragraph"],
  "quickWin": "real immediately useful decor tip",
  "sections": [
    {
      "heading": "1. real section heading",
      "paragraphs": ["real section paragraph", "real section paragraph"]
    }
  ],
  "checklist": ["real action item", "real action item"]
}

Output to repair:
${sourceText}`;

const buildStructureRepairPrompt = ({ blog, imageUrl, reason }) => `Fix this Dreamy Decor blog JSON so it is complete and publishable.

Return strict JSON only. Do not include markdown. Do not explain.

${AD_FRIENDLY_CONTENT_RULES}

Problem: ${reason}
Image URL: ${imageUrl}
Allowed tags: ${ALLOWED_TAGS.join(", ")}

Requirements:
- Article body must be ${MIN_WORDS}-${MAX_WORDS} words.
- Preserve the same topic where possible.
- Include 2 introParagraphs.
- Include one quickWin.
- Include 5-7 sections.
- Each section must have a heading and exactly 2 paragraphs.
- Include 5-7 checklist items.
- Keep all content useful, practical, and home decor specific.

Blog JSON:
${JSON.stringify(blog)}`;

const extractMessageContent = (payload) => {
  const choice = payload.choices?.[0];
  const message = choice?.message || {};
  const content = message.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
};

const summarizeEmptyOpenRouterResponse = (payload) => {
  const choice = payload.choices?.[0] || {};
  const message = choice.message || {};
  const details = {
    finish_reason: choice.finish_reason || choice.native_finish_reason || null,
    error: choice.error || payload.error || null,
    message_keys: Object.keys(message),
    usage: payload.usage || null,
  };

  return JSON.stringify(details);
};

const postOpenRouter = async (body) => {
  let lastErrorText = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await throttleOpenRouter();

    const response = await fetch(process.env.OPENROUTER_API_BASE_URL || "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || process.env.SITE_URL || "https://dreamydecor.ai",
        "X-Title": "Dreamy Decor Blog Maker",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json();
    }

    lastErrorText = `${response.status} ${response.statusText}\n${await response.text()}`;
    if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      break;
    }

    await applyOpenRouterRetryCooldown(attempt, response.status);
  }

  throw new Error(`OpenRouter request failed: ${lastErrorText}`);
};

const requestBlog = async (imageUrl) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(imageUrl) },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0.18,
    max_tokens: 6500,
  });

  const content = extractMessageContent(payload);
  if (!content.includes("{")) {
    throw new Error(`OpenRouter did not return JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`);
  }

  return parseBlogJsonOrRepair({ content, imageUrl, context: "initial generation" });
};

const resizeBlog = async ({ blog, imageUrl, wordCount }) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: buildResizePrompt({ blog, imageUrl, wordCount }),
      },
    ],
    temperature: 0.08,
    max_tokens: 6500,
  });

  const content = extractMessageContent(payload);
  if (!content.includes("{")) {
    throw new Error(`OpenRouter resize pass did not return JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`);
  }

  return parseBlogJsonOrRepair({ content, imageUrl, context: "word-count revision" });
};

const repairMalformedBlogJson = async ({ sourceText, imageUrl, reason }) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: buildJsonRepairPrompt({ sourceText, imageUrl, reason }),
      },
    ],
    temperature: 0,
    max_tokens: 6500,
  });

  const content = extractMessageContent(payload);
  if (!content.includes("{")) {
    throw new Error(`OpenRouter JSON repair pass did not return JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`);
  }

  return parseBlogJson(content);
};

const repairStructuredBlog = async ({ blog, imageUrl, reason }) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: buildStructureRepairPrompt({ blog, imageUrl, reason }),
      },
    ],
    temperature: 0,
    max_tokens: 6500,
  });

  const content = extractMessageContent(payload);
  if (!content.includes("{")) {
    throw new Error(`OpenRouter structure repair pass did not return JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`);
  }

  return parseBlogJsonOrRepair({ content, imageUrl, context: "structure repair" });
};

const parseBlogJsonOrRepair = async ({ content, imageUrl, context }) => {
  try {
    return parseBlogJson(content);
  } catch (error) {
    console.log(`OpenRouter returned malformed JSON during ${context}. Running JSON repair pass...`);
    return repairMalformedBlogJson({
      sourceText: content,
      imageUrl,
      reason: error.message,
    });
  }
};

const parseBlogJson = (content) => {
  const trimmed = String(content).trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find JSON object in OpenRouter response:\n${content}`);
  }

  return JSON.parse(withoutFence.slice(start, end + 1));
};

const normalizeParagraphs = (values, min = 1) => {
  const paragraphs = Array.isArray(values)
    ? values.map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];

  if (paragraphs.length < min) {
    throw new Error("Generated blog is missing required paragraphs.");
  }

  return paragraphs;
};

const assertAdFriendlyBlog = (blog) => {
  const articleText = [
    blog.title,
    blog.description,
    blog.imageAlt,
    ...blog.introParagraphs,
    blog.quickWin,
    ...blog.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
    ...blog.checklist,
  ]
    .join(" ")
    .toLowerCase();

  const blockedPatterns = [
    /\badsense\b/,
    /\bad network\b/,
    /\baffiliate program\b/,
    /\bmonetization\b/,
    /\bcasino\b/,
    /\bbetting\b/,
    /\bgambling\b/,
    /\bweapon\b/,
    /\bfirearm\b/,
    /\bcocaine\b/,
    /\bheroin\b/,
    /\bporn\b/,
    /\bsexual\b/,
    /\bnude\b/,
    /\bgraphic violence\b/,
    /\bhate speech\b/,
    /\belection fraud\b/,
    /\bguaranteed income\b/,
    /\bmedical advice\b/,
  ];

  const blocked = blockedPatterns.find((pattern) => pattern.test(articleText));
  if (blocked) {
    throw new Error(`Generated blog includes ad-unfriendly content: ${blocked}`);
  }

  const templatePatterns = [
    /\buseful decor article title\b/,
    /\bone short sentence for the blog card and meta description\b/,
    /\bdescriptive alt text for the uploaded decor image\b/,
    /\bparagraph one\b/,
    /\bparagraph two\b/,
    /\bspecific section heading\b/,
    /\baction item\b/,
    /\breal decor title with a reader benefit\b/,
    /\breal section paragraph\b/,
    /\breal action item\b/,
    /\bone allowed tag\b/,
  ];

  const copiedTemplate = templatePatterns.find((pattern) => pattern.test(articleText));
  if (copiedTemplate) {
    throw new Error(`Generated blog copied template placeholder text: ${copiedTemplate}`);
  }
};

const normalizeBlog = (rawBlog, imageUrl) => {
  const tag = String(rawBlog.tag || "").trim().toLowerCase();
  const normalized = {
    slug: slugify(rawBlog.slug || rawBlog.title),
    tag: ALLOWED_TAGS.includes(tag) ? tag : "decor",
    title: String(rawBlog.title || "").replace(/\s+/g, " ").trim(),
    description: String(rawBlog.description || "").replace(/\s+/g, " ").trim(),
    image: imageUrl,
    imageAlt: String(rawBlog.imageAlt || rawBlog.title || "Decor blog image").replace(/\s+/g, " ").trim(),
    introParagraphs: normalizeParagraphs(rawBlog.introParagraphs, 2),
    quickWin: String(rawBlog.quickWin || "").replace(/\s+/g, " ").trim(),
    sections: Array.isArray(rawBlog.sections)
      ? rawBlog.sections
          .map((section) => ({
            heading: String(section.heading || "").replace(/\s+/g, " ").trim(),
            paragraphs: normalizeParagraphs(section.paragraphs, 2),
          }))
          .filter((section) => section.heading && section.paragraphs.length)
      : [],
    checklist: Array.isArray(rawBlog.checklist)
      ? rawBlog.checklist.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean)
      : [],
  };

  if (!normalized.slug) throw new Error("Generated blog is missing a usable slug.");
  if (!normalized.title) throw new Error("Generated blog is missing title.");
  if (!normalized.description) throw new Error("Generated blog is missing description.");
  if (!normalized.quickWin) throw new Error("Generated blog is missing quickWin.");
  if (normalized.sections.length < 5) throw new Error("Generated blog needs at least 5 sections.");
  if (normalized.checklist.length < 5) throw new Error("Generated blog needs at least 5 checklist items.");
  assertAdFriendlyBlog(normalized);

  return normalized;
};

const normalizeBlogOrRepair = async ({ rawBlog, imageUrl, context }) => {
  try {
    return normalizeBlog(rawBlog, imageUrl);
  } catch (error) {
    console.log(`Generated blog structure failed validation during ${context}. Running structure repair pass...`);
    return normalizeBlog(
      await repairStructuredBlog({
        blog: rawBlog,
        imageUrl,
        reason: error.message,
      }),
      imageUrl
    );
  }
};

const getArticleWordSource = (blog) =>
  [
    ...blog.introParagraphs,
    blog.quickWin,
    ...blog.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
    "Checklist",
    ...blog.checklist,
  ].join(" ");

const countWords = (value) => {
  const matches = String(value)
    .replace(/<[^>]+>/g, " ")
    .match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g);
  return matches ? matches.length : 0;
};

const trimTextToWords = (value, maxWords) => {
  const words = String(value).match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*|[^\sA-Za-z0-9]+/g) || [];
  let wordCount = 0;
  const kept = [];

  for (const token of words) {
    if (/[A-Za-z0-9]/.test(token)) {
      wordCount += 1;
    }

    if (wordCount > maxWords) {
      break;
    }

    kept.push(token);
  }

  const trimmed = kept.join(" ").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed.replace(/[,;:]$/, "")}.`;
};

const plainHeading = (heading) =>
  String(heading || "")
    .replace(/^\s*\d+[.)-]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const expansionParagraphsForSection = (blog, section, index) => {
  const room = blog.tag === "decor" ? "space" : blog.tag;
  const topic = plainHeading(section.heading) || "this idea";
  const title = blog.title.toLowerCase();

  return [
    `A practical way to use this step is to make one small change, then judge the whole ${room} from the doorway. That view shows whether ${topic} is helping the room feel calmer or simply adding another object. If the change does not make the main view cleaner, remove one item before adding another.`,
    `Check scale before you shop. Measure the wall, tabletop, walkway, or seating zone connected to ${topic}, then choose pieces that fill enough visual space without blocking daily use. In a ${room}, one substantial lamp, mirror, basket, tray, or textile often looks more intentional than several tiny accents spread around.`,
    `Think about maintenance as part of the design. If ${topic} creates a surface that is hard to dust, a basket that is awkward to reach, or a path that people have to step around, it will not stay attractive for long. The best decor choice should make the room easier to live with, not only better for a photo.`,
    `Use repetition to make the decision look deliberate. Repeat one finish, texture, shape, or color from ${topic} in another part of the ${room}, but keep the repeat subtle. A matching wood tone, woven texture, warm metal, or soft fabric link is usually enough to make separate pieces feel connected.`,
    `Look at the room in different lighting before deciding the step is finished. Morning light, evening shadows, and lamp light can change how ${topic} reads. If the detail disappears at night, move it closer to a warm light source; if it feels too loud during the day, reduce contrast or simplify the surrounding surface.`,
    `Leave negative space around the main choice. Shelves, counters, coffee tables, nightstands, and walls all need a little open room so the useful pieces can stand out. When everything is filled, even attractive decor starts to read as storage overflow instead of styling.`,
    `Use a quick photo test for ${title}. Take one straight-on photo and one photo from the normal walking path through the ${room}. The photos will reveal crooked spacing, uneven visual weight, and small clutter faster than staring at the room in person.`,
    `Know when to skip the idea. If the ${room} already has a strong focal point, heavy pattern, or limited walkway space, ${topic} may need to be quieter than expected. In that case, choose a lower-contrast version, use a smaller supporting piece, or put the budget toward lighting, storage, or scale first.`,
  ].slice(index % 3, index % 3 + 4);
};

const expandShortBlogLocally = (blog, startingWordCount) => {
  const expanded = {
    ...blog,
    introParagraphs: [...blog.introParagraphs],
    sections: blog.sections.map((section) => ({
      ...section,
      paragraphs: [...section.paragraphs],
    })),
    checklist: [...blog.checklist],
  };

  console.log(`Generated blog was ${startingWordCount} words. Expanding locally to ${MIN_WORDS}-${MAX_WORDS} words...`);

  const candidates = expanded.sections.flatMap((section, index) =>
    expansionParagraphsForSection(expanded, section, index).map((paragraph) => ({ sectionIndex: index, paragraph }))
  );

  let wordCount = startingWordCount;
  let cursor = 0;

  while (wordCount < MIN_WORDS && cursor < candidates.length) {
    const candidate = candidates[cursor];
    const remaining = MAX_WORDS - wordCount;
    if (remaining < 24) {
      break;
    }

    const candidateWordCount = countWords(candidate.paragraph);
    const paragraph = candidateWordCount > remaining ? trimTextToWords(candidate.paragraph, remaining) : candidate.paragraph;

    expanded.sections[candidate.sectionIndex].paragraphs.push(paragraph);
    wordCount = countWords(getArticleWordSource(expanded));
    cursor += 1;
  }

  if (wordCount < MIN_WORDS) {
    throw new Error(`Local expansion ended at ${wordCount} words; expected ${MIN_WORDS}-${MAX_WORDS}.`);
  }

  assertAdFriendlyBlog(expanded);
  return { blog: expanded, wordCount };
};

const ensureTargetWordCount = async ({ rawBlog, imageUrl }) => {
  let blog = await normalizeBlogOrRepair({ rawBlog, imageUrl, context: "initial generation" });
  let wordCount = countWords(getArticleWordSource(blog));

  if (wordCount >= MIN_WORDS && wordCount <= MAX_WORDS) {
    return { blog, wordCount };
  }

  if (wordCount < MIN_WORDS) {
    return expandShortBlogLocally(blog, wordCount);
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`Generated blog was ${wordCount} words. Requesting ${MIN_WORDS}-${MAX_WORDS} word revision...`);
    const revisedBlog = await resizeBlog({ blog, imageUrl, wordCount });
    blog = await normalizeBlogOrRepair({
      rawBlog: revisedBlog,
      imageUrl,
      context: `word-count revision ${attempt}`,
    });
    wordCount = countWords(getArticleWordSource(blog));

    if (wordCount >= MIN_WORDS && wordCount <= MAX_WORDS) {
      return { blog, wordCount };
    }

    if (wordCount < MIN_WORDS) {
      return expandShortBlogLocally(blog, wordCount);
    }
  }

  throw new Error(`Generated blog word count is ${wordCount}; expected ${MIN_WORDS}-${MAX_WORDS}.`);
};

const formatDate = (date) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

const toIsoDate = (date) => date.toISOString().slice(0, 10);

const renderJsonLd = ({ blog, fileName, date }) => {
  const siteUrl = normalizeBaseUrl(process.env.SITE_URL || "https://dreamydecor.ai");
  const pageUrl = `${siteUrl}/${fileName}`;
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "Article",
      mainEntityOfPage: pageUrl,
      headline: blog.title,
      description: blog.description,
      image: [blog.image],
      datePublished: toIsoDate(date),
      dateModified: toIsoDate(date),
      author: {
        "@type": "Organization",
        name: "Dreamy Decor",
      },
      publisher: {
        "@type": "Organization",
        name: "Dreamy Decor",
      },
      articleSection: blog.tag,
    },
    null,
    6
  ).replace(/</g, "\\u003c");
};

const renderBlogPage = ({ blog, fileName, date }) => {
  const siteUrl = normalizeBaseUrl(process.env.SITE_URL || "https://dreamydecor.ai");
  const pageUrl = `${siteUrl}/${fileName}`;
  const title = `DREAMY DECOR | ${blog.title}`;
  const displayDate = formatDate(date);
  const jsonLd = renderJsonLd({ blog, fileName, date });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="p:domain_verify" content="9c6037d438a25ef0f7bd7f38b3ce4d23" />
    <meta
      name="description"
      content="${escapeHtml(blog.description)}"
    />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="DREAMY DECOR" />
    <meta property="og:title" content="${escapeHtml(blog.title)}" />
    <meta property="og:description" content="${escapeHtml(blog.description)}" />
    <meta property="og:image" content="${escapeHtml(blog.image)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="article:section" content="${escapeHtml(blog.tag)}" />
    <meta property="article:published_time" content="${escapeHtml(toIsoDate(date))}T00:00:00+00:00" />
    <meta property="article:modified_time" content="${escapeHtml(toIsoDate(date))}T00:00:00+00:00" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(blog.title)}" />
    <meta name="twitter:description" content="${escapeHtml(blog.description)}" />
    <meta name="twitter:image" content="${escapeHtml(blog.image)}" />
    <script type="application/ld+json">
      ${jsonLd}
    </script>
    <title>${escapeHtml(title)}</title>

    <link rel="icon" href="static/favicon.svg?v=20260214" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600..900&family=Space+Grotesk:wght@400..700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="static/style.css?v=2026050702" />
  </head>
  <body>
    <div class="bg" aria-hidden="true"></div>

    <header class="top">
      <a class="brand" href="index.html" aria-label="DREAMY DECOR home">
        <span class="brand__mark" aria-hidden="true">DD</span>
        <span class="brand__word">DREAMY DECOR</span>
      </a>
      <nav class="nav" aria-label="Primary">
        <a class="nav__link" href="picks.html">Decor Picks</a>
        <a class="nav__link" href="blog.html">Blog</a>
      </nav>
    </header>

    <main class="doc">
      <article class="docCard prose">
        <div class="crumbs">
          <a href="blog.html">Blog</a>
          <span aria-hidden="true">/</span>
          <span>${escapeHtml(formatCategoryLabel(blog.tag))}</span>
          <span aria-hidden="true">-</span>
          <span>${escapeHtml(displayDate)}</span>
        </div>

        <h1>${escapeHtml(blog.title)}</h1>
        <figure class="blogHeroImage">
          <img src="${escapeHtml(blog.image)}" alt="${escapeHtml(blog.imageAlt)}" />
        </figure>
${blog.introParagraphs.map((paragraph) => `        <p>${escapeHtml(paragraph)}</p>`).join("\n")}

        <div class="callout">
          <div class="callout__k">Quick win</div>
          <div class="callout__v">${escapeHtml(blog.quickWin)}</div>
        </div>

${blog.sections
  .map(
    (section) => `        <h2>${escapeHtml(section.heading)}</h2>
${section.paragraphs.map((paragraph) => `        <p>${escapeHtml(paragraph)}</p>`).join("\n")}`
  )
  .join("\n\n")}

        <div class="callout">
          <div class="callout__k">Checklist</div>
          <div class="callout__v">
            <ul>
${blog.checklist.map((item) => `              <li>${escapeHtml(item)}</li>`).join("\n")}
            </ul>
          </div>
        </div>
      </article>
      <section class="footer">
        <div class="footer__left">
          <div class="footBrand">DREAMY DECOR</div>
          <div class="footNote">Blog-first decor ideas, practical room guides, and curated affiliate-backed picks.</div>
        </div>
        <div class="footer__right">
          <a class="nav__link" href="about-us.html">About Us</a>
          <a class="nav__link" href="contact-us.html">Contact Us</a>
          <a class="nav__link" href="privacy.html">Privacy Policy</a>
          <a class="nav__link" href="affiliate-disclosure.html">Affiliate Disclosure</a>
        </div>
      </section>
    </main>
    <script src="static/site-search.js?v=20260401" defer></script>
  </body>
</html>
`;
};

const renderBlogCard = ({ blog, fileName, date }) => `          <article class="postCard">
            <a class="postCard__thumb" href="${escapeHtml(fileName)}" aria-label="Read ${escapeHtml(blog.title)}">
              <img src="${escapeHtml(blog.image)}" alt="" loading="lazy" />
            </a>
            <div class="postCard__top">
              <div class="postCard__tag">${escapeHtml(formatCategoryLabel(blog.tag))}</div>
              <div class="postCard__date">${escapeHtml(formatDate(date))}</div>
            </div>
            <h2 class="postCard__t">${escapeHtml(blog.title)}</h2>
            <p class="postCard__c">
              ${escapeHtml(blog.description)}
            </p>
            <div class="postCard__a">
              <a class="btn" href="${escapeHtml(fileName)}">Read</a>
            </div>
          </article>`;

const updateBlogIndex = ({ blog, fileName, date }) => {
  const html = fs.readFileSync(BLOG_INDEX_PATH, "utf8");
  const card = renderBlogCard({ blog, fileName, date });
  const updated = html.replace(
    /(<div class="postGrid" aria-label="Posts">\r?\n)/,
    (_match, open) => `${open}${card}\n\n`
  );

  if (updated === html) {
    throw new Error("Could not find blog post grid in blog.html.");
  }

  fs.writeFileSync(BLOG_INDEX_PATH, updated);
};

const main = async () => {
  loadEnvFile(ENV_PATH);
  requireEnv();

  const imagePath = process.argv[2];
  if (!imagePath) {
    throw new Error('Usage: node tools/generate-blog-from-image.js "C:\\path\\to\\decor-image.jpeg"');
  }

  const resolvedImagePath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedImagePath)) {
    throw new Error(`Image file not found: ${resolvedImagePath}`);
  }

  console.log("Uploading image to R2...");
  const imageUrl = await uploadToR2(resolvedImagePath);
  console.log(`Uploaded image: ${imageUrl}`);

  console.log("Requesting useful decor blog from OpenRouter...");
  const rawBlog = await requestBlog(imageUrl);
  const { blog, wordCount } = await ensureTargetWordCount({ rawBlog, imageUrl });

  const existingSlugs = getExistingBlogSlugs();
  blog.slug = makeUniqueSlug(blog.slug, existingSlugs);
  const fileName = `blog-${blog.slug}.html`;
  const date = new Date();
  fs.writeFileSync(path.join(ROOT_DIR, fileName), renderBlogPage({ blog, fileName, date }));
  updateBlogIndex({ blog, fileName, date });

  console.log(`Generated blog: ${blog.title} (${blog.slug}) - ${wordCount} words`);
  console.log(`Done: ${fileName}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
