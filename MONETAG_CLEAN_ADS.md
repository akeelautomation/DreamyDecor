# Monetag Clean Ads Setup

This site is wired for a low-disruption Monetag setup, but Monetag is disabled until a clean in-page/banner zone is configured.

## Dashboard Settings

- Create a fresh Monetag zone for a clean in-page/banner-style format only.
- Do not use MultiTag, Push Notifications, Onclick/Popunder, Direct Link/SmartLink, or aggressive interstitials.
- Use Monetag's meta-tag verification option instead of installing `sw.js`.
- Ask Monetag support to block or exclude adult, gambling, malware/scareware, fake tech support, misleading, tobacco/drugs, and offensive ad categories.

## Cloudflare Environment Variables

Set these only after Monetag gives you the exact clean-format script URL:

```env
MONETAG_CLEAN_ADS=enabled
MONETAG_CLEAN_SCRIPT_SRC=https://example.monetag-clean-zone-host/path/to/tag.js
MONETAG_CLEAN_ZONE_ID=
MONETAG_CLEAN_AD_ORIGINS=https://example.monetag-clean-zone-host
```

`MONETAG_CLEAN_SCRIPT_SRC` must be HTTPS and must not point to a service worker. `MONETAG_CLEAN_AD_ORIGINS` should list only exact origins required by the final clean tag, separated by commas.

If Monetag gives you an `ads.txt` seller line, append it to `ads.txt`.
