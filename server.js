// server.js — Jewelry Pipeline v2 (Local + Supabase)
// Run: npm install && npm start → http://localhost:4400

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { testKey } from './lib/gemini.js';
import { SCENES, GENDERS, PRESETS, ANGLES } from './lib/presets.js';
import { listInputImages, listLocalProducts, runPipeline, job } from './lib/pipeline.js';
import { Store } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4400;

const DIRS = {
  input:   path.join(__dirname, 'input_raw'),
  output:  path.join(__dirname, 'output'),
  catalog: path.join(__dirname, 'catalog.csv'),
  config:  path.join(__dirname, 'config.json')
};
fs.mkdirSync(DIRS.input, { recursive: true });
fs.mkdirSync(DIRS.output, { recursive: true });

const ADMIN_EMAIL     = process.env.SUPERADMIN_EMAIL || 'productjounery@gmail.com';
const ADMIN_PASS_HASH = crypto.createHash('sha256')
  .update(process.env.SUPERADMIN_PASSWORD || 'Karthi@2025').digest('hex');

const DEFAULT_CONFIG = {
  geminiApiKey: '',
  supabaseUrl:  process.env.SUPABASE_URL  || '',
  supabaseKey:  process.env.SUPABASE_SERVICE_KEY || '',
  textModel:    'gemini-2.5-flash',
  imageModel:   'gemini-2.5-flash-image',
  scenes:       ['marble', 'model', 'golden', 'silk'],
  angles:       [],
  gender:       'female',
  preset:       'clean'
};

function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(DIRS.config, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg) { fs.writeFileSync(DIRS.config, JSON.stringify(cfg, null, 2)); }

// Build a Store from current config
function currentStore() {
  const cfg = loadConfig();
  return new Store(cfg.supabaseUrl, cfg.supabaseKey);
}

const sessions = new Set();
function auth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token && sessions.has(token)) return next();
  res.status(401).json({ error: 'Not signed in' });
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIRS.input),
    filename:    (req, file, cb) => cb(null, file.originalname.replace(/[^\w.\-]/g, '_'))
  }),
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|png|webp)/.test(file.mimetype)),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ---- Auth ----
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
  if (email === ADMIN_EMAIL && hash === ADMIN_PASS_HASH) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    return res.json({ token });
  }
  res.status(401).json({ error: 'Wrong email or password' });
});
app.post('/api/logout', auth, (req, res) => { sessions.delete(req.headers['x-auth-token']); res.json({ ok: true }); });

// ---- Presets ----
app.get('/api/presets', auth, (req, res) => {
  res.json({
    scenes:  SCENES.map(s => ({ key: s.key, label: s.label, needsModel: s.needsModel })),
    genders: GENDERS.map(g => ({ key: g.key, label: g.label })),
    presets: PRESETS.map(p => ({ key: p.key, label: p.label })),
    angles:  ANGLES.map(a => ({ key: a.key, label: a.label }))
  });
});

// ---- Settings ----
app.get('/api/settings', auth, (req, res) => {
  const cfg = loadConfig();
  res.json({
    ...cfg,
    geminiApiKey: cfg.geminiApiKey ? `••••${cfg.geminiApiKey.slice(-4)}` : '',
    supabaseKey:  cfg.supabaseKey  ? `••••${cfg.supabaseKey.slice(-4)}`  : '',
    hasKey: Boolean(cfg.geminiApiKey),
    hasSupabase: Boolean(cfg.supabaseUrl && cfg.supabaseKey)
  });
});

app.post('/api/settings', auth, (req, res) => {
  const cfg = loadConfig();
  const b = req.body || {};
  if (b.geminiApiKey && !b.geminiApiKey.startsWith('••••')) cfg.geminiApiKey = b.geminiApiKey.trim();
  if (b.supabaseUrl != null) cfg.supabaseUrl = String(b.supabaseUrl).trim();
  if (b.supabaseKey && !b.supabaseKey.startsWith('••••')) cfg.supabaseKey = b.supabaseKey.trim();
  if (b.textModel)  cfg.textModel  = String(b.textModel).trim();
  if (b.imageModel) cfg.imageModel = String(b.imageModel).trim();
  if (Array.isArray(b.scenes)) cfg.scenes = b.scenes;
  if (Array.isArray(b.angles)) cfg.angles = b.angles;
  if (b.gender) cfg.gender = String(b.gender);
  if (b.preset) cfg.preset = String(b.preset);
  saveConfig(cfg);
  res.json({ ok: true });
});

app.post('/api/settings/test-gemini', auth, async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.geminiApiKey) return res.status(400).json({ error: 'Add a Gemini API key first' });
  try { await testKey(cfg.geminiApiKey, cfg.textModel); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/settings/test-supabase', auth, async (req, res) => {
  const store = currentStore();
  if (!store.enabled) return res.status(400).json({ error: 'Add Supabase URL and service key first' });
  try { await store.setup(); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ---- Input queue ----
app.get('/api/input', auth, (req, res) => res.json({ files: listInputImages(DIRS.input) }));
app.post('/api/input/upload', auth, upload.array('images', 100), (req, res) => res.json({ uploaded: (req.files || []).map(f => f.filename) }));
app.delete('/api/input/:file', auth, (req, res) => {
  const p = path.join(DIRS.input, path.basename(req.params.file));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});
app.get('/api/input/preview/:file', auth, (req, res) => {
  const p = path.join(DIRS.input, path.basename(req.params.file));
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

// ---- Processing ----
app.post('/api/process', auth, (req, res) => {
  const cfg = loadConfig();
  if (!cfg.geminiApiKey) return res.status(400).json({ error: 'Add your Gemini API key in Settings' });
  if (job.running)       return res.status(409).json({ error: 'A batch is already running' });

  const all = listInputImages(DIRS.input);
  const b = req.body || {};
  const files = Array.isArray(b.files) && b.files.length
    ? b.files.map(f => path.basename(f)).filter(f => all.includes(f))
    : all;
  if (!files.length) return res.status(400).json({ error: 'No images in the upload folder' });

  const runCfg = {
    geminiApiKey: cfg.geminiApiKey,
    textModel:    cfg.textModel,
    imageModel:   cfg.imageModel,
    scenes:       Array.isArray(b.scenes) && b.scenes.length ? b.scenes : cfg.scenes,
    angles:       Array.isArray(b.angles) ? b.angles : cfg.angles,
    gender:       b.gender || cfg.gender,
    preset:       b.preset || cfg.preset
  };

  const store = currentStore();
  runPipeline(files, runCfg, DIRS, store).catch(() => {});
  res.json({ started: true, count: files.length });
});
app.get('/api/status', auth, (req, res) => res.json(job));

// ---- Products (from local disk; Supabase mirror is authoritative for external stores) ----
app.get('/api/products', auth, (req, res) => res.json({ products: listLocalProducts(DIRS.output) }));

app.get('/api/products/:folder/image/:file', auth, (req, res) => {
  const p = path.join(DIRS.output, path.basename(req.params.folder), path.basename(req.params.file));
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

app.get('/api/products/:folder/zip', auth, (req, res) => {
  const folder = path.basename(req.params.folder);
  const dir = path.join(DIRS.output, folder);
  if (!fs.existsSync(dir)) return res.status(404).end();
  res.attachment(`${folder}.zip`);
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.pipe(res); zip.directory(dir, folder); zip.finalize();
});

app.delete('/api/products/:folder', auth, (req, res) => {
  const dir = path.join(DIRS.output, path.basename(req.params.folder));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  res.json({ ok: true });
});

// ---- Bulk export ----
app.get('/api/export/all', auth, (req, res) => {
  res.attachment(`jewelry-catalog-${new Date().toISOString().slice(0, 10)}.zip`);
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.pipe(res);
  zip.directory(DIRS.output, 'products');
  if (fs.existsSync(DIRS.catalog)) zip.file(DIRS.catalog, { name: 'catalog.csv' });
  zip.finalize();
});
app.get('/api/export/csv', auth, (req, res) => {
  if (!fs.existsSync(DIRS.catalog)) return res.status(404).json({ error: 'No catalog yet' });
  res.attachment('catalog.csv'); res.sendFile(DIRS.catalog);
});

// ---- Storefront pull API (public, no auth) ----
// Any store (Shopify/Woo/MyStore OS) can hit this to pull the catalog.
app.get('/storefront/products', async (req, res) => {
  const store = currentStore();
  if (!store.enabled) return res.status(503).json({ error: 'Supabase not configured on server' });
  try {
    const rows = await store.listProducts({ limit: Number(req.query.limit) || 200, category: req.query.category || null });
    res.json({ products: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Jewelry Pipeline v2 → http://localhost:${PORT}`);
  console.log(`Input folder: ${DIRS.input}`);
});
