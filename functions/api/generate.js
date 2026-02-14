function b64urlFromBytes(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlToBytes(b64url) {
  const b64 = String(b64url).replaceAll("-", "+").replaceAll("_", "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(b64url) {
  return new TextDecoder().decode(b64urlToBytes(b64url));
}

async function hmacSha256B64url(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64urlFromBytes(new Uint8Array(sig));
}

function getPaymentSecret(env) {
  const secret = env?.PAYMENT_JWT_SECRET ? String(env.PAYMENT_JWT_SECRET) : "";
  if (!secret || secret.length < 32) {
    throw new Error("Missing PAYMENT_JWT_SECRET. Set a long random secret (32+ chars).");
  }
  return secret;
}

async function verifyReceiptToken(env, token) {
  const secret = getPaymentSecret(env);
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid receipt token.");

  const [h, p, s] = parts;
  const msg = `${h}.${p}`;
  const expected = await hmacSha256B64url(secret, msg);
  if (s !== expected) throw new Error("Invalid receipt token.");

  const payload = JSON.parse(b64urlToString(p));
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== "dreamy-decor-generate") throw new Error("Invalid receipt token.");
  if (typeof payload.exp !== "number" || payload.exp <= now) throw new Error("Receipt expired.");
  if (payload.currency !== "USD" || payload.amount !== "1.00") throw new Error("Invalid receipt.");
  if (!payload.jti) throw new Error("Invalid receipt token.");
  return payload;
}

function getBearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeKieBase(url, fallback) {
  const raw = String(url || "").trim();
  if (!raw) return fallback;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getKieApiKey(env) {
  return env?.KIE_API_KEY
    ? String(env.KIE_API_KEY)
    : env?.NANO_BANANA_API_KEY
      ? String(env.NANO_BANANA_API_KEY)
      : "";
}

function pickResolution(env) {
  const requested = String(env?.NANO_BANANA_RESOLUTION || env?.OUTPUT_RESOLUTION || "2K")
    .toUpperCase()
    .replaceAll(" ", "");
  // Enforce "1K/2K only" to control cost.
  return requested === "1K" ? "1K" : "2K";
}

const ASPECT_RATIO_CHOICES = [
  { id: "1:1", r: 1 },
  { id: "2:3", r: 2 / 3 },
  { id: "3:4", r: 3 / 4 },
  { id: "4:5", r: 4 / 5 },
  { id: "9:16", r: 9 / 16 },
  { id: "5:4", r: 5 / 4 },
  { id: "4:3", r: 4 / 3 },
  { id: "3:2", r: 3 / 2 },
  { id: "16:9", r: 16 / 9 },
  { id: "21:9", r: 21 / 9 },
];

function aspectRatioFromDims(w, h) {
  const width = Number(w);
  const height = Number(h);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "auto";

  const ratio = width / height;
  let best = ASPECT_RATIO_CHOICES[0];
  let bestScore = Infinity;

  for (const c of ASPECT_RATIO_CHOICES) {
    const score = Math.abs(Math.log(ratio) - Math.log(c.r));
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best.id;
}

function extFromMime(mime) {
  const t = String(mime || "").toLowerCase();
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/jpg" || t === "image/jpeg") return "jpg";
  return "jpg";
}

const STYLE_LIBRARY = {
  "organic-modern": {
    name: "Organic Modern",
    prompt:
      "Organic modern interior design. Warm neutrals. Natural materials: light oak, linen, stone, clay. Soft curves. Layered textures. Calm styling. Subtle greenery.",
  },
  "modern-soft": {
    name: "Modern Soft",
    prompt:
      "Soft modern interior design. Bright neutrals. Clean lines. Matte finishes. Subtle texture. Cozy layered lighting. Minimal clutter.",
  },
  "contemporary-luxe": {
    name: "Contemporary Luxe",
    prompt:
      "Contemporary luxury interior design. Premium materials: marble/stone, brass, rich wood. Custom built-ins. Statement lighting. Refined palette. High-end styling.",
  },
  minimalist: {
    name: "Minimalist",
    prompt:
      "Minimalist interior design. Very clean, uncluttered surfaces. Hidden storage. Few well-chosen pieces. Neutral palette. Soft indirect lighting.",
  },
  "scandi-light": {
    name: "Scandi Light",
    prompt:
      "Scandinavian interior design. Airy white walls. Light wood. Simple functional furniture. Cozy textiles. Plenty of daylight. Gentle contrast.",
  },
  "nordic-noir": {
    name: "Nordic Noir",
    prompt:
      "Dark Scandinavian (Nordic noir). Charcoal and deep tones balanced with warm wood. Cozy textures. Moody lighting. Clean lines. Minimal clutter.",
  },
  "japandi-warm": {
    name: "Japandi Warm",
    prompt:
      "Japandi interior design (Japanese + Scandinavian). Natural wood, linen, earthy neutrals. Low-profile furniture. Minimal decor. Calm, warm, zen atmosphere.",
  },
  "wabi-sabi": {
    name: "Wabi-Sabi",
    prompt:
      "Wabi-sabi interior design. Imperfect natural textures. Handmade feel. Earthy palette. Patina. Simple forms. Quiet, serene mood.",
  },
  industrial: {
    name: "Industrial",
    prompt:
      "Industrial loft interior design. Concrete/brick/metal accents. Black steel details. Aged wood. Utilitarian lighting. City loft vibe.",
  },
  boho: {
    name: "Boho",
    prompt:
      "Bohemian interior design. Layered textiles. Warm colors. Mixed patterns. Rattan. Plants. Eclectic decor. Cozy warm lighting.",
  },
  "modern-farmhouse": {
    name: "Modern Farmhouse",
    prompt:
      "Modern farmhouse interior design. Warm whites. Rustic wood. Black accents. Cozy textiles. Practical storage. Welcoming, lived-in feel.",
  },
  coastal: {
    name: "Coastal",
    prompt:
      "Coastal interior design. Light airy palette. Soft blues and sandy neutrals. Natural fibers. Breezy curtains. Relaxed, bright atmosphere.",
  },
  "mid-century": {
    name: "Mid-Century",
    prompt:
      "Mid-century modern interior design. Warm woods. Tapered legs. Iconic silhouettes. Controlled bold accents. Vintage-modern balance.",
  },
  "art-deco": {
    name: "Art Deco",
    prompt:
      "Art Deco interior design. Geometric patterns. Symmetry. Velvet textures. Brass/gold accents. Marble touches. Jewel tones. Dramatic lighting.",
  },
  rustic: {
    name: "Rustic",
    prompt:
      "Rustic interior design. Natural wood, stone. Warm earth tones. Cozy textures. Cabin comfort. Soft warm lighting. Handmade details.",
  },
  traditional: {
    name: "Traditional",
    prompt:
      "Traditional interior design. Classic proportions. Timeless furniture. Layered fabrics. Warm palette. Tasteful art. Balanced symmetry.",
  },
  transitional: {
    name: "Transitional",
    prompt:
      "Transitional interior design. Blend of classic and modern. Neutral palette. Clean silhouettes. Subtle details. Calm sophistication.",
  },
  "french-country": {
    name: "French Country",
    prompt:
      "French country interior design. Elegant rustic. Soft creams. Weathered wood. Vintage charm. Delicate patterns. Warm inviting lighting.",
  },
  mediterranean: {
    name: "Mediterranean",
    prompt:
      "Mediterranean interior design. Sunlit plaster. Terracotta accents. Arches. Wrought iron. Patterned tile. Warm natural materials.",
  },
  "hollywood-regency": {
    name: "Hollywood Regency",
    prompt:
      "Hollywood Regency interior design. Glamorous. Mirrored accents. Lacquer. Velvet. Brass. Bold patterns. High contrast. Statement chandelier.",
  },
  maximalist: {
    name: "Maximalist",
    prompt:
      "Maximalist interior design. Rich color. Layered patterns. Curated decor. Gallery wall. Bold but cohesive styling. Lots of personality.",
  },
  "tropical-resort": {
    name: "Tropical Resort",
    prompt:
      "Tropical resort interior design. Rattan/cane textures. Lush greenery. Light fabrics. Breezy palette. Warm sunlight. Relaxed luxury.",
  },
  southwestern: {
    name: "Southwestern",
    prompt:
      "Southwestern interior design. Desert palette. Terracotta and clay tones. Woven textiles. Geometric patterns. Natural wood. Warm lighting.",
  },
  "dark-academia": {
    name: "Dark Academia",
    prompt:
      "Dark academia interior design. Moody library vibe. Dark wood. Vintage decor. Classic art. Warm lamp light. Deep tones and texture.",
  },
  cottagecore: {
    name: "Cottagecore",
    prompt:
      "Cottagecore interior design. Cozy cottage charm. Florals. Painted wood. Vintage details. Soft warm lighting. Gentle, homey atmosphere.",
  },
  "zen-spa": {
    name: "Zen Spa",
    prompt:
      "Zen spa interior design. Serene minimal. Stone and light wood. Soft indirect lighting. Clean lines. Calming neutral palette. Peaceful mood.",
  },
  "monochrome-modern": {
    name: "Monochrome Modern",
    prompt:
      "Monochrome modern interior design. Black, white, and gray palette. Bold contrast. Clean geometry. Minimal decor. Crisp lighting.",
  },
  "color-pop-eclectic": {
    name: "Color Pop Eclectic",
    prompt:
      "Eclectic interior design with playful color pops. Bold art. Mixed textures. Fun accents. Balanced composition. Cohesive overall styling.",
  },
};

const SPACE_HINTS = {
  kitchen:
    "Add cabinetry, countertops, backsplash, and realistic lighting. Keep appliances realistic. Keep sink/stove positions unchanged.",
  "living-room":
    "Add sofa, rug, coffee table, side tables, lighting, and wall art. Keep walkways clear and functional.",
  bedroom:
    "Add bed, headboard, linens, nightstands, curtains, and warm bedside lighting. Keep layout realistic.",
  bathroom:
    "Add vanity, mirror, tile, lighting, towels, and storage. Keep plumbing locations unchanged.",
  office: "Add desk, chair, storage, and task lighting. Keep it tidy and functional.",
  balcony: "Outdoor seating, plants, string lights, small table. Weather-appropriate materials.",
  patio: "Outdoor lounge or dining set, plants, rug, warm lighting. Weather-appropriate materials.",
  "dining-room": "Dining table, chairs, pendant/chandelier, rug, sideboard. Keep it practical.",
  other: "Add furniture and decor appropriate to the space while preserving layout.",
};

const BUDGET_HINTS = {
  affordable:
    "Use affordable materials and accessible furniture. Avoid luxury-only materials. Keep it practical and realistic.",
  mid: "Use mid-range materials and furniture. Comfortable, tasteful, not ultra-luxury.",
  luxury:
    "Use premium materials (marble/stone, solid wood, brass), custom built-ins, designer lighting, high-end styling.",
};

function resolveStyle(styleId) {
  const id = String(styleId || "").trim();
  if (id && STYLE_LIBRARY[id]) return STYLE_LIBRARY[id];
  return {
    name: id || "Cohesive",
    prompt: id ? `Interior design style: ${id}.` : "Cohesive interior design style.",
  };
}

function buildPrompt({ space, styleId, budget, notes }) {
  const style = resolveStyle(styleId);
  const spaceHint = SPACE_HINTS[String(space || "").trim()] || null;
  const budgetHint = BUDGET_HINTS[String(budget || "").trim()] || null;

  const parts = [
    "Interior redesign using the provided photo as the base image.",
    `Design style: ${style.name}.`,
    style.prompt,
    spaceHint ? `Space details: ${spaceHint}` : null,
    budgetHint ? `Budget: ${budgetHint}` : null,
    notes ? `User requests: ${notes}` : null,
    "Keep the room layout and camera angle unchanged.",
    "Preserve architecture: walls, ceiling, windows, doors, floors, and built-in elements stay in the same positions.",
    "Change only decor, furniture, lighting, materials, and color styling. No structural changes.",
    "No people, no pets, no text, no logos, no watermark.",
    "Photorealistic, realistic perspective, high detail, natural lighting.",
  ].filter(Boolean);
  return parts.join(" ");
}

function parseKvRecord(raw) {
  if (!raw) return null;
  if (raw === "used" || raw === "in_progress") return { status: raw };
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

async function uploadToKie({ uploadBase, apiKey, file }) {
  const url = `${uploadBase}/api/file-stream-upload`;
  const fd = new FormData();
  const safeName = `dreamy-${crypto.randomUUID()}.${extFromMime(file.type)}`;
  fd.append("file", file, safeName);
  fd.append("uploadPath", "images/dreamy-decor");
  fd.append("fileName", safeName);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: fd,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.msg || data?.message || "Failed to upload image.");
  }
  if (data?.success !== true) {
    throw new Error(data?.msg || "Failed to upload image.");
  }
  const downloadUrl = data?.data?.downloadUrl || data?.data?.url || null;
  if (!downloadUrl) throw new Error("Upload succeeded, but no downloadUrl was returned.");
  return downloadUrl;
}

async function createKieTask({ apiBase, apiKey, imageUrl, prompt, resolution, aspectRatio, outputFormat }) {
  const url = `${apiBase}/api/v1/jobs/createTask`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "nano-banana-pro",
      input: {
        prompt,
        image_input: [imageUrl],
        aspect_ratio: aspectRatio,
        resolution,
        output_format: outputFormat,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.msg || data?.message || "Failed to create generation task.");
  }
  if (data?.code && Number(data.code) !== 200) {
    throw new Error(data?.msg || data?.message || "Failed to create generation task.");
  }
  const taskId = data?.data?.taskId || data?.taskId || null;
  if (!taskId) throw new Error("Task created, but no taskId was returned.");
  return taskId;
}

async function getKieTask({ apiBase, apiKey, taskId }) {
  const url = `${apiBase}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.msg || data?.message || "Failed to fetch task status.");
  }
  if (data?.code && Number(data.code) !== 200) {
    throw new Error(data?.msg || data?.message || "Failed to fetch task status.");
  }
  return data?.data || null;
}

function parseResultUrls(taskData) {
  const raw = taskData?.resultJson;
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const urls = parsed?.resultUrls || parsed?.urls || null;
    if (Array.isArray(urls)) return urls.filter(Boolean).map(String);
    return [];
  } catch {
    return [];
  }
}

async function fetchImageStream(url) {
  const res = await fetch(url);
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok || !ct.startsWith("image/")) {
    throw new Error("Generated image URL was invalid.");
  }
  return { res, contentType: ct };
}

async function requireReceipt(request, env) {
  const token = getBearerToken(request);
  if (!token) throw new Error("Payment required.");
  return await verifyReceiptToken(env, token);
}

export const onRequestPost = async ({ request, env }) => {
  let receipt;
  try {
    receipt = await requireReceipt(request, env);
  } catch (e) {
    return json(401, { ok: false, error: e?.message || "Invalid payment." });
  }

  const kv = env?.PAYMENT_KV;
  const kvKey = `receipt:${receipt.jti}`;

  let attempts = 1;
  if (kv) {
    const existing = parseKvRecord(await kv.get(kvKey));
    if (existing) {
      if (existing.status === "used") {
        return json(409, { ok: false, error: "Receipt already used." });
      }
      if (existing.status === "in_progress") {
        if (existing.taskId) {
          return json(200, { ok: true, taskId: String(existing.taskId), state: "generating" });
        }
        return json(409, { ok: false, error: "Generation already in progress." });
      }
      if (existing.status === "failed") {
        attempts = Number(existing.attempts || 1) + 1;
        if (attempts > 2) {
          return json(409, { ok: false, error: "Receipt already used." });
        }
      }
    }
  }

  try {
    const form = await request.formData();
    const file = form.get("photo");
    const styleId = String(form.get("style") || "").trim();
    const space = String(form.get("space") || "").trim();
    const budget = String(form.get("budget") || "").trim();
    const notes = String(form.get("notes") || "").trim().slice(0, 260);
    const w = Number(form.get("w") || 0);
    const h = Number(form.get("h") || 0);

    if (!file || typeof file === "string") throw new Error("Missing photo upload.");
    if (!file.type || !file.type.startsWith("image/")) throw new Error("Unsupported file type.");
    if (file.size > 8_000_000) throw new Error("Image too large.");

    const apiKey = getKieApiKey(env);
    const apiBase = normalizeKieBase(env?.KIE_API_BASE_URL, "https://api.kie.ai");
    const uploadBase = normalizeKieBase(env?.KIE_UPLOAD_BASE_URL, "https://kieai.redpandaai.co");

    // Demo mode: no external generation configured yet.
    if (!apiKey) {
      if (kv) await kv.put(kvKey, "used", { expirationTtl: 30 * 24 * 3600 });
      return json(200, {
        ok: true,
        demo: true,
        message: "Nano Banana Pro (Kie.ai) is not configured yet. Returning demo response.",
      });
    }

    const imageUrl = await uploadToKie({ uploadBase, apiKey, file });
    const prompt = buildPrompt({ space, styleId, budget, notes });

    // Requirement: aspect ratio should match upload, and never generate 4K.
    const resolution = pickResolution(env);
    const aspectRatio = aspectRatioFromDims(w, h);
    const outputFormat = "png";

    const taskId = await createKieTask({
      apiBase,
      apiKey,
      imageUrl,
      prompt,
      resolution,
      aspectRatio,
      outputFormat,
    });

    if (kv) {
      await kv.put(
        kvKey,
        JSON.stringify({
          status: "in_progress",
          provider: "kie",
          taskId,
          attempts,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
        { expirationTtl: 2 * 60 * 60 },
      );
    }

    return json(200, { ok: true, taskId, state: "queued" });
  } catch (e) {
    if (kv) {
      await kv.put(
        kvKey,
        JSON.stringify({
          status: "failed",
          provider: "kie",
          attempts,
          updatedAt: Date.now(),
          error: e?.message || "Generation failed.",
        }),
        { expirationTtl: 30 * 60 },
      );
    }
    return json(400, { ok: false, error: e?.message || "Generation failed." });
  }
};

export const onRequestGet = async ({ request, env }) => {
  let receipt;
  try {
    receipt = await requireReceipt(request, env);
  } catch (e) {
    return json(401, { ok: false, error: e?.message || "Invalid payment." });
  }

  const url = new URL(request.url);
  const taskId = String(url.searchParams.get("taskId") || "").trim();
  if (!taskId) return json(400, { ok: false, error: "Missing taskId." });

  const kv = env?.PAYMENT_KV;
  const kvKey = `receipt:${receipt.jti}`;

  if (kv) {
    const existing = parseKvRecord(await kv.get(kvKey));
    if (!existing) return json(404, { ok: false, error: "Unknown receipt." });
    if (existing.status === "used") return json(409, { ok: false, error: "Receipt already used." });
    if (existing.status !== "in_progress") {
      return json(409, { ok: false, error: existing.error || "Generation is not available." });
    }
    if (existing.taskId && String(existing.taskId) !== taskId) {
      return json(403, { ok: false, error: "Invalid task for this receipt." });
    }
  }

  const apiKey = getKieApiKey(env);
  if (!apiKey) return json(409, { ok: false, error: "Generator is not configured." });

  const apiBase = normalizeKieBase(env?.KIE_API_BASE_URL, "https://api.kie.ai");

  try {
    const task = await getKieTask({ apiBase, apiKey, taskId });
    const state = String(task?.state || "").toLowerCase();

    if (state === "waiting" || state === "queuing" || state === "generating") {
      return json(200, { ok: true, state });
    }

    if (state === "fail" || state === "failed") {
      const errMsg = task?.failMsg || "Generation failed.";
      if (kv) {
        const existing = parseKvRecord(await kv.get(kvKey));
        const attempts = Number(existing?.attempts || 1);
        await kv.put(
          kvKey,
          JSON.stringify({
            status: "failed",
            provider: "kie",
            taskId,
            attempts,
            updatedAt: Date.now(),
            error: errMsg,
          }),
          { expirationTtl: 30 * 60 },
        );
      }
      return json(502, { ok: false, error: errMsg });
    }

    if (state !== "success") {
      return json(200, { ok: true, state: state || "unknown" });
    }

    const urls = parseResultUrls(task);
    const firstUrl = urls[0];
    if (!firstUrl) throw new Error("Task succeeded, but no output URL was returned.");

    const { res, contentType } = await fetchImageStream(firstUrl);

    if (kv) await kv.put(kvKey, "used", { expirationTtl: 30 * 24 * 3600 });

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Disposition", 'inline; filename="dreamy-decor.png"');
    return new Response(res.body, { status: 200, headers });
  } catch (e) {
    return json(400, { ok: false, error: e?.message || "Failed to fetch result." });
  }
};
