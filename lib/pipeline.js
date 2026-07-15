// lib/pipeline.js — batch processing engine

import fs from 'fs';
import path from 'path';
import { generateDescription, generateVariant, mimeForFile } from './gemini.js';
import { resolveScenes, resolveAngles, buildModelPhrase, SCENES } from './presets.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export function listInputImages(inputDir) {
  if (!fs.existsSync(inputDir)) return [];
  return fs.readdirSync(inputDir)
    .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .sort();
}

export function listLocalProducts(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dir = path.join(outputDir, d.name);
      const files = fs.readdirSync(dir).filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
      let meta = null;
      const metaPath = path.join(dir, 'product.json');
      if (fs.existsSync(metaPath)) { try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {} }
      return { folder: d.name, images: files, meta };
    })
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9 \-]/g, '').trim().replace(/\s+/g, '-');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = 'product_name,category,short_description,long_description,materials,tags,folder,images,image_urls,source_file\n';

function appendCatalog(catalogPath, row) {
  if (!fs.existsSync(catalogPath)) fs.writeFileSync(catalogPath, '\uFEFF' + CSV_HEADER);
  const line = [
    row.product_name, row.category, row.short_description, row.long_description,
    row.materials, (row.tags || []).join('; '),
    row.folder, row.images.map(i => i.name).join('; '), row.images.map(i => i.url || '').join('; '),
    row.source_file
  ].map(csvCell).join(',') + '\n';
  fs.appendFileSync(catalogPath, line);
}

// ---- Job state (single active job, polled by UI) ----

export const job = {
  running: false, total: 0, done: 0, current: '', step: '',
  logs: [], results: [], errors: []
};

function log(msg) {
  job.logs.push({ t: new Date().toISOString(), msg });
  if (job.logs.length > 500) job.logs.shift();
}

/**
 * Compose the list of (scene, angle) render tasks for one product.
 * Every scene runs once, and if angles are chosen, every angle × non-model scene runs too.
 * Model-based scenes only get one shot each (angle wouldn't make sense for a full lifestyle scene).
 */
function buildRenderTasks(scenes, angles, modelPhrase) {
  const tasks = [];
  for (const scene of scenes) {
    const scenePrompt = scene.prompt.replace(/{MODEL}/g, modelPhrase);
    tasks.push({ sceneKey: scene.key, sceneLabel: scene.label, angleKey: '-', prompt: scenePrompt });
  }
  if (angles.length) {
    for (const angle of angles) {
      const prompt = `Clean product studio shot of the jewelry on a neutral seamless background, ${angle.phrase}, soft directional lighting, sharp focus.`;
      tasks.push({ sceneKey: 'angle', sceneLabel: `Angle · ${angle.label}`, angleKey: angle.key, prompt });
    }
  }
  return tasks;
}

async function processOne(file, cfg, dirs, store) {
  const srcPath = path.join(dirs.input, file);
  const imageBase64 = fs.readFileSync(srcPath).toString('base64');
  const mimeType = mimeForFile(file);

  job.current = file;
  job.step = 'Writing product copy…';
  log(`${file}: generating description`);

  const copy = await generateDescription(cfg.geminiApiKey, cfg.textModel, imageBase64, mimeType);

  let folderName = sanitizeName(copy.product_name) || `Product-${Date.now()}`;
  let productDir = path.join(dirs.output, folderName);
  let n = 2;
  while (fs.existsSync(productDir)) { productDir = path.join(dirs.output, `${folderName}-${n}`); n++; }
  folderName = path.basename(productDir);
  fs.mkdirSync(productDir, { recursive: true });

  const scenes = resolveScenes(cfg.scenes);
  const angles = resolveAngles(cfg.angles);
  const modelPhrase = buildModelPhrase({ gender: cfg.gender, preset: cfg.preset });
  const tasks = buildRenderTasks(scenes, angles, modelPhrase);

  const savedImages = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    job.step = `Image ${i + 1}/${tasks.length} — ${t.sceneLabel}`;
    log(`${copy.product_name}: rendering "${t.sceneLabel}"`);
    try {
      const buf = await generateVariant(cfg.geminiApiKey, cfg.imageModel, imageBase64, mimeType, t.prompt);
      const outName = `${folderName}-${String(i + 1).padStart(2, '0')}-${t.sceneKey}${t.angleKey !== '-' ? '-' + t.angleKey : ''}.png`;
      fs.writeFileSync(path.join(productDir, outName), buf);

      let publicUrl = null;
      if (store?.enabled) {
        try {
          const up = await store.uploadImage(folderName, outName, buf, 'image/png');
          publicUrl = up.publicUrl;
        } catch (err) {
          log(`${copy.product_name}: cloud upload failed for "${outName}" — ${err.message}`);
        }
      }
      savedImages.push({ name: outName, url: publicUrl, scene: t.sceneKey, angle: t.angleKey });
    } catch (err) {
      job.errors.push({ file, scene: t.sceneLabel, error: err.message });
      log(`${copy.product_name}: "${t.sceneLabel}" failed — ${err.message}`);
    }
  }

  // Keep original alongside renders
  const originalName = `${folderName}-original${path.extname(file).toLowerCase()}`;
  fs.copyFileSync(srcPath, path.join(productDir, originalName));
  fs.unlinkSync(srcPath);

  const record = {
    product_name: copy.product_name,
    category: copy.category || 'other',
    short_description: copy.short_description,
    long_description: copy.long_description,
    materials: copy.materials || '[METAL] | [STONE/S] | [PURITY] | [WEIGHT]',
    tags: copy.tags || [],
    folder: folderName,
    images: savedImages,
    source_file: file,
    created_at: new Date().toISOString()
  };

  fs.writeFileSync(path.join(productDir, 'product.json'), JSON.stringify(record, null, 2));
  fs.writeFileSync(
    path.join(productDir, 'description.txt'),
    `${record.product_name}\n\n${record.short_description}\n\n${record.long_description}\n\nMaterials: ${record.materials}\n\nTags: ${record.tags.join(', ')}\n`
  );
  appendCatalog(dirs.catalog, record);

  if (store?.enabled) {
    try { await store.insertProduct(record); }
    catch (err) { log(`${copy.product_name}: DB insert failed — ${err.message}`); }
  }

  job.results.push({ file, product_name: copy.product_name, folder: folderName, images: savedImages.length });
  log(`${copy.product_name}: done (${savedImages.length}/${tasks.length} images)`);
}

export async function runPipeline(files, cfg, dirs, store) {
  if (job.running) throw new Error('A job is already running');
  Object.assign(job, { running: true, total: files.length, done: 0, current: '', step: '', logs: [], results: [], errors: [] });
  log(`Batch started — ${files.length} image(s), ${resolveScenes(cfg.scenes).length + resolveAngles(cfg.angles).length} renders each`);

  try {
    for (const file of files) {
      try { await processOne(file, cfg, dirs, store); }
      catch (err) { job.errors.push({ file, scene: '-', error: err.message }); log(`${file}: failed — ${err.message}`); }
      job.done++;
    }
    log('Batch complete');
  } finally {
    job.running = false; job.current = ''; job.step = '';
  }
}
