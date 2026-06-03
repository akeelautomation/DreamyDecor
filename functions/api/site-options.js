const clean = (value) => String(value || "").trim();
const DEFAULT_MONETAG_SCRIPT_SRC = "https://n6wxm.com/vignette.min.js";
const DEFAULT_MONETAG_ZONE_ID = "11095985";

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
  const scriptSrc = cleanScriptSrc(env?.MONETAG_CLEAN_SCRIPT_SRC || DEFAULT_MONETAG_SCRIPT_SRC);
  const enabled = isEnabled(env?.MONETAG_CLEAN_ADS || "enabled") && Boolean(scriptSrc);
  const zoneId = clean(env?.MONETAG_CLEAN_ZONE_ID || DEFAULT_MONETAG_ZONE_ID);

  return Response.json({
    sponsor: {
      enabled,
      scriptSrc: enabled ? scriptSrc : "",
      zoneId: enabled ? zoneId : "",
    },
  });
};
