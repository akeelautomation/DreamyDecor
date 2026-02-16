function baseCsp({ allowPayPal }) {
  const scriptSrc = ["'self'"];
  const connectSrc = ["'self'"];
  const frameSrc = ["'self'"];
  const childSrc = ["'self'"];
  const imgSrc = [
    "'self'",
    "data:",
    "blob:",
    "https://m.media-amazon.com",
    "https://images-na.ssl-images-amazon.com",
  ];
  const styleSrc = ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"];
  const fontSrc = ["'self'", "data:", "https://fonts.gstatic.com"];

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

  headers.set("Content-Security-Policy", baseCsp({ allowPayPal }));

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
