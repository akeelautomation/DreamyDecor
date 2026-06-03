# Monetag Clean Ads Setup

This site is wired for the Monetag In-Page Push banner tag:

```html
<script>(function(s){s.dataset.zone='11096150',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
```

The same tag is inserted directly in the `<head>` on `blog.html` and every `blog-*.html` article page. Policy pages, search, picks pages, and the home page do not load Monetag.

The visible position of Monetag In-Page Push creatives is controlled by Monetag. Ask Monetag support to move zone `11096150` to the left side on desktop and a centered in-article/mobile placement if that position is required.

The CSP allowlist includes the exact `nap5k.com` tag host plus the secondary support hosts used by Monetag's In-Page Push script. Its request endpoint hosts `jhnwr.com` and `my.rtmark.net` are allowed for `connect-src` only. Obvious Onclick/Popcash-style hosts are intentionally not allowlisted unless Monetag confirms they are required for this clean banner zone.

## Dashboard Settings

- Create a fresh Monetag zone for a clean in-page/banner-style format only.
- Do not use MultiTag, Push Notifications, Onclick/Popunder, Direct Link/SmartLink, or aggressive interstitials.
- Use Monetag's meta-tag verification option instead of installing `sw.js`.
- Ask Monetag support to block or exclude adult, gambling, malware/scareware, fake tech support, misleading, tobacco/drugs, and offensive ad categories.

If Monetag gives you an `ads.txt` seller line, append it to `ads.txt`.
