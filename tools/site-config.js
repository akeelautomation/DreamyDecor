const SITE_URL = String(process.env.SITE_URL || "https://dreamy-decor.net").replace(/\/+$/, "");
const PUBLIC_URL_STYLE = String(process.env.PUBLIC_URL_STYLE || "extensionless").toLowerCase();

const stripHtmlExtension = (fileName) => String(fileName || "").replace(/\.html$/i, "");

const toPublicPath = (fileName) => {
  const value = String(fileName || "").trim();
  if (!value || value === "index.html") {
    return "/";
  }

  const normalized = value.replace(/^\/+/, "");
  if (PUBLIC_URL_STYLE === "extensionless" && /\.html$/i.test(normalized)) {
    return `/${stripHtmlExtension(normalized)}`;
  }

  return `/${normalized}`;
};

const toPublicUrl = (fileName) => `${SITE_URL}${toPublicPath(fileName) === "/" ? "" : toPublicPath(fileName)}`;

module.exports = {
  PUBLIC_URL_STYLE,
  SITE_URL,
  toPublicPath,
  toPublicUrl,
};
