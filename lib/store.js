// lib/store.js — Supabase adapter (storage + products + settings + jobs)

import { createClient } from '@supabase/supabase-js';

const BUCKET_OUTPUT = 'jewelry';
const BUCKET_INPUT  = 'jewelry-input';
const JOB_ID        = '00000000-0000-0000-0000-000000000001';

// Storage paths are namespaced flatly (no real directories expected here),
// so reject anything that could traverse into another object's path.
function assertSafeStorageKey(name) {
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Invalid file name');
  }
  return name;
}

export class Store {
  constructor(url, serviceKey) {
    this.enabled = Boolean(url && serviceKey);
    this.client = this.enabled
      ? createClient(url, serviceKey, { auth: { persistSession: false } })
      : null;
  }

  // ─── Setup / health check ───────────────────────────────────

  async setup() {
    if (!this.enabled) throw new Error('Supabase not configured');
    const sb = this.client;

    // Ensure buckets exist. Output (catalog renders) is public since the
    // storefront links directly to these images. Input (raw, unprocessed
    // customer photos) is private — only accessible via signed URLs to an
    // authenticated admin, never a bare public link.
    const { data: buckets } = await sb.storage.listBuckets();
    const bucketConfigs = [
      { name: BUCKET_OUTPUT, public: true },
      { name: BUCKET_INPUT, public: false }
    ];
    for (const { name, public: isPublic } of bucketConfigs) {
      if (!buckets?.find(b => b.name === name)) {
        const { error } = await sb.storage.createBucket(name, { public: isPublic });
        if (error && !/already exists/i.test(error.message)) throw error;
      }
    }

    // Verify products table
    const { error } = await sb.from('products').select('id').limit(1);
    if (error) {
      throw new Error(
        'Products table not found. Run SUPABASE_SETUP.sql in the Supabase SQL editor first.'
      );
    }
    return true;
  }

  // ─── Input images (jewelry-input bucket) ────────────────────

  async uploadInputImage(filename, buffer, contentType = 'image/jpeg') {
    if (!this.enabled) throw new Error('Supabase URL or Service Key not configured in env.');
    assertSafeStorageKey(filename);
    const { error } = await this.client.storage
      .from(BUCKET_INPUT)
      .upload(filename, buffer, { contentType, upsert: true });
    if (error) throw error;
    return filename;
  }

  async listInputImages() {
    if (!this.enabled) return [];
    const { data, error } = await this.client.storage.from(BUCKET_INPUT).list('', {
      limit: 500,
      sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw error;
    return (data || [])
      .filter(f => /\.(jpe?g|png|webp)$/i.test(f.name))
      .map(f => f.name);
  }

  async deleteInputImage(filename) {
    if (!this.enabled) return;
    assertSafeStorageKey(filename);
    const { error } = await this.client.storage.from(BUCKET_INPUT).remove([filename]);
    if (error) throw error;
  }

  // Input bucket is private (raw customer/client photos) — callers must be
  // authenticated; this returns a short-lived signed URL rather than a
  // permanent public link.
  async getInputImageUrl(filename) {
    if (!this.enabled) return '';
    assertSafeStorageKey(filename);
    const { data, error } = await this.client.storage
      .from(BUCKET_INPUT)
      .createSignedUrl(filename, 60);
    if (error) throw error;
    return data.signedUrl;
  }

  async getInputImageBuffer(filename) {
    if (!this.enabled) throw new Error('Supabase not configured');
    assertSafeStorageKey(filename);
    const { data, error } = await this.client.storage.from(BUCKET_INPUT).download(filename);
    if (error) throw error;
    const arrayBuf = await data.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // ─── Output images (jewelry bucket) ─────────────────────────

  async uploadImage(folder, filename, buffer, contentType = 'image/png') {
    if (!this.enabled) throw new Error('Supabase not configured');
    assertSafeStorageKey(folder);
    assertSafeStorageKey(filename);
    const key = `${folder}/${filename}`;
    const { error } = await this.client.storage
      .from(BUCKET_OUTPUT)
      .upload(key, buffer, { contentType, upsert: true });
    if (error) throw error;
    const { data } = this.client.storage.from(BUCKET_OUTPUT).getPublicUrl(key);
    return { key, publicUrl: data.publicUrl };
  }

  // ─── Products ───────────────────────────────────────────────

  async insertProduct(row) {
    if (!this.enabled) return;
    const { error } = await this.client.from('products').insert(row);
    if (error) throw error;
  }

  async updateProduct(id, updates) {
    if (!this.enabled) return;
    const { error } = await this.client.from('products').update(updates).eq('id', id);
    if (error) throw error;
  }

  async listProducts({ limit = 100, category = null } = {}) {
    if (!this.enabled) return [];
    let q = this.client.from('products').select('*').order('created_at', { ascending: false }).limit(limit);
    if (category) q = q.eq('category', category);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async deleteProduct(id) {
    if (!this.enabled) return;
    const { data: row } = await this.client.from('products').select('folder,images').eq('id', id).single();
    if (row?.folder) {
      // Delete all images from storage
      const { data: list } = await this.client.storage.from(BUCKET_OUTPUT).list(row.folder);
      if (list?.length) {
        await this.client.storage.from(BUCKET_OUTPUT).remove(list.map(f => `${row.folder}/${f.name}`));
      }
    }
    const { error } = await this.client.from('products').delete().eq('id', id);
    if (error) throw error;
  }

  // ─── Settings (replaces config.json) ────────────────────────

  async getSettings() {
    if (!this.enabled) {
      return {
        gemini_api_key: '', supabase_url: '', supabase_key: '',
        text_model: 'gemini-2.5-flash', image_model: 'gemini-2.5-flash-image',
        scenes: ['marble', 'model', 'golden', 'silk'], angles: [],
        gender: 'female', preset: 'clean'
      };
    }
    const { data, error } = await this.client
      .from('settings')
      .select('*')
      .eq('id', 'main')
      .single();
    if (error) {
      // Table might not exist yet — return defaults
      return {
        gemini_api_key: '', supabase_url: '', supabase_key: '',
        text_model: 'gemini-2.5-flash', image_model: 'gemini-2.5-flash-image',
        scenes: ['marble', 'model', 'golden', 'silk'], angles: [],
        gender: 'female', preset: 'clean'
      };
    }
    return data;
  }

  async saveSettings(updates) {
    if (!this.enabled) throw new Error('Supabase not configured');
    const { error } = await this.client
      .from('settings')
      .upsert({ id: 'main', ...updates, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  // ─── Job tracking (replaces in-memory job object) ───────────

  async getJob() {
    if (!this.enabled) {
      return { running: false, total: 0, done: 0, current: '', step: '', logs: [], results: [], errors: [], perImage: {} };
    }
    const { data, error } = await this.client
      .from('jobs')
      .select('*')
      .eq('id', JOB_ID)
      .single();
    if (error || !data) {
      return { running: false, total: 0, done: 0, current: '', step: '', logs: [], results: [], errors: [], perImage: {} };
    }
    // Ensure perImage map always exists
    if (!data.perImage) data.perImage = {};
    if (data.config_snapshot === undefined) data.config_snapshot = null;
    return data;
  }

  async updateJob(updates) {
    if (!this.enabled) return;
    const { error } = await this.client
      .from('jobs')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', JOB_ID);
    if (error) throw error;
  }

  /**
   * Atomically transition the job from "not running" to "running".
   * Returns false if a batch is already running (racing /api/process calls
   * from a double-click or overlapping requests both lose except one).
   * configSnapshot freezes the creative settings (scenes/angles/gender/
   * preset/aspectRatio/watermarkUrl/imageLimit) for the whole batch so a
   * mid-batch settings change can't desync task sets between products.
   */
  async resetJob(total, allFiles = [], customNames = {}, configSnapshot = null) {
    const perImage = {};
    for (const f of allFiles) {
      perImage[f] = { status: 'queued', phase: '', renderedCount: 0, totalRenders: 0, customName: customNames[f] || '' };
    }
    if (!this.enabled) return true;

    const basePayload = {
      running: true, total, done: 0,
      current: '', step: '',
      logs: [], results: [], errors: [],
      lease_owner: null, lease_expires_at: null
    };

    const attempt = async (payload) => {
      const { data, error } = await this.client
        .from('jobs')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', JOB_ID)
        .eq('running', false)
        .select('id');
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    };

    try {
      return await attempt({ ...basePayload, perImage, config_snapshot: configSnapshot });
    } catch (e) {
      if (/perImage|config_snapshot|lease_owner|lease_expires_at|column/i.test(e.message)) {
        // Migration not yet applied for one of the newer columns — degrade
        // gracefully rather than failing the whole batch start.
        try {
          return await attempt({ ...basePayload, perImage });
        } catch (e2) {
          if (/perImage|column/i.test(e2.message)) {
            return await attempt(basePayload);
          }
          throw e2;
        }
      }
      throw e;
    }
  }

  /**
   * Acquire an exclusive, self-expiring lease on the job row before doing
   * any pipeline work. Only the caller that successfully flips the lease
   * is allowed to process the next step; everyone else (a duplicate tab,
   * a stale retry after a client-side timeout, a concurrent invocation)
   * gets back false and should back off instead of racing the same file.
   */
  async acquireLease(ownerId, ttlMs = 45000) {
    if (!this.enabled) return true;
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    try {
      const { data, error } = await this.client
        .from('jobs')
        .update({ lease_owner: ownerId, lease_expires_at: expiresAt })
        .eq('id', JOB_ID)
        .or(`lease_owner.is.null,lease_expires_at.lt.${nowIso}`)
        .select('id');
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    } catch (e) {
      if (/lease_owner|lease_expires_at|column/i.test(e.message)) {
        // Migration not applied yet — fail open rather than block all
        // processing, but this means the race protection isn't active
        // until SUPABASE_SETUP.sql has been re-run.
        return true;
      }
      throw e;
    }
  }

  async releaseLease(ownerId) {
    if (!this.enabled) return;
    try {
      await this.client
        .from('jobs')
        .update({ lease_owner: null, lease_expires_at: null })
        .eq('id', JOB_ID)
        .eq('lease_owner', ownerId);
    } catch (e) {
      if (!/lease_owner|lease_expires_at|column/i.test(e.message)) throw e;
    }
  }

  /**
   * Update the per-image status for a single file.
   * Merges into the existing perImage map atomically.
   * Silently no-ops if the perImage column doesn't exist in the DB yet.
   */
  async updateJobPerImage(file, statusUpdate) {
    if (!this.enabled) return;
    try {
      const job = await this.getJob();
      const perImage = { ...(job.perImage || {}) };
      perImage[file] = { ...(perImage[file] || {}), ...statusUpdate };
      await this.updateJob({ perImage });
    } catch (e) {
      // Silently skip if perImage column is missing — run migration SQL in Supabase
      if (/perImage|column/i.test(e.message)) return;
      throw e;
    }
  }

  async appendJobLog(msg, level = 'info') {
    if (!this.enabled) return;
    const job = await this.getJob();
    const logs = [...(job.logs || []), { t: new Date().toISOString(), msg, level }];
    // Keep last 1000 log entries
    if (logs.length > 1000) logs.splice(0, logs.length - 1000);
    await this.updateJob({ logs });
  }

  async appendJobResult(result) {
    if (!this.enabled) return;
    const job = await this.getJob();
    await this.updateJob({ results: [...(job.results || []), result] });
  }

  async appendJobError(err) {
    if (!this.enabled) return;
    const job = await this.getJob();
    await this.updateJob({ errors: [...(job.errors || []), err] });
  }

  // ─── CSV export from DB ─────────────────────────────────────

  async exportProductsCsv() {
    if (!this.enabled) return '';
    const products = await this.listProducts({ limit: 10000 });
    const csvCell = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'product_name,category,short_description,long_description,materials,tags,folder,images,image_urls,source_file\n';
    const rows = products.map(r => [
      r.product_name, r.category, r.short_description, r.long_description,
      r.materials, (r.tags || []).join('; '),
      r.folder,
      (r.images || []).map(i => i.name).join('; '),
      (r.images || []).map(i => i.url || '').join('; '),
      r.source_file
    ].map(csvCell).join(','));
    return '\uFEFF' + header + rows.join('\n') + '\n';
  }
}
