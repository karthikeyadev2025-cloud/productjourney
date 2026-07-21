// server.js — Jewelry Pipeline v2 (Vercel + Supabase cloud)
// Deploys as a Vercel serverless function. All data in Supabase.

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { testKey, generateVariant, mimeForFile } from './lib/gemini.js';
import { SCENES, GENDERS, PRESETS, ANGLES, resolveScenes, resolveAngles, buildModelPhrase, determineProductType } from './lib/presets.js';
import { processNextImage, startBatch, buildRenderTasks, applyWatermark } from './lib/pipeline.js';
import { Store } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Required admin credentials — fail closed, never ship a default ───
if (!process.env.SUPERADMIN_EMAIL || !process.env.SUPERADMIN_PASSWORD) {
  throw new Error(
    'SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must both be set in the environment. ' +
    'Refusing to start with a default/guessable admin login baked into source.'
  );
}
const ADMIN_EMAIL     = process.env.SUPERADMIN_EMAIL;
const ADMIN_PASS_HASH = crypto.createHash('sha256')
  .update(process.env.SUPERADMIN_PASSWORD).digest('hex');

// ─── Store singleton ─────────────────────────────────────────
function getStore() {
  return new Store(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
  );
}

// ─── Settings helpers (read from env + Supabase) ─────────────
async function loadConfig(store) {
  const defaults = {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    supabaseUrl:  process.env.SUPABASE_URL || '',
    supabaseKey:  process.env.SUPABASE_SERVICE_KEY || '',
    textModel:    'gemini-3.5-flash',
    imageModel:   'gemini-3.1-flash-lite-image',
    scenes:       ['marble', 'model', 'golden', 'silk'],
    angles:       [],
    gender:       'female',
    preset:       'clean',
    aspectRatio:  '1:1',
    watermarkUrl: '',
    imageLimit:   0
  };

  if (!store.enabled) return defaults;

  try {
    const dbSettings = await store.getSettings();
    // Only fall back to the built-in default when nothing has been saved —
    // an admin's explicit model choice is respected as-is instead of being
    // silently rewritten (previously this substituted a different model
    // with no indication to the admin that their saved choice wasn't used).
    const imageModel = dbSettings.image_model || defaults.imageModel;
    const textModel = dbSettings.text_model || defaults.textModel;
    
    let presetVal = dbSettings.preset || defaults.preset;
    let aspectRatio = '1:1';
    let watermarkUrl = '';
    let imageLimit = 0;

    if (presetVal.includes('_imageLimit_')) {
      const parts = presetVal.split('_imageLimit_');
      imageLimit = parseInt(parts[1], 10) || 0;
      presetVal = parts[0];
    }
    
    if (presetVal.includes('_aspectRatio_')) {
      const parts = presetVal.split('_aspectRatio_');
      presetVal = parts[0];
      const rest = parts[1] || '';
      if (rest.includes('_watermark_')) {
        const subparts = rest.split('_watermark_');
        aspectRatio = subparts[0] || '1:1';
        watermarkUrl = subparts[1] || '';
      } else {
        aspectRatio = rest || '1:1';
      }
    }

    return {
      geminiApiKey: dbSettings.gemini_api_key || defaults.geminiApiKey,
      supabaseUrl:  dbSettings.supabase_url || defaults.supabaseUrl,
      supabaseKey:  dbSettings.supabase_key || defaults.supabaseKey,
      textModel,
      imageModel,
      scenes:       dbSettings.scenes?.length ? dbSettings.scenes : defaults.scenes,
      angles:       dbSettings.angles || defaults.angles,
      gender:       dbSettings.gender || defaults.gender,
      preset:       presetVal,
      aspectRatio:  aspectRatio,
      watermarkUrl: watermarkUrl,
      imageLimit:   imageLimit
    };
  } catch {
    return defaults;
  }
}

async function saveConfig(store, updates) {
  const mapped = {};
  if (updates.geminiApiKey !== undefined) mapped.gemini_api_key = updates.geminiApiKey;
  if (updates.supabaseUrl !== undefined) mapped.supabase_url = updates.supabaseUrl;
  if (updates.supabaseKey !== undefined) mapped.supabase_key = updates.supabaseKey;
  if (updates.textModel !== undefined)   mapped.text_model = updates.textModel;
  if (updates.imageModel !== undefined)  mapped.image_model = updates.imageModel;
  if (updates.scenes !== undefined)      mapped.scenes = updates.scenes;
  if (updates.angles !== undefined)      mapped.angles = updates.angles;
  if (updates.gender !== undefined)      mapped.gender = updates.gender;
  
  if (updates.preset !== undefined || updates.aspectRatio !== undefined || updates.watermarkUrl !== undefined || updates.imageLimit !== undefined) {
    const cfg = await loadConfig(store);
    const pVal = updates.preset !== undefined ? updates.preset : cfg.preset;
    const rVal = updates.aspectRatio !== undefined ? updates.aspectRatio : cfg.aspectRatio;
    const wVal = updates.watermarkUrl !== undefined ? updates.watermarkUrl : cfg.watermarkUrl;
    const lVal = updates.imageLimit !== undefined ? updates.imageLimit : cfg.imageLimit;
    mapped.preset = `${pVal}_aspectRatio_${rVal}_watermark_${wVal}_imageLimit_${lVal}`;
  }
  await store.saveSettings(mapped);
}

// ─── Auth (stateless HMAC tokens — survives Vercel cold starts) ───
// Prefer an explicit SESSION_SECRET; if not set, derive one that is
// domain-separated from ADMIN_PASS_HASH (never reuse the login hash
// directly as the signing key for something else).
const TOKEN_SECRET = process.env.SESSION_SECRET
  || crypto.createHash('sha256').update(`token-signing-v1:${process.env.SUPERADMIN_PASSWORD}`).digest('hex');

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still do a constant-time compare against a same-length dummy so the
    // length mismatch itself doesn't create an easily distinguishable
    // fast-path timing difference.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function createToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  if (!timingSafeStringEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    // Tokens valid for 7 days
    if (Date.now() - data.iat > 7 * 24 * 60 * 60 * 1000) return false;
    return data.email === ADMIN_EMAIL;
  } catch { return false; }
}

function auth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token && verifyToken(token)) return next();
  res.status(401).json({ error: 'Not signed in' });
}

// ─── Best-effort login rate limiting ───────────────────────────
// Note: this is in-memory, per serverless-instance state, so it's not a
// complete defense on Vercel (cold starts / multiple instances reset or
// split the counters) — but it meaningfully raises the cost of naive
// brute forcing and costs nothing to add. Pair with a real WAF/rate
// limiter (e.g. Vercel's own) for a production-hardened deployment.
const loginAttempts = new Map(); // ip -> { count, firstAttemptAt }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
    return true;
  }
  entry.count++;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

// ─── Express app ──────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer with memory storage (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|png|webp)/.test(file.mimetype)),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ──── Auth ────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  const { email, password } = req.body || {};
  const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
  const emailOk = timingSafeStringEqual(String(email || ''), ADMIN_EMAIL);
  const passOk = timingSafeStringEqual(hash, ADMIN_PASS_HASH);
  if (emailOk && passOk) {
    const token = createToken(ADMIN_EMAIL);
    return res.json({ token });
  }
  res.status(401).json({ error: 'Wrong email or password' });
});
app.post('/api/logout', (req, res) => {
  // Stateless — client just deletes the token
  res.json({ ok: true });
});

// ──── Presets ─────────────────────────────────────────────────
app.get('/api/presets', auth, (req, res) => {
  res.json({
    scenes:  SCENES.map(s => ({ key: s.key, label: s.label, needsModel: s.needsModel })),
    genders: GENDERS.map(g => ({ key: g.key, label: g.label })),
    presets: PRESETS.map(p => ({ key: p.key, label: p.label })),
    angles:  ANGLES.map(a => ({ key: a.key, label: a.label })),
    ratios: [
      { key: '1:1', label: '1:1 Square' },
      { key: '16:9', label: '16:9 Banner' },
      { key: '4:5', label: '4:5 Storefront' }
    ]
  });
});

// ──── Settings ────────────────────────────────────────────────
app.get('/api/settings', auth, async (req, res) => {
  try {
    const store = getStore();
    const cfg = await loadConfig(store);
    res.json({
      ...cfg,
      geminiApiKey: cfg.geminiApiKey ? `••••${cfg.geminiApiKey.slice(-4)}` : '',
      supabaseKey:  cfg.supabaseKey  ? `••••${cfg.supabaseKey.slice(-4)}`  : '',
      hasKey: Boolean(cfg.geminiApiKey),
      hasSupabase: Boolean(cfg.supabaseUrl && cfg.supabaseKey)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', auth, async (req, res) => {
  try {
    const store = getStore();
    const cfg = await loadConfig(store);
    const b = req.body || {};
    const updates = {};
    if (b.geminiApiKey && !b.geminiApiKey.startsWith('••••')) updates.geminiApiKey = b.geminiApiKey.trim();
    if (b.supabaseUrl != null) updates.supabaseUrl = String(b.supabaseUrl).trim();
    if (b.supabaseKey && !b.supabaseKey.startsWith('••••')) updates.supabaseKey = b.supabaseKey.trim();
    if (b.textModel)  updates.textModel = String(b.textModel).trim();
    if (b.imageModel) updates.imageModel = String(b.imageModel).trim();
    if (Array.isArray(b.scenes)) updates.scenes = b.scenes;
    if (Array.isArray(b.angles)) updates.angles = b.angles;
    if (b.gender) updates.gender = String(b.gender);
    if (b.preset) updates.preset = String(b.preset);
    if (b.watermarkUrl !== undefined) updates.watermarkUrl = String(b.watermarkUrl);
    if (b.imageLimit !== undefined) updates.imageLimit = Number(b.imageLimit);
    await saveConfig(store, updates);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/upload-watermark', auth, upload.single('logo'), async (req, res) => {
  try {
    const store = getStore();
    if (!req.file) return res.status(400).json({ error: 'No logo file provided' });
    const up = await store.uploadImage('logo', `watermark-${Date.now()}.png`, req.file.buffer, req.file.mimetype);
    await saveConfig(store, { watermarkUrl: up.publicUrl });
    res.json({ ok: true, url: up.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/test-gemini', auth, async (req, res) => {
  try {
    const store = getStore();
    const cfg = await loadConfig(store);
    if (!cfg.geminiApiKey) return res.status(400).json({ error: 'Add a Gemini API key first' });
    await testKey(cfg.geminiApiKey, cfg.textModel);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/settings/test-supabase', auth, async (req, res) => {
  const store = getStore();
  if (!store.enabled) return res.status(400).json({ error: 'Add Supabase URL and service key first' });
  try { await store.setup(); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ──── Input queue (Supabase Storage) ──────────────────────────
app.get('/api/input', auth, async (req, res) => {
  try {
    const store = getStore();
    const files = await store.listInputImages();
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/input/upload', auth, upload.array('images', 100), async (req, res) => {
  try {
    const store = getStore();
    const uploaded = [];
    for (const file of (req.files || [])) {
      const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
      await store.uploadInputImage(safeName, file.buffer, file.mimetype);
      uploaded.push(safeName);
    }
    res.json({ uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/input/:file', auth, async (req, res) => {
  try {
    const store = getStore();
    await store.deleteInputImage(req.params.file);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/input/preview/:file', auth, async (req, res) => {
  try {
    const store = getStore();
    const url = await store.getInputImageUrl(req.params.file);
    res.redirect(url);
  } catch (err) {
    res.status(404).json({ error: 'Not found' });
  }
});

// ──── Processing ──────────────────────────────────────────────
app.post('/api/process', auth, async (req, res) => {
  try {
    const store = getStore();
    const cfg = await loadConfig(store);
    if (!cfg.geminiApiKey) return res.status(400).json({ error: 'Add your Gemini API key in Settings' });

    // Freeze creative settings for the whole batch so a settings change
    // mid-run can't desync task sets between products in the same batch.
    const configSnapshot = {
      scenes: cfg.scenes, angles: cfg.angles, gender: cfg.gender, preset: cfg.preset,
      aspectRatio: cfg.aspectRatio, watermarkUrl: cfg.watermarkUrl, imageLimit: cfg.imageLimit
    };

    // Pass store and customNames map. startBatch() itself does an atomic
    // compare-and-swap (running: false -> true) so overlapping "Start
    // Batch" requests can't both succeed.
    const customNames = req.body?.customNames || {};
    const result = await startBatch(store, customNames, configSnapshot);
    res.json({ started: true, count: result.count });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ error: err.message });
  }
});

// Force-stop the running batch
app.post('/api/process/stop', auth, async (req, res) => {
  try {
    const store = getStore();
    await store.updateJob({ running: false, step: 'Stopped by user.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process one image at a time — client calls this repeatedly
app.post('/api/process/next', auth, async (req, res) => {
  try {
    const store = getStore();
    const cfg = await loadConfig(store);
    if (!cfg.geminiApiKey) return res.status(400).json({ error: 'No Gemini API key' });

    const result = await processNextImage(cfg, store);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/status', auth, async (req, res) => {
  try {
    const store = getStore();
    const job = await store.getJob();
    res.json(job);
  } catch (err) {
    res.json({ running: false, total: 0, done: 0, current: '', step: '', logs: [], results: [], errors: [], perImage: {} });
  }
});

// Enriched status — returns full perImage map and timing info for the Batch Command Center UI
app.get('/api/status/detail', auth, async (req, res) => {
  try {
    const store = getStore();
    const job = await store.getJob();
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    res.json({
      running: job.running || false,
      total: job.total || 0,
      done: job.done || 0,
      pct,
      current: job.current || '',
      step: job.step || '',
      logs: job.logs || [],
      results: job.results || [],
      errors: job.errors || [],
      perImage: job.perImage || {}
    });
  } catch (err) {
    res.json({ running: false, total: 0, done: 0, pct: 0, current: '', step: '', logs: [], results: [], errors: [], perImage: {} });
  }
});

// ──── Products (from Supabase DB) ─────────────────────────────
app.get('/api/products', auth, async (req, res) => {
  try {
    const store = getStore();
    // Limit raised to 10000 to support 100-image batches
    const products = await store.listProducts({ limit: 10000 });
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', auth, async (req, res) => {
  try {
    const store = getStore();
    await store.deleteProduct(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products/bulk-delete', auth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'No product ids provided' });
    const store = getStore();
    const results = { deleted: [], failed: [] };
    for (const id of ids) {
      try {
        await store.deleteProduct(id);
        results.deleted.push(id);
      } catch (err) {
        results.failed.push({ id, error: err.message });
      }
    }
    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id/image/:name', auth, async (req, res) => {
  try {
    const store = getStore();
    const productId = req.params.id;
    const imageName = req.params.name;

    const products = await store.listProducts({ limit: 10000 });
    const product = products.find(p => p.id === productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const images = product.images || [];
    const imageToDelete = images.find(img => img.name === imageName);
    if (!imageToDelete) return res.status(404).json({ error: 'Image not found' });

    if (product.folder) {
      await store.client.storage
        .from('jewelry')
        .remove([`${product.folder}/${imageName}`]);
    }

    const updatedImages = images.filter(img => img.name !== imageName);
    await store.updateProduct(productId, { images: updatedImages });

    res.json({ ok: true, images: updatedImages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate a single scene/angle render for an already-finalized product.
// The raw source photo no longer exists once a product is 'ready' (it's
// removed from the input queue on finalize), so this uses the permanently
// stored 'original' catalog image as the regeneration source instead.
// Caveat: if a watermark is configured, the stored original already has it
// baked in, so this regenerates from a watermarked source rather than the
// pristine raw photo — quality should be close but isn't guaranteed
// identical to the original render pass.
app.post('/api/products/:id/regenerate', auth, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing image name to regenerate' });

    const store = getStore();
    const cfg = await loadConfig(store);
    if (!cfg.geminiApiKey) return res.status(400).json({ error: 'Add your Gemini API key in Settings' });

    const products = await store.listProducts({ limit: 10000 });
    const product = products.find(p => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const images = product.images || [];
    const target = images.find(img => img.name === name);
    if (!target) return res.status(404).json({ error: 'Image not found on this product' });
    if (target.scene === 'original') return res.status(400).json({ error: 'The original canvas image cannot be regenerated' });

    const original = images.find(img => img.scene === 'original' && img.url);
    if (!original) return res.status(400).json({ error: 'No original source image is stored for this product — cannot regenerate' });

    // Rebuild the exact same task list used at render time to recover this
    // scene/angle's prompt.
    const isCopyOnly = cfg.scenes.includes('copy_only');
    const scenes = resolveScenes(cfg.scenes).filter(s => s.key !== 'copy_only');
    const angles = isCopyOnly ? [] : resolveAngles(cfg.angles);
    const modelPhrase = buildModelPhrase({ gender: cfg.gender, preset: cfg.preset });
    const productType = determineProductType(product);
    const tasks = buildRenderTasks(scenes, angles, modelPhrase, productType);
    const task = tasks.find(t => t.sceneKey === target.scene && t.angleKey === target.angle);
    if (!task) return res.status(400).json({ error: 'Current scene/angle settings no longer include this variant — adjust Settings to match, or delete and re-render as part of a new batch.' });

    const sourceRes = await fetch(original.url);
    if (!sourceRes.ok) return res.status(502).json({ error: 'Could not fetch stored original image' });
    const sourceBuf = Buffer.from(await sourceRes.arrayBuffer());
    const sourceBase64 = sourceBuf.toString('base64');

    const buf = await generateVariant(cfg.geminiApiKey, cfg.imageModel, sourceBase64, 'image/png', task.prompt, cfg.aspectRatio || '1:1');
    const watermarkedBuf = cfg.watermarkUrl ? await applyWatermark(buf, cfg.watermarkUrl) : buf;
    const up = await store.uploadImage(product.folder, name, watermarkedBuf, 'image/png');

    const updatedImages = images.map(img => img.name === name
      ? { name, url: up.publicUrl, scene: target.scene, angle: target.angle }
      : img);
    await store.updateProduct(product.id, { images: updatedImages });

    res.json({ ok: true, images: updatedImages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──── Export ───────────────────────────────────────────────────
app.get('/api/export/csv', auth, async (req, res) => {
  try {
    const store = getStore();
    const csv = await store.exportProductsCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="catalog.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──── Storefront pull API (public, no auth) ───────────────────
app.get('/storefront/products', async (req, res) => {
  const store = getStore();
  if (!store.enabled) return res.status(503).json({ error: 'Supabase not configured' });
  try {
    const rows = await store.listProducts({
      limit: Number(req.query.limit) || 200,
      category: req.query.category || null
    });
    
    // Filter out failed renders (placeholder records without a URL)
    const cleanedRows = rows.map(r => {
      if (Array.isArray(r.images)) {
        return {
          ...r,
          images: r.images.filter(img => img.url)
        };
      }
      return r;
    });
    
    res.json({ products: cleanedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──── SPA fallback ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ──── Local dev server ────────────────────────────────────────
const PORT = process.env.PORT || 4400;
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Jewelry Pipeline v2 → http://localhost:${PORT}`);
  });
}

export default app;
