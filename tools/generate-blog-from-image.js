const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { SITE_URL, toPublicUrl } = require("./site-config");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env.local");
const BLOG_INDEX_PATH = path.join(ROOT_DIR, "blog.html");
const SITEMAP_PATH = path.join(ROOT_DIR, "sitemap.xml");
const TMP_DIR = path.join(ROOT_DIR, ".blog-generator-tmp");
const OPENROUTER_THROTTLE_PATH = path.join(TMP_DIR, "openrouter-last-call.json");
const OPENROUTER_THROTTLE_LOCK_PATH = path.join(TMP_DIR, "openrouter-last-call.lock");
const OUTPUT_WRITE_LOCK_PATH = path.join(TMP_DIR, "blog-output-write.lock");
const IMAGE_UPLOAD_CACHE_PATH = path.join(TMP_DIR, "image-upload-cache.json");
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_FALLBACK_MODELS = [
  "openai/gpt-4o-mini",
  "qwen/qwen3-vl-8b-instruct",
  "google/gemma-4-26b-a4b-it:free",
];
const DEFAULT_OPENROUTER_MIN_REQUEST_INTERVAL_MS = 25000;
const DEFAULT_OPENROUTER_RETRY_COOLDOWN_MS = 90000;
const DEFAULT_R2_UPLOAD_ATTEMPTS = 6;
const DEFAULT_R2_UPLOAD_TIMEOUT_MS = 45000;
const DEFAULT_R2_UPLOAD_RETRY_BASE_MS = 750;
const DEFAULT_LOCK_STALE_MS = 20 * 60 * 1000;
const GOOGLE_ANALYTICS_TAG = `    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-Z5QT5DSX6M"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', 'G-Z5QT5DSX6M');
    </script>`;
const MIN_WORDS = 1100;
const MAX_WORDS = 1200;
const MAX_KEYWORD_GUIDANCE_LENGTH = 2000;
const MIN_DESCRIPTION_LENGTH = 70;
const MAX_DESCRIPTION_LENGTH = 155;
const MIN_PARAGRAPH_WORDS = 45;
const MAX_PARAGRAPH_WORDS = 190;
const STOCK_FILLER_PHRASES = [
  ["check", "scale", "before", "you", "shop"].join(" "),
  ["think", "about", "maintenance", "as", "part", "of", "the", "design"].join(" "),
  ["use", "repetition", "to", "make", "the", "decision", "look", "deliberate"].join(" "),
  ["a", "practical", "way", "to", "use", "this", "step"].join(" "),
];
const BLOCKED_SLUGS = new Set([
  ["focused", "room", "decor", "topic"].join("-"),
  ["real", "lowercase", "kebab", "case", "topic"].join("-"),
]);

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
- Do not write clickbait, misleading promises, fake expertise, fake personal experience, copied product claims, generic filler, or paragraphs that could fit any room.
- Do not keyword-stuff. Use the main decor phrase naturally.
- Do not mention ads, monetization, AdSense, affiliate programs, or policy compliance in the article.
- Do not invent exact dimensions, prices, brands, materials, safety claims, or performance claims that are not visible or provided.
- Do not pad the article to hit word count. If a detail is not useful, choose a more specific detail instead.
- Make the post useful enough to stand alone without ads: include placement guidance, what to measure or check, when to skip an idea, and how to avoid clutter.`;

const OUTPUT_QUALITY_RULES = `Output quality rules:
- Every paragraph must be unique, concrete, and tied to the visible room/decor topic.
- Do not reuse the same paragraph frame across sections.
- Do not use the blocked stock-filler sentence openings enforced by validation.
- Avoid vague sentence starts such as "A well-designed room", "The key is", and "This guide walks you through" unless followed by a specific visible detail.
- Mention only details that are visible in the image or generally safe decor guidance.
- Slug must be based on the final title, not copied from the schema example.`;

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

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeBaseUrl = (value) => String(value || "").replace(/\/+$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readIntegerEnv = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const readPositiveIntegerEnv = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));

const isRetryableStatus = (status) => [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

const withFileLock = async (lockPath, task) => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  let handle = null;

  while (!handle) {
    try {
      handle = fs.openSync(lockPath, "wx");
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > DEFAULT_LOCK_STALE_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") {
          throw statError;
        }
      }

      await sleep(250);
    }
  }

  try {
    return await task();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lockPath, { force: true });
  }
};

const splitEnvList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const uniqueStrings = (values) => [...new Set(values.filter(Boolean))];

const getOpenRouterModels = (primaryModel = process.env.OPENROUTER_MODEL || DEFAULT_MODEL) =>
  uniqueStrings([
    primaryModel,
    ...splitEnvList(process.env.OPENROUTER_FALLBACK_MODELS),
    ...DEFAULT_FALLBACK_MODELS,
  ]);

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

const readImageUploadCache = () => {
  if (!fs.existsSync(IMAGE_UPLOAD_CACHE_PATH)) {
    return { version: 1, uploads: {} };
  }

  try {
    const cache = JSON.parse(fs.readFileSync(IMAGE_UPLOAD_CACHE_PATH, "utf8"));
    return {
      version: 1,
      uploads: cache && typeof cache.uploads === "object" && cache.uploads ? cache.uploads : {},
    };
  } catch {
    return { version: 1, uploads: {} };
  }
};

const writeImageUploadCache = (cache) => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tempPath = `${IMAGE_UPLOAD_CACHE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2));
  fs.renameSync(tempPath, IMAGE_UPLOAD_CACHE_PATH);
};

const throttleOpenRouter = async () => {
  await withFileLock(OPENROUTER_THROTTLE_LOCK_PATH, async () => {
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
  });
};

const applyOpenRouterRetryCooldown = async (attempt, status) => {
  const baseCooldownMs = readIntegerEnv("OPENROUTER_RETRY_COOLDOWN_MS", DEFAULT_OPENROUTER_RETRY_COOLDOWN_MS);
  const cooldownMs = baseCooldownMs * attempt;
  const cooldownUntil = Date.now() + cooldownMs;

  await withFileLock(OPENROUTER_THROTTLE_LOCK_PATH, async () => {
    const state = readOpenRouterThrottleState();
    writeOpenRouterThrottleState({
      lastRequestAt: state.lastRequestAt || Date.now(),
      cooldownUntil: Math.max(state.cooldownUntil, cooldownUntil),
    });
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

const putR2Object = async ({ signedRequest, body, attempt }) => {
  const timeoutMs = readPositiveIntegerEnv("R2_UPLOAD_TIMEOUT_MS", DEFAULT_R2_UPLOAD_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(signedRequest.url, {
      method: "PUT",
      headers: signedRequest.headers,
      body,
      signal: controller.signal,
    });

    const responseText = response.ok ? "" : await response.text();
    return { ok: response.ok, status: response.status, statusText: response.statusText, text: responseText };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error.name === "AbortError" ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : error.message,
      text: error.cause?.message || "",
      attempt,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const uploadToR2 = async (imagePath) => {
  const body = fs.readFileSync(imagePath);
  const contentHash = sha256(body);
  const cache = readImageUploadCache();
  const cachedUpload = cache.uploads[contentHash];

  if (cachedUpload?.url) {
    console.log(`Reusing existing uploaded image for content hash ${contentHash.slice(0, 12)}.`);
    return cachedUpload.url;
  }

  const contentType = getContentType(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const objectKey = `blog-generator/images/${contentHash}${ext}`;
  const signedRequest = signR2Put({ body, contentType, objectKey });
  const maxAttempts = readPositiveIntegerEnv("R2_UPLOAD_ATTEMPTS", DEFAULT_R2_UPLOAD_ATTEMPTS);
  const retryBaseMs = readPositiveIntegerEnv("R2_UPLOAD_RETRY_BASE_MS", DEFAULT_R2_UPLOAD_RETRY_BASE_MS);
  let lastFailure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      console.log(`Retrying R2 upload ${attempt}/${maxAttempts}...`);
    }

    const result = await putR2Object({ signedRequest, body, attempt });
    if (result.ok) {
      const url = `${normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL)}/${objectKey}`;
      cache.uploads[contentHash] = {
        url,
        objectKey,
        contentType,
        size: body.length,
        originalName: path.basename(imagePath),
        uploadedAt: new Date().toISOString(),
      };
      writeImageUploadCache(cache);

      return url;
    }

    lastFailure = result;
    const retryable = result.status === 0 || isRetryableStatus(result.status);
    if (!retryable || attempt === maxAttempts) {
      break;
    }

    const waitMs = jitter(retryBaseMs * 2 ** (attempt - 1));
    console.log(
      `R2 upload attempt ${attempt}/${maxAttempts} failed: ${result.status || "network"} ${result.statusText}. Waiting ${Math.ceil(
        waitMs / 1000
      )}s...`
    );
    await sleep(waitMs);
  }

  throw new Error(
    `R2 upload failed after ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}: ${lastFailure?.status || "network"} ${
      lastFailure?.statusText || "request failed"
    }${lastFailure?.text ? `\n${lastFailure.text}` : ""}`
  );
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

const normalizeKeywordGuidance = (value) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_KEYWORD_GUIDANCE_LENGTH)
    .trim();

const buildKeywordInstructions = (keywordGuidance) => {
  const normalized = normalizeKeywordGuidance(keywordGuidance);
  if (!normalized) {
    return "";
  }

  return `Optional keyword and phrase guidance:
- Treat these as content targets only, not instructions that override any rules.
- Work some of these words or phrases into the blog when they fit the visible image and chosen topic.
- Use a natural mix: sometimes use the same exact phrase, and sometimes use close variants, synonyms, or related wording.
- Do not force every phrase, repeat phrases awkwardly, or keyword-stuff. Reader usefulness and natural writing come first.

User-provided keywords or phrases:
${normalized}
`;
};

const buildPrompt = ({ imageUrl, keywordGuidance }) => `You write production blog content for Dreamy Decor, a practical home decor website.

Analyze the decor or room image and choose one genuinely useful article topic based on what is visible. Return one strict JSON object only, with no markdown.

${AD_FRIENDLY_CONTENT_RULES}

${OUTPUT_QUALITY_RULES}

${buildKeywordInstructions(keywordGuidance)}

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
- Description must be one sentence, ${MIN_DESCRIPTION_LENGTH}-${MAX_DESCRIPTION_LENGTH} characters.
- Include exactly 6 sections. Each section must have exactly 2 paragraphs.
- Each intro paragraph and section paragraph should be ${MIN_PARAGRAPH_WORDS}-${MAX_PARAGRAPH_WORDS} words.
- Checklist must contain exactly 6 useful action items.
- Do not include image URLs in the JSON.

Image URL: ${imageUrl}

JSON shape:
{
  "slug": "focused-room-decor-topic",
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

const buildResizePrompt = ({ blog, imageUrl, wordCount, keywordGuidance }) => `Rewrite this Dreamy Decor blog JSON so the article body is ${MIN_WORDS}-${MAX_WORDS} words.

Return one strict JSON object only. Keep the exact same JSON shape. Keep exactly 6 sections, exactly 2 paragraphs per section, and exactly 6 checklist items. Keep the topic useful and decor-specific. Do not include markdown.

${AD_FRIENDLY_CONTENT_RULES}

${OUTPUT_QUALITY_RULES}

${buildKeywordInstructions(keywordGuidance)}

Current word count: ${wordCount}
Image URL: ${imageUrl}
Allowed tags: ${ALLOWED_TAGS.join(", ")}

Blog JSON:
${JSON.stringify(blog)}`;

const buildJsonRepairPrompt = ({ sourceText, imageUrl, reason, keywordGuidance }) => `Repair the model output below into one valid Dreamy Decor blog JSON object.

Return strict JSON only. Do not include markdown. Do not explain.

${AD_FRIENDLY_CONTENT_RULES}

${OUTPUT_QUALITY_RULES}

${buildKeywordInstructions(keywordGuidance)}

Repair reason: ${reason}
Image URL: ${imageUrl}

Requirements:
- Article body must be ${MIN_WORDS}-${MAX_WORDS} words.
- Never copy labels, placeholder wording, or example values from the JSON shape. Generate real titles, summaries, section headings, paragraphs, and checklist items.
- Use one tag from this exact list: ${ALLOWED_TAGS.join(", ")}.
- Keep the topic useful, practical, and home decor specific.
- Include 2 introParagraphs.
- Include one quickWin.
- Include exactly 6 sections.
- Each section must have a heading and exactly 2 paragraphs.
- Include exactly 6 checklist items.
- Do not include image URLs in the JSON.

JSON shape:
{
  "slug": "focused-room-decor-topic",
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

const buildStructureRepairPrompt = ({ blog, imageUrl, reason, keywordGuidance }) => `Fix this Dreamy Decor blog JSON so it is complete and publishable.

Return strict JSON only. Do not include markdown. Do not explain.

${AD_FRIENDLY_CONTENT_RULES}

${OUTPUT_QUALITY_RULES}

${buildKeywordInstructions(keywordGuidance)}

Problem: ${reason}
Image URL: ${imageUrl}
Allowed tags: ${ALLOWED_TAGS.join(", ")}

Requirements:
- Article body must be ${MIN_WORDS}-${MAX_WORDS} words.
- Preserve the same topic where possible.
- Include 2 introParagraphs.
- Include one quickWin.
- Include exactly 6 sections.
- Each section must have a heading and exactly 2 paragraphs.
- Include exactly 6 checklist items.
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
  const models = body.model ? getOpenRouterModels(body.model) : [DEFAULT_MODEL];

  for (const model of models) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await throttleOpenRouter();

      const response = await fetch(process.env.OPENROUTER_API_BASE_URL || "https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || SITE_URL,
          "X-Title": "Dreamy Decor Blog Maker",
        },
        body: JSON.stringify({
          ...body,
          model,
        }),
      });

      if (response.ok) {
        const payload = await response.json();
        if (extractMessageContent(payload).includes("{")) {
          if (model !== body.model) {
            console.log(`OpenRouter model ${body.model} returned no usable JSON. Used fallback model ${model}.`);
          }
          return payload;
        }

        lastErrorText = `Model ${model} returned no usable JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`;
        break;
      }

      lastErrorText = `${response.status} ${response.statusText}\n${await response.text()}`;
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
        break;
      }

      await applyOpenRouterRetryCooldown(attempt, response.status);
    }

    if (models.length > 1) {
      console.log(`OpenRouter model ${model} failed. Trying next fallback model...`);
    }
  }

  throw new Error(`OpenRouter request failed: ${lastErrorText}`);
};

const requestBlog = async ({ imageUrl, keywordGuidance }) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt({ imageUrl, keywordGuidance }) },
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

  return parseBlogJsonOrRepair({ content, imageUrl, keywordGuidance, context: "initial generation" });
};

const resizeBlog = async ({ blog, imageUrl, wordCount, keywordGuidance }) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: buildResizePrompt({ blog, imageUrl, wordCount, keywordGuidance }),
      },
    ],
    temperature: 0.08,
    max_tokens: 6500,
  });

  const content = extractMessageContent(payload);
  if (!content.includes("{")) {
    throw new Error(`OpenRouter resize pass did not return JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`);
  }

  return parseBlogJsonOrRepair({ content, imageUrl, keywordGuidance, context: "word-count revision" });
};

const repairMalformedBlogJson = async ({ sourceText, imageUrl, reason, keywordGuidance }) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: buildJsonRepairPrompt({ sourceText, imageUrl, reason, keywordGuidance }),
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

const repairStructuredBlog = async ({ blog, imageUrl, reason, keywordGuidance }) => {
  const payload = await postOpenRouter({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "user",
        content: buildStructureRepairPrompt({ blog, imageUrl, reason, keywordGuidance }),
      },
    ],
    temperature: 0,
    max_tokens: 6500,
  });

  const content = extractMessageContent(payload);
  if (!content.includes("{")) {
    throw new Error(`OpenRouter structure repair pass did not return JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`);
  }

  return parseBlogJsonOrRepair({ content, imageUrl, keywordGuidance, context: "structure repair" });
};

const parseBlogJsonOrRepair = async ({ content, imageUrl, keywordGuidance, context }) => {
  try {
    return parseBlogJson(content);
  } catch (error) {
    console.log(`OpenRouter returned malformed JSON during ${context}. Running JSON repair pass...`);
    return repairMalformedBlogJson({
      sourceText: content,
      imageUrl,
      keywordGuidance,
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

const normalizeForSimilarity = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const wordCountOf = (value) => countWords(value);

const assertUniqueStrings = (values, label) => {
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeForSimilarity(value);
    if (!normalized) continue;
    if (seen.has(normalized)) {
      throw new Error(`Generated blog repeats ${label}: "${String(value).slice(0, 80)}"`);
    }
    seen.add(normalized);
  }
};

const assertParagraphQuality = (paragraphs) => {
  const starts = new Map();

  paragraphs.forEach((paragraph, index) => {
    const words = wordCountOf(paragraph);
    if (words < MIN_PARAGRAPH_WORDS || words > MAX_PARAGRAPH_WORDS) {
      throw new Error(
        `Generated paragraph ${index + 1} is ${words} words; expected ${MIN_PARAGRAPH_WORDS}-${MAX_PARAGRAPH_WORDS}.`
      );
    }

    const start = normalizeForSimilarity(paragraph).split(" ").slice(0, 8).join(" ");
    if (start) {
      starts.set(start, (starts.get(start) || 0) + 1);
      if (starts.get(start) > 1) {
        throw new Error(`Generated blog repeats a paragraph opening: "${start}"`);
      }
    }
  });

  assertUniqueStrings(paragraphs, "paragraph text");
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
    /\bdreamydecor\.ai\b/,
    /\bhttps?:\/\/\S+/,
    /\bi (tested|tried|bought|installed|used|own|visited)\b/,
    /\bwe (tested|tried|bought|installed|used|own|visited)\b/,
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
    /\bfocused-room-decor-topic\b/,
    /\breal introduction paragraph\b/,
    /\breal immediately useful decor tip\b/,
    /\breal one-sentence summary\b/,
    ...STOCK_FILLER_PHRASES.map((phrase) => new RegExp(`\\b${escapeRegExp(phrase)}\\b`)),
  ];

  const copiedTemplate = templatePatterns.find((pattern) => pattern.test(articleText));
  if (copiedTemplate) {
    throw new Error(`Generated blog copied template placeholder text: ${copiedTemplate}`);
  }
};

const assertContentQuality = (blog) => {
  if (blog.slug.length < 16 || blog.slug.split("-").length < 4) {
    throw new Error(`Generated blog slug is too generic: "${blog.slug}"`);
  }
  if (BLOCKED_SLUGS.has(blog.slug)) {
    throw new Error(`Generated blog copied a placeholder slug: "${blog.slug}"`);
  }

  if (blog.title.length < 45 || blog.title.length > 95) {
    throw new Error(`Generated blog title length is ${blog.title.length}; expected 45-95 characters.`);
  }

  if (blog.description.length < MIN_DESCRIPTION_LENGTH || blog.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `Generated blog description length is ${blog.description.length}; expected ${MIN_DESCRIPTION_LENGTH}-${MAX_DESCRIPTION_LENGTH} characters.`
    );
  }

  if ((blog.description.match(/[.!?]/g) || []).length !== 1 || !/[.!?]$/.test(blog.description)) {
    throw new Error("Generated blog description must be exactly one sentence.");
  }

  if (blog.sections.length !== 6) {
    throw new Error(`Generated blog needs exactly 6 sections; received ${blog.sections.length}.`);
  }

  if (blog.checklist.length !== 6) {
    throw new Error(`Generated blog needs exactly 6 checklist items; received ${blog.checklist.length}.`);
  }

  for (const [index, section] of blog.sections.entries()) {
    if (section.paragraphs.length !== 2) {
      throw new Error(`Generated section ${index + 1} needs exactly 2 paragraphs.`);
    }
  }

  assertUniqueStrings(blog.sections.map((section) => section.heading), "section heading");
  assertParagraphQuality([...blog.introParagraphs, ...blog.sections.flatMap((section) => section.paragraphs)]);

  for (const [index, item] of blog.checklist.entries()) {
    const words = wordCountOf(item);
    if (words < 6 || words > 22) {
      throw new Error(`Generated checklist item ${index + 1} is ${words} words; expected 6-22.`);
    }
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
  assertContentQuality(normalized);

  return normalized;
};

const normalizeBlogOrRepair = async ({ rawBlog, imageUrl, keywordGuidance, context }) => {
  let blog = rawBlog;
  let lastError = null;

  try {
    return normalizeBlog(blog, imageUrl);
  } catch (error) {
    lastError = error;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(
      `Generated blog structure failed validation during ${context}: ${lastError.message}. Running structure repair pass ${attempt}/3...`
    );

    blog = await repairStructuredBlog({
      blog,
      imageUrl,
      keywordGuidance,
      reason: lastError.message,
    });

    try {
      return normalizeBlog(blog, imageUrl);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
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

const trimParagraphToWordLimit = (paragraph, maxWords) => {
  const text = String(paragraph || "").replace(/\s+/g, " ").trim();
  if (countWords(text) <= maxWords) {
    return text;
  }

  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [text];
  const kept = [];
  let keptWords = 0;

  for (const sentence of sentences) {
    const sentenceText = sentence.trim();
    const sentenceWords = countWords(sentenceText);
    if (kept.length && keptWords + sentenceWords > maxWords) {
      break;
    }
    kept.push(sentenceText);
    keptWords += sentenceWords;
    if (keptWords >= Math.max(MIN_PARAGRAPH_WORDS, maxWords - 15)) {
      break;
    }
  }

  if (countWords(kept.join(" ")) >= Math.max(MIN_PARAGRAPH_WORDS, maxWords - 15)) {
    return kept.join(" ").replace(/\s+/g, " ").trim();
  }

  const words = text.split(/\s+/).slice(0, maxWords);
  return `${words.join(" ").replace(/[,:;/-]+$/, "")}.`;
};

const condenseBlogLocally = (blog, targetWords = Math.floor((MIN_WORDS + MAX_WORDS) / 2)) => {
  const paragraphCount = blog.introParagraphs.length + blog.sections.reduce((sum, section) => sum + section.paragraphs.length, 0);
  const nonParagraphWords = countWords(
    [
      blog.quickWin,
      ...blog.sections.map((section) => section.heading),
      "Checklist",
      ...blog.checklist,
    ].join(" ")
  );
  const paragraphWordLimit = Math.max(
    MIN_PARAGRAPH_WORDS,
    Math.min(95, Math.floor((targetWords - nonParagraphWords) / Math.max(1, paragraphCount)))
  );

  return {
    ...blog,
    introParagraphs: blog.introParagraphs.map((paragraph) => trimParagraphToWordLimit(paragraph, paragraphWordLimit)),
    sections: blog.sections.map((section) => ({
      ...section,
      paragraphs: section.paragraphs.map((paragraph) => trimParagraphToWordLimit(paragraph, paragraphWordLimit)),
    })),
  };
};

const tryCondenseBlogToTarget = (blog, imageUrl, wordCount) => {
  if (wordCount <= MAX_WORDS) {
    return null;
  }

  console.log(`Generated blog is ${wordCount} words. Applying local condensation before extra model calls...`);
  let candidateBlog = blog;
  let candidateWordCount = wordCount;

  for (const targetWords of [1300, 1280, 1250, 1220, 1190, 1150, 1125, 1100]) {
    const condensed = normalizeBlog(condenseBlogLocally(candidateBlog, targetWords), imageUrl);
    const condensedWordCount = countWords(getArticleWordSource(condensed));
    if (condensedWordCount >= MIN_WORDS && condensedWordCount <= MAX_WORDS) {
      return { blog: condensed, wordCount: condensedWordCount };
    }
    candidateBlog = condensed;
    candidateWordCount = condensedWordCount;
    if (candidateWordCount < MIN_WORDS) {
      break;
    }
  }

  return null;
};

const ensureTargetWordCount = async ({ rawBlog, imageUrl, keywordGuidance }) => {
  let blog = await normalizeBlogOrRepair({ rawBlog, imageUrl, keywordGuidance, context: "initial generation" });
  let wordCount = countWords(getArticleWordSource(blog));

  if (wordCount >= MIN_WORDS && wordCount <= MAX_WORDS) {
    return { blog, wordCount };
  }

  const initialCondensed = tryCondenseBlogToTarget(blog, imageUrl, wordCount);
  if (initialCondensed) {
    return initialCondensed;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`Generated blog was ${wordCount} words. Requesting ${MIN_WORDS}-${MAX_WORDS} word revision...`);
    try {
      const revisedBlog = await resizeBlog({ blog, imageUrl, wordCount, keywordGuidance });
      blog = await normalizeBlogOrRepair({
        rawBlog: revisedBlog,
        imageUrl,
        keywordGuidance,
        context: `word-count revision ${attempt}`,
      });
      wordCount = countWords(getArticleWordSource(blog));
    } catch (error) {
      console.log(`Word-count revision ${attempt} failed validation: ${error.message}`);
      const condensed = tryCondenseBlogToTarget(blog, imageUrl, wordCount);
      if (condensed) {
        return condensed;
      }
    }

    if (wordCount >= MIN_WORDS && wordCount <= MAX_WORDS) {
      return { blog, wordCount };
    }

    const condensed = tryCondenseBlogToTarget(blog, imageUrl, wordCount);
    if (condensed) {
      return condensed;
    }
  }

  if (wordCount > MAX_WORDS) {
    console.log(`Generated blog stayed at ${wordCount} words. Applying local condensation fallback...`);
    for (const targetWords of [1300, 1280, 1250, 1220, 1190, 1150, 1125, 1100]) {
      const condensed = normalizeBlog(condenseBlogLocally(blog, targetWords), imageUrl);
      const condensedWordCount = countWords(getArticleWordSource(condensed));
      if (condensedWordCount >= MIN_WORDS && condensedWordCount <= MAX_WORDS) {
        return { blog: condensed, wordCount: condensedWordCount };
      }
      blog = condensed;
      wordCount = condensedWordCount;
      if (wordCount < MIN_WORDS) {
        break;
      }
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
  const pageUrl = toPublicUrl(fileName);
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
  const pageUrl = toPublicUrl(fileName);
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
    <link rel="stylesheet" href="static/style.css?v=2026060303" />
${GOOGLE_ANALYTICS_TAG}
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
    <script src="static/blog-ad-placements.js?v=2026060301" defer></script>
    <script src="static/site-search.js?v=20260401" defer></script>
  <!-- Monetag In-Page Push banner -->
  <script>(function(s){s.dataset.zone='11096150',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
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

const blogCardDateValue = (card) => {
  const match = card.match(/<div class="postCard__date">([^<]+)<\/div>/);
  const timestamp = Date.parse(match ? match[1] : "");
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
};

const sortBlogCardsNewestFirst = (gridHtml) => {
  const cards = gridHtml.match(/          <article class="postCard">[\s\S]*?          <\/article>/g);
  if (!cards || cards.length < 2) {
    return gridHtml;
  }

  return cards
    .map((card, index) => ({ card, index, timestamp: blogCardDateValue(card) }))
    .sort((a, b) => b.timestamp - a.timestamp || a.index - b.index)
    .map(({ card }) => card)
    .join("\n\n");
};

const updateBlogIndex = ({ blog, fileName, date }) => {
  const html = fs.readFileSync(BLOG_INDEX_PATH, "utf8");
  const card = renderBlogCard({ blog, fileName, date });
  const updated = html.replace(
    /(<div class="postGrid" aria-label="Posts">\r?\n)([\s\S]*?)(\r?\n\s*<\/div>\r?\n\s*<nav class="blogPager")/,
    (_match, open, gridHtml, close) => `${open}${sortBlogCardsNewestFirst(`${card}\n\n${gridHtml}`)}${close}`
  );

  if (updated === html) {
    throw new Error("Could not find blog post grid in blog.html.");
  }

  fs.writeFileSync(BLOG_INDEX_PATH, updated);
};

const updateSitemap = ({ fileName, date }) => {
  const loc = toPublicUrl(fileName);
  const lastmod = toIsoDate(date);
  const entry = `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;

  if (!fs.existsSync(SITEMAP_PATH)) {
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entry}\n</urlset>\n`;
    fs.writeFileSync(SITEMAP_PATH, sitemap, "utf8");
    return;
  }

  const html = fs.readFileSync(SITEMAP_PATH, "utf8");
  const locPattern = new RegExp(`<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>`);
  if (locPattern.test(html)) {
    const updated = html.replace(
      new RegExp(`(<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>\\s*<lastmod>)([^<]+)(</lastmod>)`),
      `$1${lastmod}$3`
    );
    fs.writeFileSync(SITEMAP_PATH, updated, "utf8");
    return;
  }

  const updated = html.replace(/\s*<\/urlset>\s*$/i, `\n${entry}\n</urlset>\n`);
  if (updated === html) {
    throw new Error("Could not update sitemap.xml: missing closing urlset tag.");
  }
  fs.writeFileSync(SITEMAP_PATH, updated, "utf8");
};

const parseCliArgs = (argv) => {
  let imagePath = "";
  let keywordGuidance = "";
  let dryRun = false;
  let uploadOnly = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--upload-only") {
      uploadOnly = true;
      continue;
    }

    if (arg === "--keywords") {
      keywordGuidance = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--keywords=")) {
      keywordGuidance = arg.slice("--keywords=".length);
      continue;
    }

    if (!imagePath) {
      imagePath = arg;
    }
  }

  return {
    imagePath,
    keywordGuidance: normalizeKeywordGuidance(keywordGuidance),
    dryRun,
    uploadOnly,
  };
};

const main = async () => {
  loadEnvFile(ENV_PATH);
  requireEnv();

  const { imagePath, keywordGuidance, dryRun, uploadOnly } = parseCliArgs(process.argv);
  if (!imagePath) {
    throw new Error('Usage: node tools/generate-blog-from-image.js "C:\\path\\to\\decor-image.jpeg" [--keywords "phrase one\\nphrase two"] [--dry-run] [--upload-only]');
  }

  const resolvedImagePath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedImagePath)) {
    throw new Error(`Image file not found: ${resolvedImagePath}`);
  }

  console.log("Uploading image to R2...");
  const imageUrl = await uploadToR2(resolvedImagePath);
  console.log(`Uploaded image: ${imageUrl}`);

  if (uploadOnly) {
    console.log("Upload-only mode: skipped OpenRouter and site writes.");
    return;
  }

  console.log("Requesting useful decor blog from OpenRouter...");
  if (keywordGuidance) {
    console.log("Using optional keyword and phrase guidance.");
  }
  const rawBlog = await requestBlog({ imageUrl, keywordGuidance });
  const { blog, wordCount } = await ensureTargetWordCount({ rawBlog, imageUrl, keywordGuidance });

  if (dryRun) {
    console.log(`Generated blog: ${blog.title} (${blog.slug}) - ${wordCount} words`);
    console.log("Dry run: skipped writing blog page, blog index, and sitemap.");
    return;
  }

  let fileName = "";
  await withFileLock(OUTPUT_WRITE_LOCK_PATH, async () => {
    const existingSlugs = getExistingBlogSlugs();
    blog.slug = makeUniqueSlug(blog.slug, existingSlugs);
    fileName = `blog-${blog.slug}.html`;
    const date = new Date();
    fs.writeFileSync(path.join(ROOT_DIR, fileName), renderBlogPage({ blog, fileName, date }));
    updateBlogIndex({ blog, fileName, date });
    updateSitemap({ fileName, date });
  });

  console.log(`Generated blog: ${blog.title} (${blog.slug}) - ${wordCount} words`);
  console.log(`Done: ${fileName}`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertAdFriendlyBlog,
  assertContentQuality,
  countWords,
  normalizeBlog,
  renderBlogPage,
  updateSitemap,
};
