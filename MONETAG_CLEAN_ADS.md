# Monetag Clean Ads Setup

This site is wired for the Monetag Vignette banner tag:

```html
<script>(function(s){s.dataset.zone='11095985',s.src='https://n6wxm.com/vignette.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>
```

The same tag is inserted directly on `blog.html` and every `blog-*.html` article page. Policy pages, search, picks pages, and the home page do not load Monetag.

## Dashboard Settings

- Create a fresh Monetag zone for a clean in-page/banner-style format only.
- Do not use MultiTag, Push Notifications, Onclick/Popunder, Direct Link/SmartLink, or aggressive interstitials.
- Use Monetag's meta-tag verification option instead of installing `sw.js`.
- Ask Monetag support to block or exclude adult, gambling, malware/scareware, fake tech support, misleading, tobacco/drugs, and offensive ad categories.

If Monetag gives you an `ads.txt` seller line, append it to `ads.txt`.
