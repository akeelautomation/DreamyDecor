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

export const onRequestPost = async ({ request, env }) => {
  let amountUsd = 1;
  try {
    const body = await request.json();
    if (body && Number(body.amountUsd) === 1) amountUsd = 1;
  } catch {
    // ignore
  }

  const normalizePaymentMode = (raw) => {
    const v = String(raw || "auto").toLowerCase().trim();
    return v === "demo" || v === "paypal" || v === "auto" ? v : "auto";
  };

  const paymentModeRequested = normalizePaymentMode(env?.PAYMENT_MODE);
  const paypalClientId = String(env?.PAYPAL_CLIENT_ID || "");
  const paypalConfigured = Boolean(
    paypalClientId && env?.PAYPAL_CLIENT_SECRET && String(env.PAYPAL_CLIENT_SECRET).length > 0,
  );
  const paymentModeEffective =
    paymentModeRequested === "auto" ? (paypalConfigured ? "paypal" : "demo") : paymentModeRequested;

  if (paymentModeEffective !== "paypal") {
    return Response.json(
      { ok: true, mode: "demo", orderId: `demo-${crypto.randomUUID()}`, amountUsd },
      { status: 200 },
    );
  }

  try {
    const accessToken = await getPayPalAccessToken(env);
    const res = await fetch(`${paypalBase(env)}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: amountUsd.toFixed(2),
            },
          },
        ],
        application_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      return Response.json(
        { ok: false, error: data?.message || "Failed to create PayPal order." },
        { status: 400 },
      );
    }

    return Response.json({ ok: true, mode: "paypal", orderId: data.id, amountUsd }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || "Payment error." }, { status: 500 });
  }
};
