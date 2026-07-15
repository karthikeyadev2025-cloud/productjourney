// lib/pipeline.js — batch processing engine (cloud/Supabase version)

import { generateDescription, generateVariant, mimeForFile } from './gemini.js';
import { resolveScenes, resolveAngles, buildModelPhrase } from './presets.js';

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9 \-]/g, '').trim().replace(/\s+/g, '-');
}

/**
 * Compose the list of (scene, angle) render tasks for one product.
 */
function buildRenderTasks(scenes, angles, modelPhrase) {
  const tasks = [];
  for (const scene of scenes) {
    const scenePrompt = scene.prompt.replace(/{MODEL}/g, modelPhrase);
    tasks.push({ sceneKey: scene.key, sceneLabel: scene.label, angleKey: '-', prompt: scenePrompt });
  }
  if (angles.length) {
    for (const angle of angles) {
      const prompt = `Clean product studio shot of the product on a neutral seamless background, ${angle.phrase}, soft directional lighting, sharp focus.`;
      tasks.push({ sceneKey: 'angle', sceneLabel: `Angle · ${angle.label}`, angleKey: angle.key, prompt });
    }
  }
  return tasks;
}

async function processOne(file, cfg, store) {
  // Download input image from Supabase
  const imageBuffer = await store.getInputImageBuffer(file);
  const imageBase64 = imageBuffer.toString('base64');
  const mimeType = mimeForFile(file);

  await store.updateJob({ current: file, step: 'Writing product copy…' });
  await store.appendJobLog(`${file}: generating description`);

  const copy = await generateDescription(cfg.geminiApiKey, cfg.textModel, imageBase64, mimeType);

  let folderName = sanitizeName(copy.product_name) || `Product-${Date.now()}`;

  // Check for existing folder name in DB and make unique
  const existing = await store.listProducts({ limit: 10000 });
  const existingFolders = new Set(existing.map(p => p.folder));
  let finalFolder = folderName;
  let n = 2;
  while (existingFolders.has(finalFolder)) { finalFolder = `${folderName}-${n}`; n++; }
  folderName = finalFolder;

  const scenes = resolveScenes(cfg.scenes);
  const angles = resolveAngles(cfg.angles);
  const modelPhrase = buildModelPhrase({ gender: cfg.gender, preset: cfg.preset });
  const tasks = buildRenderTasks(scenes, angles, modelPhrase);

  const savedImages = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    await store.updateJob({ step: `Image ${i + 1}/${tasks.length} — ${t.sceneLabel}` });
    await store.appendJobLog(`${copy.product_name}: rendering "${t.sceneLabel}"`);
    try {
      const buf = await generateVariant(cfg.geminiApiKey, cfg.imageModel, imageBase64, mimeType, t.prompt);
      const outName = `${folderName}-${String(i + 1).padStart(2, '0')}-${t.sceneKey}${t.angleKey !== '-' ? '-' + t.angleKey : ''}.png`;

      const up = await store.uploadImage(folderName, outName, buf, 'image/png');
      savedImages.push({ name: outName, url: up.publicUrl, scene: t.sceneKey, angle: t.angleKey });
    } catch (err) {
      await store.appendJobError({ file, scene: t.sceneLabel, error: err.message });
      await store.appendJobLog(`${copy.product_name}: "${t.sceneLabel}" failed — ${err.message}`);
    }
  }

  // Upload original image to output folder too
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  const originalName = `${folderName}-original${ext}`;
  const origMime = mimeForFile(file);
  await store.uploadImage(folderName, originalName, imageBuffer, origMime);

  // Delete from input bucket
  await store.deleteInputImage(file);

  const record = {
    product_name: copy.product_name,
    category: copy.category || 'other',
    short_description: copy.short_description,
    long_description: copy.long_description,
    materials: copy.materials || '[METAL/FABRIC/INGREDIENTS] | [SPECIFICATION] | [WEIGHT/SIZE]',
    tags: copy.tags || [],
    folder: folderName,
    images: savedImages,
    source_file: file,
    created_at: new Date().toISOString()
  };

  await store.insertProduct(record);

  await store.appendJobResult({
    file, product_name: copy.product_name, folder: folderName, images: savedImages.length
  });
  await store.appendJobLog(`${copy.product_name}: done (${savedImages.length}/${tasks.length} images)`);
}

/**
 * Run the pipeline for a single image (called per-request on Vercel).
 * Unlike the local version which batched everything, this processes ONE image per
 * serverless invocation to stay within Vercel's 60s timeout.
 */
export async function processNextImage(cfg, store) {
  const job = await store.getJob();

  // Find the next unprocessed file from the input bucket
  const inputFiles = await store.listInputImages();
  if (!inputFiles.length) {
    // All done
    await store.updateJob({ running: false, current: '', step: '' });
    await store.appendJobLog('Batch complete');
    return { done: true };
  }

  const file = inputFiles[0];
  try {
    await processOne(file, cfg, store);
  } catch (err) {
    await store.appendJobError({ file, scene: '-', error: err.message });
    await store.appendJobLog(`${file}: failed — ${err.message}`);
    // Still delete from input so we don't get stuck
    try { await store.deleteInputImage(file); } catch {}
  }

  // Update progress
  const remaining = await store.listInputImages();
  const jobData = await store.getJob();
  const newDone = (jobData.done || 0) + 1;
  const allDone = remaining.length === 0;

  await store.updateJob({
    done: newDone,
    running: !allDone,
    current: allDone ? '' : remaining[0] || '',
    step: allDone ? '' : 'Waiting for next request…'
  });

  if (allDone) {
    await store.appendJobLog('Batch complete');
  }

  return { done: allDone, processed: file, remaining: remaining.length };
}

/**
 * Start a new batch — resets job state and returns how many images are queued.
 */
export async function startBatch(store) {
  const inputFiles = await store.listInputImages();
  if (!inputFiles.length) throw new Error('No images in the upload queue');

  await store.resetJob(inputFiles.length);
  const scenes = 4; // will be calculated per-image
  await store.appendJobLog(`Batch started — ${inputFiles.length} image(s)`);

  return { count: inputFiles.length };
}
