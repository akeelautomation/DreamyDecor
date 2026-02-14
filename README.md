# DREAMY DECOR

Upload an empty room photo, pick a style, pay **$1 per image**, and get a redesigned image.

Privacy notes:
- This site does not store your photos or results on our servers.
- To generate an image, your photo is sent to the AI provider (Kie.ai Nano Banana Pro) for processing; the provider may retain uploads temporarily.
- The UI repeatedly reminds users: **SAVE YOUR IMAGE** after it appears.

## Cloudflare Pages Deploy

This repo is built for **Cloudflare Pages**:
- Static frontend: `index.html` + `static/*`
- Backend: Cloudflare Pages Functions in `functions/*` (`/api/*`)

Cloudflare Pages settings (typical):
- Build command: *(none)*
- Output directory: `/` (repo root)

## Environment Variables (Cloudflare Pages)

Set these in Cloudflare Pages: `Settings -> Environment variables`.

See `.env.example` for the full list.

### Payment

Required for secure receipt tokens:
- `PAYMENT_JWT_SECRET` (set a long random string, 32+ chars, store as a **Secret**)

Modes:
- `PAYMENT_MODE=auto` (default if unset): uses PayPal if it is configured, otherwise falls back to demo mode
- `PAYMENT_MODE=demo` (always demo)
- `PAYMENT_MODE=paypal` (force PayPal)

PayPal (when mode is effectively `paypal`):
- `PAYPAL_ENV=sandbox` or `PAYPAL_ENV=live`
- `PAYPAL_CLIENT_ID=...`
- `PAYPAL_CLIENT_SECRET=...` (store as a **Secret**)

Optional (recommended) to prevent "1 payment -> multiple generations" replays:
- Bind a KV namespace to the Functions binding name `PAYMENT_KV`
  - Receipts are tracked as `in_progress` then `used` (no images stored).

### Nano Banana Pro (image generation)

API docs: `https://kie.ai/nano-banana-pro`

Required:
- `KIE_API_KEY=...` (store as a **Secret**)

Optional (defaults shown):
- `KIE_API_BASE_URL=https://api.kie.ai`
- `KIE_UPLOAD_BASE_URL=https://kieai.redpandaai.co`
- `NANO_BANANA_RESOLUTION=2K` (allowed: `1K` or `2K`; `4K` is intentionally blocked to control cost)

Behavior:
- Aspect ratio is matched to the uploaded photo (picked from common ratios; falls back to `auto` if unknown).
- Output format is `png`.

If `KIE_API_KEY` is not set, `/api/generate` returns a **demo** response and the browser renders a local "demo output" so the full flow can be tested.

## Local Dev

Recommended (matches Cloudflare Pages runtime and runs `/api/*` functions too):
```bash
npx wrangler pages dev . --port 8788
```

Then open `http://localhost:8788/`.

Windows note: if PowerShell blocks `npx.ps1`, run it via `cmd`:
```bash
cmd /c npx wrangler pages dev . --port 8788
```

Local env vars: create a `.dev.vars` file in the repo root (ignored by git) for secrets like `PAYMENT_JWT_SECRET`, `KIE_API_KEY`, and PayPal credentials.
