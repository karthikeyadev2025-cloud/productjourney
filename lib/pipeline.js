// lib/pipeline.js — batch processing engine (cloud/Supabase version)
// Executed step-by-step per Vercel serverless request to prevent 60s timeout limits.
// Saves product record after EVERY individual render — not just at product complete.

import { Jimp } from 'jimp';
import { generateDescription, generateVariant, mimeForFile } from './gemini.js';
import { resolveScenes, resolveAngles, buildModelPhrase } from './presets.js';

// After this many consecutive errors on one file, skip it rather than retrying forever
const MAX_CONSECUTIVE_ERRORS = 5;

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9 \-]/g, '').trim().replace(/\s+/g, '-');
}

async function applyWatermark(imageBuffer, watermarkUrl) {
  if (!watermarkUrl) return imageBuffer;
  try {
    const mainImg = await Jimp.read(imageBuffer);
    const watermark = await Jimp.read(watermarkUrl);
    
    // Scale watermark to occupy 18% of main image width
    const targetWidth = Math.round(mainImg.width * 0.18);
    watermark.resize({ w: targetWidth });
    
    // Set opacity of the watermark
    watermark.opacity(0.85);
    
    // Place watermark at the bottom right corner with 24px padding
    const x = mainImg.width - watermark.width - 24;
    const y = mainImg.height - watermark.height - 24;
    
    // Composite watermark onto image
    mainImg.composite(watermark, x, y);
    
    // Return output always as PNG buffer as requested
    return await mainImg.getBuffer('image/png');
  } catch (err) {
    console.error('[Watermark Error]', err.message);
    return imageBuffer;
  }
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
 * Saves to Supabase after every render step — not only at product finalization.
 */
export async function processNextImage(cfg, store) {
  const job = await store.getJob();

  // 1. Get the current raw images queue
  const inputFiles = await store.listInputImages();
  if (!inputFiles.length) {
    await store.updateJob({ running: false, current: '', step: '' });
    await store.appendJobLog('Batch complete', 'info');
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
      await store.appendJobLog(`${file}: generating descriptions & metadata`, 'info');

      // Mark this image as active / copywriting phase
      await store.updateJobPerImage(file, { status: 'active', phase: 'copy', renderedCount: 0, totalRenders: 0 });

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

      // ← SAVE AFTER COPY STEP
      await store.insertProduct(record);
      await store.appendJobLog(`${copy.product_name}: copywriting completed ✓`, 'info');
      // Update perImage: copy done, now about to render
      await store.updateJobPerImage(file, { status: 'active', phase: 'render', productName: copy.product_name });
      
    } else {
      // ────────────────────────────────────────────────────────
      // Step B: Process the next pending render task
      // ────────────────────────────────────────────────────────
      const isCopyOnly = cfg.scenes.includes('copy_only');
      const scenes = resolveScenes(cfg.scenes).filter(s => s.key !== 'copy_only');
      const angles = isCopyOnly ? [] : resolveAngles(cfg.angles);
      const modelPhrase = buildModelPhrase({ gender: cfg.gender, preset: cfg.preset });
      let tasks = buildRenderTasks(scenes, angles, modelPhrase);
      if (cfg.imageLimit > 0) {
        tasks = tasks.slice(0, cfg.imageLimit);
      }

      // Find the first task that hasn't been rendered yet
      const completed = activeProduct.images || [];
      const pendingTask = tasks.find(t => 
        !completed.some(c => c.scene === t.sceneKey && c.angle === t.angleKey)
      );

      const imageBuffer = await store.getInputImageBuffer(file);
      const imageBase64 = imageBuffer.toString('base64');

      if (pendingTask) {
        // Run single scene variant rendering
        const stepDesc = `Scene ${completed.length + 1}/${tasks.length} — ${pendingTask.sceneLabel}`;
        await store.updateJob({ current: file, step: stepDesc });
        await store.appendJobLog(`${activeProduct.product_name}: rendering "${pendingTask.sceneLabel}"`, 'info');
        // Update perImage: rendering phase with current scene progress
        await store.updateJobPerImage(file, {
          status: 'active',
          phase: 'render',
          productName: activeProduct.product_name,
          renderedCount: completed.length,
          totalRenders: tasks.length,
          currentScene: pendingTask.sceneLabel
        });

        const buf = await generateVariant(cfg.geminiApiKey, cfg.imageModel, imageBase64, mimeType, pendingTask.prompt, cfg.aspectRatio || '1:1');
        const watermarkedBuf = cfg.watermarkUrl ? await applyWatermark(buf, cfg.watermarkUrl) : buf;
        const outName = `${activeProduct.folder}-${String(completed.length + 1).padStart(2, '0')}-${pendingTask.sceneKey}${pendingTask.angleKey !== '-' ? '-' + pendingTask.angleKey : ''}.png`;

        const up = await store.uploadImage(activeProduct.folder, outName, watermarkedBuf, 'image/png');
        const updatedImages = [...completed, { name: outName, url: up.publicUrl, scene: pendingTask.sceneKey, angle: pendingTask.angleKey }];

        // ← SAVE AFTER EACH INDIVIDUAL RENDER (not just at product complete)
        await store.updateProduct(activeProduct.id, { images: updatedImages });
        await store.appendJobLog(`${activeProduct.product_name}: rendered "${pendingTask.sceneLabel}" ✓`, 'info');
        // Update perImage: scene count saved immediately
        await store.updateJobPerImage(file, {
          renderedCount: updatedImages.length,
          totalRenders: tasks.length,
          currentScene: pendingTask.sceneLabel
        });
        
      } else {
        // ────────────────────────────────────────────────────────
        // Step C: All renders finished. Save original & clean up queue
        // ────────────────────────────────────────────────────────
        await store.updateJob({ current: file, step: 'Finalizing catalog assets…' });
        await store.appendJobLog(`${activeProduct.product_name}: saving original canvas & wrapping up`, 'info');
        // Update perImage: finalize phase
        await store.updateJobPerImage(file, {
          status: 'active',
          phase: 'finalize',
          productName: activeProduct.product_name,
          renderedCount: completed.length,
          totalRenders: completed.length
        });

        const watermarkedOrig = cfg.watermarkUrl ? await applyWatermark(imageBuffer, cfg.watermarkUrl) : imageBuffer;
        const originalName = `${activeProduct.folder}-original.png`;
        const up = await store.uploadImage(activeProduct.folder, originalName, watermarkedOrig, 'image/png');

        const finalImages = [...completed, { name: originalName, url: up.publicUrl, scene: 'original', angle: '-' }];
        
        // ← SAVE AFTER ORIGINAL + STATUS SET TO READY
        await store.updateProduct(activeProduct.id, { images: finalImages, status: 'ready' });

        // Remove from raw input bucket queue
        await store.deleteInputImage(file);
        await store.appendJobLog(`${activeProduct.product_name}: campaign fully cataloged ✓`, 'info');

        // Mark perImage as done
        await store.updateJobPerImage(file, {
          status: 'done',
          phase: 'done',
          productName: activeProduct.product_name,
          renderedCount: finalImages.length,
          totalRenders: finalImages.length
        });

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
    const job = await store.getJob();
    const perImage = job.perImage || {};
    const fileInfo = perImage[file] || {};
    const consecutiveErrors = (fileInfo.consecutiveErrors || 0) + 1;

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      // Too many failures — skip this file to unblock the batch
      await store.appendJobLog(
        `${file}: skipped after ${MAX_CONSECUTIVE_ERRORS} consecutive failures — ${err.message}`,
        'error'
      );
      await store.appendJobError({ file, scene: '-', error: `SKIPPED after ${MAX_CONSECUTIVE_ERRORS} errors: ${err.message}` });
      await store.updateJobPerImage(file, { status: 'error', error: err.message, consecutiveErrors, skipped: true });
      // Remove from queue so the batch can continue with the next image
      try { await store.deleteInputImage(file); } catch (_) {}
      // Delete any partial product record in 'processing' state
      try {
        const products = await store.listProducts({ limit: 10000 });
        const partial = products.find(p => p.source_file === file && p.status === 'processing');
        if (partial) await store.updateProduct(partial.id, { status: 'error' });
      } catch (_) {}
    } else {
      await store.appendJobError({ file, scene: '-', error: err.message });
      await store.appendJobLog(`${file}: step failed — ${err.message}. Will retry (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}).`, 'error');
      await store.updateJobPerImage(file, { status: 'error', error: err.message, consecutiveErrors });
      // Do NOT delete the input file — pipeline will retry next interval
    }
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
    await store.appendJobLog('All images complete — batch finished!', 'info');
  }

  return { done: allDone && activeFileResolved, processed: file, remaining: remaining.length };
}

/**
 * Start a new batch — resets job state and returns how many images are queued.
 */
export async function startBatch(store) {
  const inputFiles = await store.listInputImages();
  if (!inputFiles.length) throw new Error('No images in the upload queue');

  // Pass allFiles so resetJob can pre-populate the perImage map for all 100 images
  await store.resetJob(inputFiles.length, inputFiles);
  await store.appendJobLog(`Batch started — ${inputFiles.length} image(s) queued`, 'info');

  return { count: inputFiles.length };
}
