const MAX_SIDE_PX = 1920;
const MAX_UPLOAD_BYTES = 8_000_000; // server enforces too; keep UI aligned

const STYLE_PRESETS = [
  {
    id: "organic-modern",
    name: "Organic Modern",
    tag: "natural",
    desc: "Warm neutrals, natural textures, soft curves.",
    swatches: ["#f4efe7", "#c8b29a", "#2c2a2a"],
    demoFilter: "contrast(1.06) saturate(1.02) brightness(1.02) sepia(0.06)",
  },
  {
    id: "modern-soft",
    name: "Modern Soft",
    tag: "clean",
    desc: "Bright neutrals, crisp lines, calm contrast.",
    swatches: ["#f7f2ea", "#cdb9a8", "#15131b"],
    demoFilter: "contrast(1.08) saturate(1.06) brightness(1.03)",
  },
  {
    id: "contemporary-luxe",
    name: "Contemporary Luxe",
    tag: "premium",
    desc: "High-end finishes, statement lighting, refined palette.",
    swatches: ["#f6f1e8", "#1a1a1a", "#c8a86b"],
    demoFilter: "contrast(1.12) saturate(1.04) brightness(1.0)",
  },
  {
    id: "minimalist",
    name: "Minimalist",
    tag: "simple",
    desc: "Uncluttered, calm, and intentional.",
    swatches: ["#f7f6f2", "#d7d3cc", "#1a1a1a"],
    demoFilter: "contrast(1.04) saturate(0.9) brightness(1.07)",
  },
  {
    id: "scandi-light",
    name: "Scandi Light",
    tag: "airy",
    desc: "Whites, light wood feel, gentle tones.",
    swatches: ["#f8f7f2", "#dfd8cc", "#b08a52"],
    demoFilter: "contrast(1.02) saturate(0.92) brightness(1.08)",
  },
  {
    id: "nordic-noir",
    name: "Nordic Noir",
    tag: "moody",
    desc: "Dark Scandi: charcoal tones, warm wood, cozy light.",
    swatches: ["#111114", "#3a3a43", "#c8a77a"],
    demoFilter: "contrast(1.12) saturate(0.92) brightness(0.96)",
  },
  {
    id: "japandi-warm",
    name: "Japandi Warm",
    tag: "zen",
    desc: "Natural textures with warm minimalism.",
    swatches: ["#f4efe6", "#bda68b", "#2a2a2a"],
    demoFilter: "contrast(1.05) saturate(0.98) brightness(1.02) sepia(0.08)",
  },
  {
    id: "wabi-sabi",
    name: "Wabi-Sabi",
    tag: "earthy",
    desc: "Imperfect textures, quiet warmth, handmade feel.",
    swatches: ["#f0eadf", "#a98f7b", "#3a332f"],
    demoFilter: "contrast(1.04) saturate(0.96) brightness(1.01) sepia(0.12)",
  },
  {
    id: "industrial",
    name: "Industrial",
    tag: "loft",
    desc: "Raw materials, moody edges, city energy.",
    swatches: ["#e9e6e1", "#6d6e72", "#1a1a1a"],
    demoFilter: "contrast(1.14) saturate(0.85) brightness(0.98)",
  },
  {
    id: "boho",
    name: "Boho",
    tag: "plants",
    desc: "Warm layers, texture, color, relaxed vibe.",
    swatches: ["#f7e9d3", "#c46b42", "#2f6a52"],
    demoFilter: "contrast(1.05) saturate(1.18) brightness(1.02) sepia(0.08)",
  },
  {
    id: "modern-farmhouse",
    name: "Modern Farmhouse",
    tag: "cozy",
    desc: "Warm whites, rustic wood, black accents.",
    swatches: ["#f5f1ea", "#2a2a2a", "#b18b55"],
    demoFilter: "contrast(1.07) saturate(1.0) brightness(1.02) sepia(0.06)",
  },
  {
    id: "coastal",
    name: "Coastal",
    tag: "fresh",
    desc: "Light blues, sandy neutrals, breezy feel.",
    swatches: ["#f3efe6", "#7bbcd6", "#d7b98a"],
    demoFilter: "contrast(1.02) saturate(1.02) brightness(1.06) hue-rotate(-6deg)",
  },
  {
    id: "mid-century",
    name: "Mid-Century",
    tag: "retro",
    desc: "Bold accents, warm woods, iconic silhouettes.",
    swatches: ["#f2ece2", "#c17a2f", "#2d4f6c"],
    demoFilter: "contrast(1.12) saturate(1.16) brightness(1.01)",
  },
  {
    id: "art-deco",
    name: "Art Deco",
    tag: "glam",
    desc: "Geometric patterns, brass accents, jewel tones.",
    swatches: ["#0f1a24", "#c8a86b", "#f4efe6"],
    demoFilter: "contrast(1.16) saturate(1.06) brightness(0.98)",
  },
  {
    id: "rustic",
    name: "Rustic",
    tag: "cozy",
    desc: "Earth tones, warmth, cabin comfort.",
    swatches: ["#f1e7da", "#8b5a3c", "#3a332f"],
    demoFilter: "contrast(1.06) saturate(1.02) brightness(1.0) sepia(0.12)",
  },
  {
    id: "traditional",
    name: "Traditional",
    tag: "classic",
    desc: "Timeless furniture, balanced, warm and layered.",
    swatches: ["#f2efe8", "#b79a6a", "#2f2a28"],
    demoFilter: "contrast(1.06) saturate(0.98) brightness(1.01) sepia(0.06)",
  },
  {
    id: "transitional",
    name: "Transitional",
    tag: "blend",
    desc: "Modern meets classic, clean but welcoming.",
    swatches: ["#f5f2eb", "#c9c2b6", "#2a2a2a"],
    demoFilter: "contrast(1.07) saturate(0.96) brightness(1.03)",
  },
  {
    id: "french-country",
    name: "French Country",
    tag: "vintage",
    desc: "Soft creams, weathered wood, elegant rustic charm.",
    swatches: ["#f4efe6", "#b49b85", "#5b4a40"],
    demoFilter: "contrast(1.05) saturate(0.98) brightness(1.02) sepia(0.10)",
  },
  {
    id: "mediterranean",
    name: "Mediterranean",
    tag: "sunlit",
    desc: "Warm plaster, terracotta, arches, patterned tile.",
    swatches: ["#f4ead9", "#c56a3a", "#2f5e6e"],
    demoFilter: "contrast(1.09) saturate(1.06) brightness(1.01) sepia(0.06)",
  },
  {
    id: "hollywood-regency",
    name: "Hollywood Regency",
    tag: "bold",
    desc: "Mirrors, velvet, brass, dramatic lighting.",
    swatches: ["#121217", "#f2c86a", "#f4efe6"],
    demoFilter: "contrast(1.18) saturate(1.05) brightness(0.99)",
  },
  {
    id: "maximalist",
    name: "Maximalist",
    tag: "layered",
    desc: "Curated chaos: color, pattern, and personality.",
    swatches: ["#f2c86a", "#ff5a3d", "#1fb8a7"],
    demoFilter: "contrast(1.10) saturate(1.20) brightness(1.01)",
  },
  {
    id: "tropical-resort",
    name: "Tropical Resort",
    tag: "breezy",
    desc: "Rattan, greenery, light fabrics, vacation energy.",
    swatches: ["#f4efe6", "#2f6a52", "#c8a77a"],
    demoFilter: "contrast(1.04) saturate(1.10) brightness(1.04)",
  },
  {
    id: "southwestern",
    name: "Southwestern",
    tag: "desert",
    desc: "Warm clay tones, woven textures, geometric accents.",
    swatches: ["#f1e1cf", "#c56a3a", "#2a2a2a"],
    demoFilter: "contrast(1.08) saturate(1.06) brightness(1.01) sepia(0.06)",
  },
  {
    id: "dark-academia",
    name: "Dark Academia",
    tag: "library",
    desc: "Moody dark wood, vintage decor, warm lamps.",
    swatches: ["#101014", "#4a3a2f", "#c8a86b"],
    demoFilter: "contrast(1.16) saturate(0.92) brightness(0.94) sepia(0.08)",
  },
  {
    id: "cottagecore",
    name: "Cottagecore",
    tag: "charm",
    desc: "Cozy cottage, florals, painted wood, soft light.",
    swatches: ["#f7f2ea", "#c79aa5", "#7e9c7a"],
    demoFilter: "contrast(1.03) saturate(1.04) brightness(1.06) sepia(0.06)",
  },
  {
    id: "zen-spa",
    name: "Zen Spa",
    tag: "calm",
    desc: "Serene minimal, stone + wood, soft indirect lighting.",
    swatches: ["#f2efe8", "#bda68b", "#2a2a2a"],
    demoFilter: "contrast(1.03) saturate(0.95) brightness(1.05)",
  },
  {
    id: "monochrome-modern",
    name: "Monochrome Modern",
    tag: "contrast",
    desc: "Black, white, and gray with clean geometry.",
    swatches: ["#ffffff", "#1a1a1a", "#9aa0a6"],
    demoFilter: "contrast(1.18) saturate(0.82) brightness(1.02)",
  },
  {
    id: "color-pop-eclectic",
    name: "Color Pop Eclectic",
    tag: "playful",
    desc: "Fun accents, bold art, eclectic but cohesive.",
    swatches: ["#ff5a3d", "#1fb8a7", "#f2c86a"],
    demoFilter: "contrast(1.08) saturate(1.18) brightness(1.02)",
  },
];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const els = {
  stepBtns: $$(".step"),
  panels: $$(".panel"),

  photo: $("#photo"),
  pickFileBtn: $("#pickFileBtn"),
  stripMeta: $("#stripMeta"),

  previewImg: $("#previewImg"),
  previewMeta: $("#previewMeta"),
  dropZone: $("#dropZone"),
  stageEmpty: $("#stageEmpty"),
  stageNote: $("#stageNote"),
  stageProgress: $("#stageProgress"),
  stageProgressMsg: $("#stageProgressMsg"),
  stageDownloadBtn: $("#stageDownloadBtn"),

  compare: $("#compare"),
  afterWrap: $("#afterWrap"),
  compareLine: $("#compareLine"),
  compareRange: $("#compareRange"),
  compareLabels: $("#compareLabels"),

  toStyle: $("#toStyle"),
  space: $("#space"),
  budget: $("#budget"),
  styleGrid: $("#styleGrid"),
  toPay: $("#toPay"),
  notes: $("#notes"),

  paymentStatus: $("#paymentStatus"),
  payActions: $("#payActions"),
  generateBtn: $("#generateBtn"),

  resultImg: $("#resultImg"),
  downloadBtn: $("#downloadBtn"),
  startOver: $("#startOver"),

  toast: $("#toast"),
};

const state = {
  config: null,
  sourceFile: null,
  uploadFile: null,
  uploadInfo: null,
  styleId: null,
  orderId: null,
  receiptToken: null,
  resultUrl: null,
  previewUrl: null,
  paypalSdkLoaded: false,
};

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function genProgressMsg(st) {
  const s = st ? `Generating (${st})... ` : "Generating... ";
  return (
    s +
    "This can take around 2-3 minutes. Please keep this tab open. " +
    "SAVE YOUR IMAGE when it appears (we do not store uploads or generated images for privacy)."
  );
}

function showStageProgress(st) {
  if (!els.stageProgress) return;
  if (els.stageProgressMsg) els.stageProgressMsg.textContent = genProgressMsg(st);
  els.stageProgress.hidden = false;
}

function hideStageProgress() {
  if (!els.stageProgress) return;
  els.stageProgress.hidden = true;
}

function setStep(stepNum) {
  for (const b of els.stepBtns) {
    const n = Number(b.dataset.step);
    b.classList.toggle("step--active", n === stepNum);
  }
  for (const p of els.panels) {
    const n = Number(p.dataset.panel);
    p.classList.toggle("panel--active", n === stepNum);
  }
}

function unlockStep(stepNum) {
  const btn = els.stepBtns.find((b) => Number(b.dataset.step) === stepNum);
  if (btn) btn.disabled = false;
}

function revokeUrl(kind) {
  if (kind === "preview" && state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  if (kind === "result" && state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = null;
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let u = 0;
  let v = n;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function styleById(id) {
  return STYLE_PRESETS.find((s) => s.id === id) || null;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderStyles() {
  els.styleGrid.innerHTML = "";
  for (const s of STYLE_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "style";
    btn.dataset.styleId = s.id;
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", "false");

    const sw = (s.swatches || [])
      .map((c) => `<span class="style__swatch" style="--c:${escapeHtml(c)}"></span>`)
      .join("");

    btn.innerHTML = `
      <div class="style__top">
        <div class="style__name">${escapeHtml(s.name)}</div>
        <div class="style__tag">${escapeHtml(s.tag)}</div>
      </div>
      <div class="style__desc">${escapeHtml(s.desc)}</div>
      <div class="style__swatches" aria-hidden="true">${sw}</div>
    `;

    btn.addEventListener("click", () => {
      state.styleId = s.id;
      for (const node of $$(".style")) {
        const active = node.dataset.styleId === s.id;
        node.classList.toggle("style--active", active);
        node.setAttribute("aria-selected", active ? "true" : "false");
      }
      els.toPay.disabled = false;
      els.stageNote.textContent =
        "Next: continue to payment. After you generate, SAVE YOUR IMAGE.";
    });
    els.styleGrid.appendChild(btn);
  }
}

function setCompareActive(active) {
  els.compare.hidden = !active;
  els.stageEmpty.hidden = active;
}

function setResultActive(active) {
  els.afterWrap.hidden = !active;
  els.compareRange.hidden = !active;
  els.compareLabels.hidden = !active;
  els.compareLine.hidden = !active;
  els.stageDownloadBtn.hidden = !active;
}

function setCompareRevealPercent(pct) {
  const p = clamp(Number(pct) || 0, 0, 100);
  els.compare.style.setProperty("--reveal", `${p}%`);
}

async function downscaleAndStrip(file, maxSidePx) {
  const bitmap = await createImageBitmap(file);
  const maxSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, maxSidePx / maxSide);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Image processing failed.");
  return { blob, width: w, height: h };
}

async function handleFileSelected(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) {
    toast("Please upload an image file.");
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    toast(`Image is too large (max ${formatBytes(MAX_UPLOAD_BYTES)}).`);
    return;
  }

  // New upload invalidates any existing generated image.
  revokeUrl("result");
  els.resultImg.removeAttribute("src");
  els.downloadBtn.href = "#";
  els.stageDownloadBtn.href = "#";
  setResultActive(false);
  setCompareRevealPercent(56);
  els.compareRange.value = "56";

  state.sourceFile = file;
  state.orderId = null;
  state.receiptToken = null;
  els.generateBtn.disabled = true;

  let uploadBlob = file;
  let info = { width: null, height: null, processed: false };
  if (els.stripMeta.checked) {
    toast("Optimizing upload...");
    const out = await downscaleAndStrip(file, MAX_SIDE_PX);
    uploadBlob = out.blob;
    info = { width: out.width, height: out.height, processed: true };
  } else {
    try {
      const bmp = await createImageBitmap(file);
      info = { width: bmp.width, height: bmp.height, processed: false };
    } catch {
      // Dimensions are optional; keep going.
    }
  }

  state.uploadFile = new File([uploadBlob], "dreamy-decor-upload.jpg", {
    type: uploadBlob.type || "image/jpeg",
  });
  state.uploadInfo = info;

  revokeUrl("preview");
  state.previewUrl = URL.createObjectURL(state.uploadFile);
  els.previewImg.src = state.previewUrl;

  const bits = [
    `upload=${formatBytes(state.uploadFile.size)}`,
    info.width && info.height ? `${info.width}x${info.height}px` : null,
    info.processed ? "optimized" : "original",
  ].filter(Boolean);
  els.previewMeta.textContent = bits.join(" | ");

  if (info.width && info.height) {
    els.compare.style.setProperty("--ar", String(info.width / info.height));
  }

  setCompareActive(true);
  setStep(1);
  els.stageNote.textContent = "Next: choose a style. Then pay $1 and generate.";

  els.toStyle.disabled = false;
  unlockStep(2);
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    state.config = await res.json();
  } catch {
    state.config = {
      appName: "DREAMY DECOR",
      priceUsd: 1,
      payment: {
        enabled: false,
        backendOnline: false,
        jwtConfigured: false,
        paypalConfigured: false,
        mode: "auto",
        modeEffective: "demo",
        paypalClientId: null,
      },
      nanoBanana: { enabled: false },
    };
  }
}

function setPaymentUiIdle() {
  els.paymentStatus.textContent = "Ready";
  els.payActions.innerHTML = "";
}

async function demoPayFlow() {
  els.paymentStatus.textContent = "Creating order...";
  els.payActions.innerHTML = "";
  const orderRes = await fetch("/api/payment/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountUsd: 1 }),
  });
  if (!orderRes.ok) throw new Error("Failed to create order.");
  const order = await orderRes.json();
  state.orderId = order.orderId;

  els.paymentStatus.textContent = "Confirming payment...";
  const capRes = await fetch("/api/payment/capture-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: state.orderId }),
  });
  if (!capRes.ok) throw new Error("Payment capture failed.");
  const cap = await capRes.json();
  if (!cap.receiptToken) throw new Error("Missing receipt token.");

  state.receiptToken = cap.receiptToken;
  els.paymentStatus.textContent = "Paid (demo)";
  els.generateBtn.disabled = false;
  els.stageNote.textContent = "Payment confirmed. Click Generate (can take 2-3 minutes). Then SAVE YOUR IMAGE.";
  toast("Payment confirmed.");
}

function paymentModeRequested() {
  const p = state.config && state.config.payment ? state.config.payment : null;
  return String(p?.modeRequested || p?.mode || "auto").toLowerCase();
}

function paymentModeEffective() {
  const p = state.config && state.config.payment ? state.config.payment : null;
  return String(p?.modeEffective || p?.mode || "demo").toLowerCase();
}

function paypalEnabled() {
  return Boolean(
    state.config &&
      state.config.payment &&
      state.config.payment.enabled &&
      paymentModeEffective() === "paypal" &&
      state.config.payment.paypalClientId,
  );
}

async function loadPayPalSdk(clientId) {
  if (state.paypalSdkLoaded) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&components=buttons&currency=USD&intent=capture&commit=true&vault=false`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load PayPal SDK."));
    document.head.appendChild(s);
  });
  state.paypalSdkLoaded = true;
}

async function renderPayPalButtons() {
  const { paypalClientId } = state.config.payment;
  await loadPayPalSdk(paypalClientId);
  if (!window.paypal || !window.paypal.Buttons) {
    throw new Error("PayPal SDK loaded, but Buttons is unavailable.");
  }

  els.payActions.innerHTML = "";
  const mount = document.createElement("div");
  mount.id = "paypalButtons";
  els.payActions.appendChild(mount);

  window.paypal
    .Buttons({
      style: { height: 50 },
      createOrder: async () => {
        els.paymentStatus.textContent = "Creating order...";
        const orderRes = await fetch("/api/payment/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountUsd: 1 }),
        });
        const order = await orderRes.json().catch(() => ({}));
        if (!orderRes.ok || !order?.orderId) {
          throw new Error(order?.error || "Failed to create PayPal order.");
        }
        state.orderId = String(order.orderId);
        return state.orderId;
      },
      onApprove: async (data) => {
        els.paymentStatus.textContent = "Capturing...";
        const capRes = await fetch("/api/payment/capture-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderID }),
        });
        const cap = await capRes.json().catch(() => ({}));
        if (!capRes.ok || !cap?.receiptToken) {
          throw new Error(cap?.error || "Failed to capture PayPal payment.");
        }
        state.receiptToken = cap.receiptToken;
        els.paymentStatus.textContent = "Paid";
        els.generateBtn.disabled = false;
        els.stageNote.textContent = "Payment confirmed. Click Generate (can take 2-3 minutes). Then SAVE YOUR IMAGE.";
        toast("Payment confirmed.");
      },
      onError: (err) => {
        console.error(err);
        const msg = err && typeof err === "object" && "message" in err ? String(err.message) : "PayPal error.";
        toast(msg);
        els.paymentStatus.textContent = "Error";
      },
    })
    .render("#paypalButtons");
}

async function refreshPaymentUi() {
  setPaymentUiIdle();
  state.orderId = null;
  state.receiptToken = null;
  els.generateBtn.disabled = true;

  if (!state.config || !state.config.payment) {
    els.paymentStatus.textContent = "Unavailable";
    return;
  }

  if (state.config.payment.backendOnline === false) {
    els.paymentStatus.textContent = "Backend offline";
    const hint =
      "Local APIs are not running. Start: cmd /c npx wrangler pages dev . --port 8788 (then open http://localhost:8788/).";
    els.payActions.innerHTML = `<div class="hint">${escapeHtml(hint)}</div>`;
    return;
  }

  if (!state.config.payment.enabled) {
    els.paymentStatus.textContent = "Not configured";
    const needs = [];
    if (!state.config.payment.jwtConfigured) needs.push("PAYMENT_JWT_SECRET (secret)");
    const requested = paymentModeRequested();
    const wantsPayPal = requested === "paypal" || (requested === "auto" && state.config.payment.paypalClientId);
    if (wantsPayPal) {
      if (!state.config.payment.paypalClientId) needs.push("PAYPAL_CLIENT_ID");
      if (!state.config.payment.paypalConfigured) needs.push("PAYPAL_CLIENT_SECRET (secret)");
    }
    const hint = needs.length
      ? `Payment is required. Set ${needs.join(", ")} in Cloudflare Pages environment variables.`
      : "Payment is required. Check Cloudflare Pages environment variables.";
    els.payActions.innerHTML = `<div class="hint">${escapeHtml(hint)}</div>`;
    return;
  }

  if (paypalEnabled()) {
    els.paymentStatus.textContent = "Pay with PayPal";
    try {
      await renderPayPalButtons();
    } catch (e) {
      console.error(e);
      els.paymentStatus.textContent = "PayPal unavailable";
      els.payActions.innerHTML =
        '<button class="btn btn--primary" type="button" id="demoPayFallback">Simulate $1 payment (demo)</button>';
      $("#demoPayFallback").addEventListener("click", async () => {
        try {
          await demoPayFlow();
        } catch (err) {
          console.error(err);
          toast("Payment failed.");
          els.paymentStatus.textContent = "Error";
        }
      });
    }
    return;
  }

  // Demo mode (no real charge). Still requires a valid "paid" receipt token server-side.
  els.paymentStatus.textContent = "Demo mode";
  els.payActions.innerHTML =
    '<button class="btn btn--primary" type="button" id="demoPayBtn">Simulate $1 payment</button>';
  $("#demoPayBtn").addEventListener("click", async () => {
    try {
      await demoPayFlow();
    } catch (err) {
      console.error(err);
      toast("Payment failed.");
      els.paymentStatus.textContent = "Error";
    }
  });
}

async function makeDemoOutputPngBlob(file, styleId) {
  const preset = styleById(styleId);
  const bitmap = await createImageBitmap(file);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");

  ctx.filter = preset?.demoFilter || "contrast(1.05) saturate(1.05) brightness(1.03)";
  ctx.drawImage(bitmap, 0, 0);
  ctx.filter = "none";

  const wash = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  wash.addColorStop(0, "rgba(255, 90, 61, 0.10)");
  wash.addColorStop(1, "rgba(31, 184, 167, 0.10)");
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";

  const vg = ctx.createRadialGradient(
    canvas.width * 0.52,
    canvas.height * 0.48,
    Math.min(canvas.width, canvas.height) * 0.2,
    canvas.width * 0.52,
    canvas.height * 0.48,
    Math.max(canvas.width, canvas.height) * 0.72,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.18)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const n = document.createElement("canvas");
  n.width = 128;
  n.height = 128;
  const nctx = n.getContext("2d");
  if (nctx) {
    const imgd = nctx.createImageData(n.width, n.height);
    for (let i = 0; i < imgd.data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      imgd.data[i] = v;
      imgd.data[i + 1] = v;
      imgd.data[i + 2] = v;
      imgd.data[i + 3] = Math.floor(Math.random() * 26);
    }
    nctx.putImageData(imgd, 0, 0);
    ctx.globalAlpha = 0.2;
    ctx.globalCompositeOperation = "overlay";
    const pattern = ctx.createPattern(n, "repeat");
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.03);
  ctx.font = `800 ${Math.max(12, Math.round(canvas.width / 42))}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillText("DREAMY DECOR (demo)", canvas.width - pad, canvas.height - pad);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.fillText("DREAMY DECOR (demo)", canvas.width - pad - 1, canvas.height - pad - 1);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to create image.");
  return blob;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prettyTaskState(state) {
  const s = String(state || "").toLowerCase();
  if (s === "waiting") return "waiting";
  if (s === "queuing") return "queued";
  if (s === "generating") return "generating";
  if (s === "success") return "ready";
  if (s === "fail" || s === "failed") return "failed";
  return s || "working";
}

async function pollForImage({ taskId, token, timeoutMs = 6 * 60 * 1000 }) {
  const started = Date.now();
  let delayMs = 1200;

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`/api/generate?taskId=${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("image/")) {
      if (!res.ok) throw new Error("Failed to download generated image.");
      return await res.blob();
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Generation failed.");

    const st = prettyTaskState(data?.state);
    els.stageNote.textContent = `Generating (${st})...`;
    showStageProgress(st);

    await sleep(delayMs);
    delayMs = Math.min(6000, Math.round(delayMs * 1.25));
  }

  throw new Error("Generation is taking longer than expected. Please try again.");
}

function showResultFromBlob(blob) {
  hideStageProgress();
  revokeUrl("result");
  state.resultUrl = URL.createObjectURL(blob);

  els.resultImg.src = state.resultUrl;
  els.downloadBtn.href = state.resultUrl;
  els.stageDownloadBtn.href = state.resultUrl;
  els.stageDownloadBtn.hidden = false;

  setResultActive(true);
  setCompareRevealPercent(Number(els.compareRange.value || 56));

  els.stageNote.textContent = "Drag the slider to compare. SAVE YOUR IMAGE now.";
  setStep(4);
  unlockStep(4);
}

async function generate() {
  if (!state.uploadFile) {
    toast("Upload an image first.");
    return;
  }
  if (!state.styleId) {
    toast("Choose a style first.");
    return;
  }
  if (!state.receiptToken) {
    toast("Payment required.");
    return;
  }

  let generated = false;
  els.generateBtn.disabled = true;
  els.generateBtn.textContent = "Starting...";
  showStageProgress();

  try {
    const fd = new FormData();
    fd.append("photo", state.uploadFile, state.uploadFile.name);
    fd.append("style", state.styleId);
    fd.append("space", els.space.value);
    fd.append("budget", els.budget.value);
    fd.append("notes", (els.notes.value || "").trim());
    if (state.uploadInfo?.width && state.uploadInfo?.height) {
      fd.append("w", String(state.uploadInfo.width));
      fd.append("h", String(state.uploadInfo.height));
    }

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${state.receiptToken}` },
      body: fd,
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (!res.ok) {
      let msg = "Generation failed.";
      try {
        const data = await res.json();
        msg = data?.error || msg;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }

    if (ct.startsWith("image/")) {
      const blob = await res.blob();
      showResultFromBlob(blob);
      toast("Generated. SAVE YOUR IMAGE.");
      generated = true;
      return;
    }

    const data = await res.json();
    if (data && data.demo) {
      const blob = await makeDemoOutputPngBlob(state.uploadFile, state.styleId);
      showResultFromBlob(blob);
      toast("Demo output generated. SAVE YOUR IMAGE.");
      generated = true;
      return;
    }

    if (data && data.taskId) {
      els.generateBtn.textContent = "Generating...";
      els.stageNote.textContent = "Generating... (this can take around 2-3 minutes)";
      showStageProgress();
      const outBlob = await pollForImage({ taskId: data.taskId, token: state.receiptToken });
      showResultFromBlob(outBlob);
      toast("Generated. SAVE YOUR IMAGE.");
      generated = true;
      return;
    }

    throw new Error(data?.error || "Unexpected response from server.");
  } finally {
    hideStageProgress();
    els.generateBtn.textContent = "Generate";
    if (generated) {
      // One payment -> one generation.
      state.orderId = null;
      state.receiptToken = null;
      setPaymentUiIdle();
      await refreshPaymentUi().catch(() => {});
    } else {
      els.generateBtn.disabled = false;
    }
  }
}

function resetAll() {
  hideStageProgress();
  state.sourceFile = null;
  state.uploadFile = null;
  state.uploadInfo = null;
  state.styleId = null;
  state.orderId = null;
  state.receiptToken = null;

  els.photo.value = "";
  els.notes.value = "";

  els.toStyle.disabled = true;
  els.toPay.disabled = true;
  els.generateBtn.disabled = true;

  revokeUrl("preview");
  revokeUrl("result");

  els.previewImg.removeAttribute("src");
  els.resultImg.removeAttribute("src");
  els.downloadBtn.href = "#";
  els.stageDownloadBtn.href = "#";
  els.stageDownloadBtn.hidden = true;

  setCompareActive(false);
  setResultActive(false);
  els.compare.style.setProperty("--ar", "1.333333");

  els.previewMeta.textContent = "Upload a photo to begin.";
  els.stageNote.textContent =
    "Upload, pick a style, pay $1, then generate. SAVE YOUR IMAGE after it appears.";

  for (const node of $$(".style")) {
    node.classList.remove("style--active");
    node.setAttribute("aria-selected", "false");
  }

  for (const b of els.stepBtns) b.disabled = true;
  unlockStep(1);
  setStep(1);
}

function wireDropZone() {
  if (!els.dropZone) return;

  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  els.dropZone.addEventListener("dragenter", stop);
  els.dropZone.addEventListener("dragover", (e) => {
    stop(e);
    els.dropZone.classList.add("isDrag");
  });
  els.dropZone.addEventListener("dragleave", (e) => {
    stop(e);
    // Best-effort; not perfect but avoids flicker.
    if (e.target === els.dropZone) els.dropZone.classList.remove("isDrag");
  });
  els.dropZone.addEventListener("drop", async (e) => {
    stop(e);
    els.dropZone.classList.remove("isDrag");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    try {
      await handleFileSelected(file);
    } catch (err) {
      console.error(err);
      toast(err?.message || "Upload failed.");
    }
  });
}

function wireUi() {
  els.photo.addEventListener("change", async () => {
    try {
      const file = els.photo.files && els.photo.files[0];
      await handleFileSelected(file);
    } catch (e) {
      console.error(e);
      toast(e?.message || "Upload failed.");
    }
  });

  els.pickFileBtn.addEventListener("click", () => {
    els.photo.click();
  });

  els.stripMeta.addEventListener("change", async () => {
    if (!state.sourceFile) return;
    try {
      await handleFileSelected(state.sourceFile);
    } catch (e) {
      console.error(e);
      toast(e?.message || "Failed to reprocess image.");
    }
  });

  els.compareRange.addEventListener("input", () => {
    setCompareRevealPercent(Number(els.compareRange.value));
  });

  els.toStyle.addEventListener("click", () => {
    if (!state.uploadFile) return;
    unlockStep(2);
    unlockStep(3);
    setStep(2);
  });

  els.toPay.addEventListener("click", async () => {
    if (!state.styleId) {
      toast("Choose a style.");
      return;
    }
    unlockStep(3);
    setStep(3);
    els.stageNote.textContent = "Pay $1 to unlock one generation.";
    await refreshPaymentUi();
  });

  for (const backBtn of $$("[data-back]")) {
    backBtn.addEventListener("click", () => {
      const n = Number(backBtn.dataset.back);
      setStep(n);
    });
  }

  els.generateBtn.addEventListener("click", async () => {
    try {
      await generate();
    } catch (e) {
      console.error(e);
      toast(e?.message || "Generation failed.");
      els.generateBtn.disabled = false;
      els.generateBtn.textContent = "Generate";
    }
  });

  els.startOver.addEventListener("click", () => {
    resetAll();
    toast("Ready.");
  });

  wireDropZone();
}

async function init() {
  renderStyles();
  wireUi();
  unlockStep(1);
  await loadConfig();
  setPaymentUiIdle();
  resetAll();
}

init().catch((e) => {
  console.error(e);
  toast("Failed to start.");
});
