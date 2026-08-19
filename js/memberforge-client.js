/**
 * MemberForge — shared Supabase config + minimal REST client.
 *
 * ONE Supabase project backs every tenant organization (shared-schema
 * multi-tenancy — see supabase/schema.sql). Every page loads this single
 * file instead of redeclaring the URL/key inline, so rotating the anon key
 * or pointing at a different project is a one-file change, not a 30-file
 * find-and-replace.
 *
 * Fill these in for your own MemberForge deployment (Supabase project
 * Settings → API). The anon key is safe to ship client-side — it only
 * grants what your Row Level Security policies allow.
 */
const MF_SUPABASE_URL = window.MEMBERFORGE_SUPABASE_URL || 'https://vrmvvrpkqhthsgyqjqby.supabase.co';
const MF_SUPABASE_ANON_KEY = window.MEMBERFORGE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZybXZ2cnBrcWh0aHNneXFqcWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxMTAzNDIsImV4cCI6MjEwMjY4NjM0Mn0.4USPfNPG2eHS5gWsJsywEHGSelkUv2gp_2tNZBXyAsY';

const sb = {
  url: MF_SUPABASE_URL,
  key: MF_SUPABASE_ANON_KEY,
  session: null, // set by js/auth.js after sign-in: { access_token, refresh_token, expires_at }

  headers(extra = {}) {
    const token = (this.session && this.session.access_token) || this.key;
    return {
      'Content-Type': 'application/json',
      'apikey': this.key,
      'Authorization': `Bearer ${token}`,
      ...extra
    };
  },
  async getAll(table, query = '') {
    const res = await fetch(`${this.url}/rest/v1/${table}?${query}`, {
      headers: this.headers({ 'Prefer': 'return=representation' })
    });
    if (!res.ok) throw new Error(`GET ${table} failed: ${res.status}`);
    return res.json();
  },
  async insert(table, data) {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`INSERT ${table} failed: ${err}`); }
    return res.json();
  },
  async update(table, id, data) {
    const res = await fetch(`${this.url}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: this.headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`UPDATE ${table} failed: ${err}`); }
    return res.json();
  },
  async patchWhere(table, query, data) {
    const res = await fetch(`${this.url}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: this.headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`UPDATE ${table} failed: ${err}`); }
    return res.json();
  },
  async upsert(table, data, onConflict = 'id') {
    const res = await fetch(`${this.url}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: this.headers({ 'Prefer': 'return=representation,resolution=merge-duplicates' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`UPSERT ${table} failed: ${err}`); }
    return res.json();
  },
  async delete(table, id) {
    const res = await fetch(`${this.url}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: this.headers()
    });
    if (!res.ok) throw new Error(`DELETE ${table} failed: ${res.status}`);
    return true;
  },
  async deleteWhere(table, query) {
    const res = await fetch(`${this.url}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: this.headers()
    });
    if (!res.ok) throw new Error(`DELETE ${table} failed: ${res.status}`);
    return true;
  },
  async rpc(fn, args = {}) {
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(args)
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`RPC ${fn} failed: ${err}`); }
    return res.json();
  }
};
