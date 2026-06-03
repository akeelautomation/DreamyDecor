# Monetag Clean Ads Setup

This site is wired for the Monetag Vignette banner tag:

```html
<script>(function(s){s.dataset.zone='11095985',s.src='https://n6wxm.com/vignette.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
```

The site loads the same tag through `static/site-runtime.js` and `/api/site-options` instead of pasting inline third-party script into every page.

## Dashboard Settings

- Create a fresh Monetag zone for a clean in-page/banner-style format only.
- Do not use MultiTag, Push Notifications, Onclick/Popunder, Direct Link/SmartLink, or aggressive interstitials.
- Use Monetag's meta-tag verification option instead of installing `sw.js`.
- Ask Monetag support to block or exclude adult, gambling, malware/scareware, fake tech support, misleading, tobacco/drugs, and offensive ad categories.

## Cloudflare Environment Variables

Set these only after Monetag gives you the exact clean-format script URL:

```env
MONETAG_CLEAN_ADS=enabled
MONETAG_CLEAN_SCRIPT_SRC=https://n6wxm.com/vignette.min.js
MONETAG_CLEAN_ZONE_ID=11095985
MONETAG_CLEAN_AD_ORIGINS=https://n6wxm.com
```

`MONETAG_CLEAN_SCRIPT_SRC` must be HTTPS and must not point to a service worker. `MONETAG_CLEAN_AD_ORIGINS` should list only exact origins required by the final clean tag, separated by commas.

If Monetag gives you an `ads.txt` seller line, append it to `ads.txt`.
