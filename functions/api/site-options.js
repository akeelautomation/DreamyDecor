const clean = (value) => String(value || "").trim();

const isEnabled = (value) => {
  const normalized = clean(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "enabled";
};

const cleanScriptSrc = (value) => {
  const raw = clean(value);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const pathname = url.pathname.toLowerCase();
    if (url.protocol !== "https:") return "";
    if (pathname.endsWith("/sw.js") || pathname.includes("service-worker")) return "";
    return url.href;
  } catch {
    return "";
  }
};

export const onRequestGet = async ({ env }) => {
  const scriptSrc = cleanScriptSrc(env?.MONETAG_CLEAN_SCRIPT_SRC);
  const enabled = isEnabled(env?.MONETAG_CLEAN_ADS) && Boolean(scriptSrc);

  return Response.json({
    sponsor: {
      enabled,
      scriptSrc: enabled ? scriptSrc : "",
      zoneId: enabled ? clean(env?.MONETAG_CLEAN_ZONE_ID) : "",
    },
  });
};
