// lib/store.js — Supabase adapter (storage + products + settings + jobs)

import { createClient } from '@supabase/supabase-js';

const BUCKET_OUTPUT = 'jewelry';
const BUCKET_INPUT  = 'jewelry-input';
const JOB_ID        = '00000000-0000-0000-0000-000000000001';

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

    // Ensure output bucket
    const { data: buckets } = await sb.storage.listBuckets();
    for (const name of [BUCKET_OUTPUT, BUCKET_INPUT]) {
      if (!buckets?.find(b => b.name === name)) {
        const { error } = await sb.storage.createBucket(name, { public: true });
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
    const { error } = await this.client.storage
      .from(BUCKET_INPUT)
      .upload(filename, buffer, { contentType, upsert: true });
    if (error) throw error;
    const { data } = this.client.storage.from(BUCKET_INPUT).getPublicUrl(filename);
    return data.publicUrl;
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
    const { error } = await this.client.storage.from(BUCKET_INPUT).remove([filename]);
    if (error) throw error;
  }

  getInputImageUrl(filename) {
    if (!this.enabled) return '';
    const { data } = this.client.storage.from(BUCKET_INPUT).getPublicUrl(filename);
    return data.publicUrl;
  }

  async getInputImageBuffer(filename) {
    if (!this.enabled) throw new Error('Supabase not configured');
    const { data, error } = await this.client.storage.from(BUCKET_INPUT).download(filename);
    if (error) throw error;
    const arrayBuf = await data.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // ─── Output images (jewelry bucket) ─────────────────────────

  async uploadImage(folder, filename, buffer, contentType = 'image/png') {
    if (!this.enabled) throw new Error('Supabase not configured');
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
      return { running: false, total: 0, done: 0, current: '', step: '', logs: [], results: [], errors: [] };
    }
    const { data, error } = await this.client
      .from('jobs')
      .select('*')
      .eq('id', JOB_ID)
      .single();
    if (error || !data) {
      return { running: false, total: 0, done: 0, current: '', step: '', logs: [], results: [], errors: [] };
    }
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

  async resetJob(total) {
    await this.updateJob({
      running: true, total, done: 0,
      current: '', step: '',
      logs: [], results: [], errors: []
    });
  }

  async appendJobLog(msg) {
    if (!this.enabled) return;
    const job = await this.getJob();
    const logs = [...(job.logs || []), { t: new Date().toISOString(), msg }];
    // Keep last 500
    if (logs.length > 500) logs.splice(0, logs.length - 500);
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
