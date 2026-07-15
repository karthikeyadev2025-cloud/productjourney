// lib/store.js — Supabase adapter (storage + products table)

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'jewelry';

export class Store {
  constructor(url, serviceKey) {
    this.enabled = Boolean(url && serviceKey);
    this.client = this.enabled ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;
  }

  /** Verify connection + ensure bucket + table exist. */
  async setup() {
    if (!this.enabled) throw new Error('Supabase not configured');
    const sb = this.client;

    // Ensure bucket (public, so image URLs work directly)
    const { data: buckets } = await sb.storage.listBuckets();
    if (!buckets?.find(b => b.name === BUCKET)) {
      const { error } = await sb.storage.createBucket(BUCKET, { public: true });
      if (error && !/already exists/i.test(error.message)) throw error;
    }

    // Verify products table exists (created via SQL — see SUPABASE_SETUP.sql)
    const { error } = await sb.from('products').select('id').limit(1);
    if (error) {
      throw new Error(
        'Products table not found. Run SUPABASE_SETUP.sql in the Supabase SQL editor first.'
      );
    }
    return true;
  }

  /** Upload one image buffer, return its public URL. */
  async uploadImage(folder, filename, buffer, contentType = 'image/png') {
    const key = `${folder}/${filename}`;
    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(key, buffer, { contentType, upsert: true });
    if (error) throw error;
    const { data } = this.client.storage.from(BUCKET).getPublicUrl(key);
    return { key, publicUrl: data.publicUrl };
  }

  async insertProduct(row) {
    const { error } = await this.client.from('products').insert(row);
    if (error) throw error;
  }

  async listProducts({ limit = 100, category = null } = {}) {
    let q = this.client.from('products').select('*').order('created_at', { ascending: false }).limit(limit);
    if (category) q = q.eq('category', category);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async deleteProduct(id) {
    const { data: row } = await this.client.from('products').select('folder').eq('id', id).single();
    if (row?.folder) {
      const { data: list } = await this.client.storage.from(BUCKET).list(row.folder);
      if (list?.length) {
        await this.client.storage.from(BUCKET).remove(list.map(f => `${row.folder}/${f.name}`));
      }
    }
    const { error } = await this.client.from('products').delete().eq('id', id);
    if (error) throw error;
  }
}
