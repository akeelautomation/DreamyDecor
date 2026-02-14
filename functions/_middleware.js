function baseCsp({ allowPayPal }) {
  const scriptSrc = ["'self'"];
  const connectSrc = ["'self'"];
  const frameSrc = [];
  const imgSrc = ["'self'", "data:", "blob:"];
  const styleSrc = ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"];
  const fontSrc = ["'self'", "data:", "https://fonts.gstatic.com"];

  if (allowPayPal) {
    scriptSrc.push("https://www.paypal.com");
    scriptSrc.push("https://www.paypalobjects.com");
    connectSrc.push(
      "https://www.paypal.com",
      "https://www.sandbox.paypal.com",
      "https://api-m.paypal.com",
      "https://api-m.sandbox.paypal.com",
      "https://www.paypalobjects.com",
    );
    frameSrc.push("https://www.paypal.com", "https://www.sandbox.paypal.com");
    imgSrc.push("https://www.paypalobjects.com", "https://www.paypal.com");
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
    `font-src ${fontSrc.join(" ")}`,
    frameSrc.length ? `frame-src ${frameSrc.join(" ")}` : null,
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
