function paypalBase(env) {
  const mode = String(env?.PAYPAL_ENV || "sandbox").toLowerCase();
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken(env) {
  const clientId = String(env.PAYPAL_CLIENT_ID || "");
  const clientSecret = String(env.PAYPAL_CLIENT_SECRET || "");
  if (!clientId || !clientSecret) throw new Error("PayPal is not configured.");

  const auth = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data?.error_description || "Failed to get PayPal access token.");
  }
  return data.access_token;
}

function b64urlFromBytes(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlFromString(str) {
  return b64urlFromBytes(new TextEncoder().encode(str));
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

async function signReceiptToken(env, payload) {
  const secret = getPaymentSecret(env);
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlFromString(JSON.stringify(header));
  const p = b64urlFromString(JSON.stringify(payload));
  const msg = `${h}.${p}`;
  const sig = await hmacSha256B64url(secret, msg);
  return `${msg}.${sig}`;
}

function extractAmountFromCapture(data) {
  try {
    const pu = data.purchase_units && data.purchase_units[0];
    const captures = pu?.payments?.captures;
    const cap = captures && captures[0];
    const value = cap?.amount?.value;
    const currency = cap?.amount?.currency_code;
    const status = cap?.status || data.status;
    return { value, currency, status };
  } catch {
    return { value: null, currency: null, status: null };
  }
}

export const onRequestPost = async ({ request, env }) => {
  let orderId = null;
  try {
    const body = await request.json();
    orderId = body?.orderId ? String(body.orderId) : null;
  } catch {
    // ignore
  }

  if (!orderId) {
    return Response.json({ ok: false, error: "Missing orderId." }, { status: 400 });
  }

  const paymentMode = String(env?.PAYMENT_MODE || "demo").toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const payloadBase = {
    iss: "dreamy-decor",
    aud: "dreamy-decor-generate",
    iat: now,
    exp: now + 10 * 60, // 10 minutes
    jti: crypto.randomUUID(),
    amount: "1.00",
    currency: "USD",
    orderId,
    mode: paymentMode,
  };

  if (paymentMode !== "paypal") {
    try {
      const token = await signReceiptToken(env, payloadBase);
      return Response.json({ ok: true, mode: "demo", receiptToken: token }, { status: 200 });
    } catch (e) {
      return Response.json({ ok: false, error: e?.message || "Payment error." }, { status: 500 });
    }
  }

  try {
    const accessToken = await getPayPalAccessToken(env);
    const res = await fetch(`${paypalBase(env)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json(
        { ok: false, error: data?.message || "Failed to capture PayPal order." },
        { status: 400 },
      );
    }

    const { value, currency, status } = extractAmountFromCapture(data);
    if (String(status).toUpperCase() !== "COMPLETED") {
      return Response.json({ ok: false, error: "Payment not completed." }, { status: 402 });
    }
    if (currency !== "USD" || value !== "1.00") {
      return Response.json({ ok: false, error: "Unexpected payment amount." }, { status: 402 });
    }

    const token = await signReceiptToken(env, payloadBase);
    return Response.json({ ok: true, mode: "paypal", receiptToken: token }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || "Payment error." }, { status: 500 });
  }
};
