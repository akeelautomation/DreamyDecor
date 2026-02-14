export const onRequestGet = async ({ env }) => {
  const normalizePaymentMode = (raw) => {
    const v = String(raw || "auto").toLowerCase().trim();
    return v === "demo" || v === "paypal" || v === "auto" ? v : "auto";
  };

  const paymentModeRequested = normalizePaymentMode(env?.PAYMENT_MODE);
  const paypalClientId = env?.PAYPAL_CLIENT_ID ? String(env.PAYPAL_CLIENT_ID) : null;
  const paypalConfigured = Boolean(
    paypalClientId && env?.PAYPAL_CLIENT_SECRET && String(env.PAYPAL_CLIENT_SECRET).length > 0,
  );
  const paymentModeEffective =
    paymentModeRequested === "auto" ? (paypalConfigured ? "paypal" : "demo") : paymentModeRequested;
  const jwtConfigured = Boolean(
    env?.PAYMENT_JWT_SECRET && String(env.PAYMENT_JWT_SECRET).length >= 32,
  );

  const paymentEnabled =
    jwtConfigured &&
    (paymentModeEffective === "demo"
      ? true
      : paymentModeEffective === "paypal"
        ? paypalConfigured
        : false);

  const kieApiKey = env?.KIE_API_KEY ? String(env.KIE_API_KEY) : env?.NANO_BANANA_API_KEY ? String(env.NANO_BANANA_API_KEY) : null;
  const nanoBananaEnabled = Boolean(kieApiKey);

  const requestedRes = String(env?.NANO_BANANA_RESOLUTION || env?.OUTPUT_RESOLUTION || "2K")
    .toUpperCase()
    .replaceAll(" ", "");
  const resolution = requestedRes === "1K" ? "1K" : "2K"; // never allow 4K (expensive)

  return Response.json({
    appName: "DREAMY DECOR",
    priceUsd: 1,
    payment: {
      enabled: paymentEnabled,
      jwtConfigured,
      paypalConfigured,
      mode: paymentModeRequested,
      modeEffective: paymentModeEffective,
      paypalClientId,
    },
    nanoBanana: {
      enabled: nanoBananaEnabled,
      provider: "kie",
      resolution,
      aspectRatio: "match_upload",
    },
    limits: {
      maxUploadBytes: 8_000_000,
      maxSidePx: 1920,
    },
  });
};
