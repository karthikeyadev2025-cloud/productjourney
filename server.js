// server.js — Jewelry Pipeline v2 (Vercel + Supabase cloud)
// Deploys as a Vercel serverless function. All data in Supabase.

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { testKey } from './lib/gemini.js';
import { SCENES, GENDERS, PRESETS, ANGLES } from './lib/presets.js';
import { processNextImage, startBatch } from './lib/pipeline.js';
import { Store } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_EMAIL     = process.env.SUPERADMIN_EMAIL || 'productjounery@gmail.com';
const ADMIN_PASS_HASH = crypto.createHash('sha256')
  .update(process.env.SUPERADMIN_PASSWORD || 'Karthi@2025').digest('hex');

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
    let imageModel = dbSettings.image_model || defaults.imageModel;
    if (imageModel.includes('2.5-flash-image') || imageModel.includes('3.1-flash-image') || !imageModel) {
      imageModel = 'gemini-3.1-flash-lite-image';
    }
    let textModel = dbSettings.text_model || defaults.textModel;
    if (textModel.includes('2.5-flash') || textModel.includes('gemini-flash-latest') || !textModel) {
      textModel = 'gemini-3.5-flash';
    }
    
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
const TOKEN_SECRET = ADMIN_PASS_HASH; // derived from password, stable across instances

function createToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return false;
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
  const { email, password } = req.body || {};
  const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
  if (email === ADMIN_EMAIL && hash === ADMIN_PASS_HASH) {
    const token = createToken(email);
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
    const url = store.getInputImageUrl(req.params.file);
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

    const job = await store.getJob();
    if (job.running) return res.status(409).json({ error: 'A batch is already running' });

    // Pass store so startBatch can pre-populate the perImage map for all queued files
    const result = await startBatch(store);
    res.json({ started: true, count: result.count });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.json({ products: rows });
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
