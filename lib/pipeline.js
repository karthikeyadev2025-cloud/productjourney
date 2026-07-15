// lib/pipeline.js — batch processing engine (cloud/Supabase version)
// Executed step-by-step per Vercel serverless request to prevent 60s timeout limits.

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

/**
 * Run one single pipeline step.
 * On Vercel, this runs in under 10 seconds per invocation.
 */
export async function processNextImage(cfg, store) {
  const job = await store.getJob();

  // 1. Get the current raw images queue
  const inputFiles = await store.listInputImages();
  if (!inputFiles.length) {
    await store.updateJob({ running: false, current: '', step: '' });
    await store.appendJobLog('Batch complete');
    return { done: true };
  }

  const file = inputFiles[0];
  const mimeType = mimeForFile(file);

  try {
    // Check if there is an active product record in the DB for this file
    const products = await store.listProducts({ limit: 10000 });
    const activeProduct = products.find(p => p.source_file === file && p.status === 'processing');

    if (!activeProduct) {
      // ────────────────────────────────────────────────────────
      // Step A: Generate copywriting details and create DB row
      // ────────────────────────────────────────────────────────
      await store.updateJob({ current: file, step: 'Writing product copywriting…' });
      await store.appendJobLog(`${file}: generating descriptions & metadata`);

      const imageBuffer = await store.getInputImageBuffer(file);
      const imageBase64 = imageBuffer.toString('base64');

      const copy = await generateDescription(cfg.geminiApiKey, cfg.textModel, imageBase64, mimeType);
      
      let folderName = sanitizeName(copy.product_name) || `Product-${Date.now()}`;
      
      // Ensure unique folder name
      const folders = new Set(products.map(p => p.folder));
      let finalFolder = folderName;
      let n = 2;
      while (folders.has(finalFolder)) { finalFolder = `${folderName}-${n}`; n++; }
      folderName = finalFolder;

      const record = {
        product_name: copy.product_name,
        category: copy.category || 'other',
        short_description: copy.short_description,
        long_description: copy.long_description,
        materials: copy.materials || '[METAL/FABRIC/INGREDIENTS] | [SPECIFICATION] | [WEIGHT/SIZE]',
        tags: copy.tags || [],
        folder: folderName,
        images: [],
        source_file: file,
        status: 'processing',
        created_at: new Date().toISOString()
      };

      await store.insertProduct(record);
      await store.appendJobLog(`${copy.product_name}: copywriting completed successfully.`);
      
    } else {
      // ────────────────────────────────────────────────────────
      // Step B: Process the next pending render task
      // ────────────────────────────────────────────────────────
      const scenes = resolveScenes(cfg.scenes);
      const angles = resolveAngles(cfg.angles);
      const modelPhrase = buildModelPhrase({ gender: cfg.gender, preset: cfg.preset });
      const tasks = buildRenderTasks(scenes, angles, modelPhrase);

      // Find the first task that hasn't been rendered yet
      const completed = activeProduct.images || [];
      const pendingTask = tasks.find(t => 
        !completed.some(c => c.scene === t.sceneKey && c.angle === t.angleKey)
      );

      const imageBuffer = await store.getInputImageBuffer(file);
      const imageBase64 = imageBuffer.toString('base64');

      if (pendingTask) {
        // Run single scene variant rendering
        const stepDesc = `Image ${completed.length + 1}/${tasks.length} — ${pendingTask.sceneLabel}`;
        await store.updateJob({ current: file, step: stepDesc });
        await store.appendJobLog(`${activeProduct.product_name}: rendering "${pendingTask.sceneLabel}"`);

        const buf = await generateVariant(cfg.geminiApiKey, cfg.imageModel, imageBase64, mimeType, pendingTask.prompt);
        const outName = `${activeProduct.folder}-${String(completed.length + 1).padStart(2, '0')}-${pendingTask.sceneKey}${pendingTask.angleKey !== '-' ? '-' + pendingTask.angleKey : ''}.png`;

        const up = await store.uploadImage(activeProduct.folder, outName, buf, 'image/png');
        const updatedImages = [...completed, { name: outName, url: up.publicUrl, scene: pendingTask.sceneKey, angle: pendingTask.angleKey }];

        await store.updateProduct(activeProduct.id, { images: updatedImages });
        await store.appendJobLog(`${activeProduct.product_name}: rendered "${pendingTask.sceneLabel}" successfully.`);
        
      } else {
        // ────────────────────────────────────────────────────────
        // Step C: All renders finished. Save original & clean up queue
        // ────────────────────────────────────────────────────────
        await store.updateJob({ current: file, step: 'Finalizing catalog assets…' });
        await store.appendJobLog(`${activeProduct.product_name}: saving original canvas & wrapping up`);

        const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
        const originalName = `${activeProduct.folder}-original${ext}`;
        const up = await store.uploadImage(activeProduct.folder, originalName, imageBuffer, mimeType);

        const finalImages = [...completed, { name: originalName, url: up.publicUrl, scene: 'original', angle: '-' }];
        
        // Update product to ready
        await store.updateProduct(activeProduct.id, { images: finalImages, status: 'ready' });

        // Remove from raw input bucket queue
        await store.deleteInputImage(file);
        await store.appendJobLog(`${activeProduct.product_name}: campaign fully cataloged.`);

        // Increment progress count
        const jobData = await store.getJob();
        const newDone = (jobData.done || 0) + 1;
        await store.updateJob({ done: newDone });
        
        await store.appendJobResult({
          file, product_name: activeProduct.product_name, folder: activeProduct.folder, images: finalImages.length
        });
      }
    }
  } catch (err) {
    await store.appendJobError({ file, scene: '-', error: err.message });
    await store.appendJobLog(`${file}: step failed — ${err.message}. Will retry.`);
    // Do NOT delete the input file if a transient error happens so Vercel can retry on next interval!
  }

  // Check remaining count
  const remaining = await store.listInputImages();
  const jobData = await store.getJob();
  const allDone = remaining.length === 0;

  // Check if active file is fully resolved
  const activeProducts = await store.listProducts({ limit: 10000 });
  const activeFileResolved = !activeProducts.some(p => p.source_file === file && p.status === 'processing');

  let currentFile = file;
  if (activeFileResolved && remaining.length > 0) {
    currentFile = remaining[0];
  }

  await store.updateJob({
    running: !allDone || !activeFileResolved,
    current: allDone && activeFileResolved ? '' : currentFile,
    step: allDone && activeFileResolved ? '' : 'Processing pipeline campaign…'
  });

  if (allDone && activeFileResolved) {
    await store.appendJobLog('Batch complete');
  }

  return { done: allDone && activeFileResolved, processed: file, remaining: remaining.length };
}

/**
 * Start a new batch — resets job state and returns how many images are queued.
 */
export async function startBatch(store) {
  const inputFiles = await store.listInputImages();
  if (!inputFiles.length) throw new Error('No images in the upload queue');

  await store.resetJob(inputFiles.length);
  await store.appendJobLog(`Batch started — ${inputFiles.length} image(s)`);

  return { count: inputFiles.length };
}
