# Atelier — Jewelry Product Pipeline (v2)

Local Node.js server + Supabase cloud storage.
One raw jewelry photo in → AI product name, category, tags, luxury copy, and 1–11 scene renders out.
Every product gets its own local folder + a row in Supabase → your storefront pulls it via a public API.

---

## Features

- **AI product copy** — name, category, short + long description, materials placeholders, keyword tags
- **Scene renders** — marble, model editorial, golden hour, silk flat-lay, velvet display, hand macro
- **Extra angles** — front / side / 45° / back / top-down (studio, on the jewelry itself)
- **Model presets** — Indian bridal, Indian modern, Western editorial, Middle-Eastern, East Asian, African, or clean/unspecified — with male / female / mixed toggle
- **Local files** — every product in its own folder + `description.txt` + `product.json`
- **Cloud library** — Supabase Storage (public bucket) + `products` table
- **Storefront API** — any store (Shopify, WooCommerce, MyStore OS, custom) can pull the catalog from `GET /storefront/products` without auth
- **Bulk export** — one `.zip` with every folder + `catalog.csv`

---

## Setup

### 1. Local install (Windows)

Install Node.js 18+, then in this folder:

```bash
npm install
npm start
```

Open **http://localhost:4400** and sign in:

- Email: `productjounery@gmail.com`
- Password: `Karthi@2025`

> Change the password by setting `SUPERADMIN_PASSWORD` in `.env`.

### 2. Gemini

Settings tab → Gemini → paste your API key → **Test key** → Save.

### 3. Supabase (new project — cleanest for this pipeline)

1. Create a new project at [supabase.com](https://supabase.com) → give it a name like *atelier-jewelry*
2. In the SQL editor, run `SUPABASE_SETUP.sql` (included in this repo)
3. Copy your **Project URL** and **service_role key** (Settings → API → *service_role*, not *anon*)
4. In the app: Settings tab → Supabase → paste both → **Test connection**

The app will auto-create a public `jewelry` bucket on first successful test.

---

## Using it

1. **Studio tab** → drop jewelry photos into the queue
2. Pick scenes, angles, gender, style preset
3. Click **Process** — progress bar shows every render live
4. **Products tab** → open any product to see all its renders, download the folder as a `.zip`, or bulk-export everything

---

## Storefront integration (any platform)

Anyone can hit this without auth:

```
GET  https://your-server-or-tunnel/storefront/products
GET  https://your-server-or-tunnel/storefront/products?category=necklace&limit=50
```

Response:

```json
{
  "products": [{
    "id": "…",
    "product_name": "Aurelia Pearl Drop",
    "category": "earrings",
    "short_description": "…",
    "long_description": "…",
    "materials": "[METAL] | [STONE/S] | [PURITY] | [WEIGHT]",
    "tags": ["pearl","gold","bridal"],
    "folder": "Aurelia-Pearl-Drop",
    "images": [{"name":"…","url":"https://…supabase.co/storage/v1/…","scene":"marble","angle":"-"}]
  }]
}
```

Every image has a public Supabase URL — drop it straight into a Shopify / WooCommerce / MyStore OS product without re-uploading.

To expose your local server to the internet safely, use **ngrok** or **cloudflared tunnel** (free).

---

## Git + Vercel

```bash
git init
git add .
git commit -m "atelier jewelry pipeline"
git branch -M main
git remote add origin https://github.com/YOUR_USER/atelier-jewelry.git
git push -u origin main
```

**About Vercel:** the admin UI is static and could deploy, but the actual image processing (Gemini calls, 30–90s per product) won't run on Vercel's serverless timeouts. The recommended setup is:

- **Local Windows machine or small VPS** runs `npm start` — this is where processing happens
- **Storefront pulls** from Supabase directly (no server needed for reads)

If you still want the admin UI on Vercel pointing at your local machine, expose the local server via ngrok and set `PUBLIC_API_URL` — happy to add that in the next iteration.

---

## Environment overrides

Anything in Settings can also be pre-set via `.env` (see `.env.example`):

- `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`
- `PORT`
- `GEMINI_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

---

## Notes on quality

- Jewelry preservation prompt is very strict — the model is instructed **not to alter the piece** and only replace the surrounding scene. Verify a few outputs and tune the scene prompts in `lib/presets.js` if you find drift.
- Karat / purity / weight are **never invented** — always the `[METAL] | [STONE/S] | [PURITY] | [WEIGHT]` placeholder that you fill in.
- Gemini image model may occasionally refuse or return no image; those specific renders are logged as errors and the batch continues.
