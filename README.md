# Zezoyah Backend API

Standalone Express + SQLite backend for the Zezoyah e-commerce site. **Zero Shopify dependency.**

## Architecture

This backend serves **only** JSON API routes and image streaming. It does **not** serve any HTML/CSS/JS site files — the frontend is a separate deployment. See the top-level `../README.md` for the full two-deployment architecture.

## Quick Start (Local Dev)

### 1. Install dependencies

```bash
cd server
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set:
#   - JWT_SECRET (a long random string)
#   - HCAPTCHA_SECRET (from hCaptcha dashboard — leave empty for dev to skip verification)
#   - HCAPTCHA_SITE_KEY (from hCaptcha dashboard — the public key)
#   - FRONTEND_ORIGIN (your frontend URL, e.g. http://localhost:3000)
```

### 3. Copy your real product images

The backend serves images from `uploads/` (when `IMAGE_STORAGE_DRIVER=local`). Copy your renamed images here:

```bash
# Your images should be named img_0001.jpg, img_0002.png, etc.
# (matching the image-manifest.txt NEW_NAME column)
cp /path/to/your/renamed/images/*.jpg uploads/
cp /path/to/your/renamed/images/*.png uploads/
```

### 4. Run the product import script

This parses the existing Shopify-export HTML pages + `image-manifest.txt` and populates the database:

```bash
node src/scripts/import-products.js \
  --manifest /path/to/image-manifest.txt \
  --site-root /path/to/extracted-site
```

The script:
- Reads `image-manifest.txt` to build an `OLD_NAME → NEW_NAME` image mapping
- For each product HTML page, extracts product name, price (in cents), description, and image list from the embedded `var meta = {"product":{...}}` JSON
- Falls back to `<h1>` + `og:price:amount` meta tag if JSON is missing
- Upserts products by slug (idempotent — safe to run multiple times)
- Logs any pages that need manual review to `NEEDS-MANUAL-REVIEW.txt`

### 5. Start the dev server

```bash
npm run dev
# or
node src/index.js
```

The API will be available at `http://localhost:4000`.

Health check: `GET http://localhost:4000/api/health`

## API Endpoints

### Auth
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | `{ email, password, hcaptchaToken }` | Create account, sets JWT cookie |
| POST | `/api/auth/login` | `{ email, password, hcaptchaToken }` | Login, sets JWT cookie |
| POST | `/api/auth/logout` | — | Clears JWT cookie |
| GET | `/api/auth/me` | — | Returns current user from cookie |

### Products
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products` | List all products (with first image + variant count) |
| GET | `/api/products/:slug` | Full product detail (images + variants) |

### Images
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/images/:filename` | Streams image file. Filename must match `^img_\d{4}\.(jpg\|jpeg\|png\|webp\|gif)$`. Cache-Control: immutable. |

### Cart
| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/cart` | — | Get current cart (guest or user) |
| POST | `/api/cart/items` | `{ product_id, quantity, variant_id? }` | Add item to cart |
| PATCH | `/api/cart/items/:id` | `{ quantity }` | Update quantity (0 = remove) |
| DELETE | `/api/cart/items/:id` | — | Remove item from cart |

### Cart Identity Approach

- **Guest carts**: tied to a random `zezoyah_cart_id` cookie (httpOnly, 10-year expiry). Guests can shop without creating an account.
- **User carts**: tied to `user_id`. One cart per user, persistent across sessions.
- **On login/register**: the guest cart is merged into the user's cart (matching product+variant → sum quantities; non-matching → moved to user cart). This prevents cart loss on login.

This approach was chosen because:
1. Guests can shop without friction (no account required)
2. Logged-in users get a persistent cart across sessions
3. Merging prevents cart loss on login (common e-commerce UX)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4000` | Server port |
| `NODE_ENV` | No | `development` | Environment (`production` changes cookie settings) |
| `JWT_SECRET` | **Yes** | — | Secret for signing JWT tokens |
| `HCAPTCHA_SECRET` | No* | — | hCaptcha secret key (server-side). If empty, verification is skipped (DEV ONLY) |
| `HCAPTCHA_SITE_KEY` | No | — | hCaptcha site key (public, safe to expose to frontend) |
| `FRONTEND_ORIGIN` | **Yes** | `http://localhost:3000` | Comma-separated list of allowed CORS origins |
| `IMAGE_STORAGE_DRIVER` | No | `local` | `local` or `s3` |
| `IMAGE_LOCAL_PATH` | No | `./uploads` | Path to image folder (when driver=local) |
| `S3_BUCKET` | S3 only | — | S3/R2 bucket name |
| `S3_REGION` | S3 only | `auto` | S3 region |
| `S3_ACCESS_KEY_ID` | S3 only | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | S3 only | — | S3 secret key |
| `S3_ENDPOINT` | S3 only | — | S3 endpoint URL (for Cloudflare R2) |
| `DATABASE_PATH` | No | `./data/zezoyah.db` | SQLite file path |

\* `HCAPTCHA_SECRET` is required in production. Leaving it empty in dev skips verification for convenience.

## CORS & Cookie Configuration

### CORS
Configured via the `cors` package. Allowed origins are set from `FRONTEND_ORIGIN` (comma-separated). `credentials: true` is enabled so the httpOnly auth cookie is sent cross-origin.

### Cookies (JWT auth)
The `zezoyah_token` cookie is set with environment-appropriate options:

- **Production** (frontend and backend on different domains):
  - `httpOnly: true`
  - `secure: true` (HTTPS only)
  - `sameSite: 'none'` (required for cross-origin cookies)
  - `maxAge: 7 days`

- **Local dev** (when `FRONTEND_ORIGIN` contains `localhost`):
  - `httpOnly: true`
  - `secure: false` (works over HTTP)
  - `sameSite: 'lax'`
  - `maxAge: 7 days`

**Important**: `sameSite: 'none'` is required in production specifically because the frontend and backend are on different domains. Both sides must be served over HTTPS (Render provides HTTPS by default). For local dev over plain HTTP, the app automatically switches to `sameSite: 'lax'` + `secure: false`.

## Storage: Local Disk vs S3/R2

### Local Disk (default)
Set `IMAGE_STORAGE_DRIVER=local` and `IMAGE_LOCAL_PATH=/path/to/images`. Images are read from disk.

**Render note**: Render's free/starter tiers don't guarantee persistent disk across redeploys. Either:
- Mount a Render Disk (available on Standard plan+) at `IMAGE_LOCAL_PATH`, OR
- Use S3/R2 storage instead

### S3-Compatible (AWS S3, Cloudflare R2, MinIO)
Set `IMAGE_STORAGE_DRIVER=s3` and configure:
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_ENDPOINT` — for R2: `https://<account>.r2.cloudflarestorage.com`

## Database Schema

SQLite via `better-sqlite3`. Schema is in `src/db.js`. Tables:
- `users` (id, email, password_hash, created_at)
- `products` (id, slug, name, description, price_cents, currency, created_at)
- `product_images` (id, product_id, filename, sort_order)
- `product_variants` (id, product_id, variant_title, price_cents, currency, sku, sort_order)
- `carts` (id, user_id, cart_cookie, created_at)
- `cart_items` (id, cart_id, product_id, variant_id, quantity, created_at)

The data layer is structured to be swappable to Postgres later without a rewrite — the query patterns use standard SQL with prepared statements.

## Deploy to Render

### Option A: Using render.yaml (Blueprint)

1. Push this repo (this folder is the repo root — `src/`, `package.json`, `render.yaml` live at the top level) to a Git repository
2. In Render dashboard: New → Blueprint → select your repo
3. Render will read `render.yaml` and create the service automatically
4. Set the `sync: false` env vars in the Render dashboard:
   - `JWT_SECRET` — generate a long random string
   - `HCAPTCHA_SECRET` — your hCaptcha secret
   - `HCAPTCHA_SITE_KEY` — your hCaptcha site key
   - `FRONTEND_ORIGIN` — your frontend domain (e.g. `https://zezoyah.onrender.com`). Comma-separate multiple origins if needed.

### Option B: Manual setup

1. Create a new Web Service on Render, connect your repo
2. Root Directory: leave blank (repo root)
3. Build Command: `npm install`
4. Start Command: `node src/index.js`
5. Health Check Path: `/api/health`
6. Set all environment variables from `.env.example`

### Persistent Data on Render

- **Database**: Mount a Render Disk at `/opt/render/project/data` (set `DATABASE_PATH` to a path inside this mount). Without a persistent disk, the SQLite DB resets on each deploy.
- **Images (local driver)**: Mount a Render Disk at `/opt/render/project/uploads` and set `IMAGE_LOCAL_PATH` to this path. Upload your images there after first deploy.
- **Images (S3/R2)**: No disk needed — images are stored in your S3/R2 bucket.

## Project Structure

```
server/
├── package.json
├── .env.example
├── render.yaml
├── README.md (this file)
├── uploads/              ← place product images here (local driver)
├── data/                 ← SQLite DB file (created on first run)
└── src/
    ├── index.js          ← Express app entrypoint
    ├── db.js             ← SQLite connection + schema init
    ├── routes/
    │   ├── auth.js       ← /api/auth/*
    │   ├── products.js    ← /api/products/*
    │   ├── images.js      ← /api/images/:filename
    │   ├── cart.js        ← /api/cart/*
    │   └── cart-helpers.js ← shared cart logic (getOrCreateCart, mergeGuestCart)
    ├── middleware/
    │   ├── auth.js       ← JWT verification, cookie helpers
    │   └── hcaptcha.js   ← server-side hCaptcha verification
    ├── storage/
    │   └── index.js      ← getImageStream() abstraction (local + S3)
    └── scripts/
        └── import-products.js ← one-time product import
```
