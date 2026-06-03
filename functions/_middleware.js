const BLOG_IMAGE_HOSTS = ["https://pub-72cdac497dcc43c08cff5703af3d8977.r2.dev"];
const DEFAULT_MONETAG_SCRIPT_SRC = "https://n6wxm.com/vignette.min.js";

function exactOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.origin : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function cleanMonetagScriptOrigin(env) {
  const raw = String(env?.MONETAG_CLEAN_SCRIPT_SRC || DEFAULT_MONETAG_SCRIPT_SRC).trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const pathname = url.pathname.toLowerCase();
    if (url.protocol !== "https:") return "";
    if (pathname.endsWith("/sw.js") || pathname.includes("service-worker")) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function baseCsp({ allowPayPal, env }) {
  const googleAnalyticsHosts = [
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
  ];
  const scriptSrc = ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"];
  const connectSrc = ["'self'", ...googleAnalyticsHosts];
  const frameSrc = ["'self'"];
  const childSrc = ["'self'"];
  const imgSrc = [
    "'self'",
    "data:",
    "blob:",
    "https://m.media-amazon.com",
    "https://images-na.ssl-images-amazon.com",
    ...googleAnalyticsHosts,
    ...BLOG_IMAGE_HOSTS,
  ];
  const styleSrc = ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"];
  const fontSrc = ["'self'", "data:", "https://fonts.gstatic.com"];
  const monetagOrigins = [
    cleanMonetagScriptOrigin(env),
    ...exactOrigins(env?.MONETAG_CLEAN_AD_ORIGINS),
  ].filter(Boolean);

  if (monetagOrigins.length) {
    scriptSrc.push(...monetagOrigins);
    connectSrc.push(...monetagOrigins);
    frameSrc.push(...monetagOrigins);
    childSrc.push(...monetagOrigins);
    imgSrc.push(...monetagOrigins);
  }

  if (allowPayPal) {
    // PayPal JS SDK CSP guidance:
    // https://developer.paypal.com/sdk/js/csp/ (or /sdk/js/best-practices/)
    const paypalHosts = ["*.paypal.com", "*.paypalobjects.com", "*.venmo.com"];

    scriptSrc.push(...paypalHosts, "'unsafe-inline'");
    styleSrc.push(...paypalHosts);
    connectSrc.push(...paypalHosts);
    frameSrc.push(...paypalHosts);
    childSrc.push(...paypalHosts);
    imgSrc.push(...paypalHosts);
  }

  // Note: if you add other third-party scripts, update this CSP accordingly.
  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `img-src ${imgSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    `script-src ${scriptSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `child-src ${childSrc.join(" ")}`,
    `font-src ${fontSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const normalizePaymentMode = (raw) => {
    const v = String(raw || "auto").toLowerCase().trim();
    return v === "demo" || v === "paypal" || v === "auto" ? v : "auto";
  };

  const paymentMode = normalizePaymentMode(env?.PAYMENT_MODE);
  const paypalClientId = env?.PAYPAL_CLIENT_ID ? String(env.PAYPAL_CLIENT_ID) : "";
  const allowPayPal = paymentMode === "paypal" || (paymentMode === "auto" && paypalClientId);

  const res = await context.next();
  const headers = new Headers(res.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // PayPal checkout may use popups/redirects; "same-origin-allow-popups" avoids breaking those flows.
  headers.set("Cross-Origin-Opener-Policy", allowPayPal ? "same-origin-allow-popups" : "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");

  headers.set("Content-Security-Policy", baseCsp({ allowPayPal, env }));

  if (url.pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store");
  } else if (url.pathname.startsWith("/static/")) {
    headers.set("Cache-Control", "public, max-age=86400");
  } else if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
