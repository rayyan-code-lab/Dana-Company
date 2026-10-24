import { supabase, isSupabaseConfigured } from './supabaseClient';
import { localSdk, eq, contains, or, gte, lt, isNull } from './localEngine';
import { getTableAccess } from './userPermissions';

let globalSessionInstance = null;

/**
 * Dual-Mode Supabase Query Engine
 * Directly connects to Supabase PostgreSQL when configured and migrated,
 * with graceful automatic fallback to the local transaction simulator.
 */

class DualModeQueryBuilder {
  constructor(tableName) {
    this.tableName = tableName;
    this.selectedFields = null;
    this.filters = [];
    this.sortField = null;
    this.sortDesc = false;
    this.pageNumber = 1;
    this.pageSize = 50;
    this.limitCount = null;
    this.aggregations = null;
    this.fallbackBuilder = localSdk.table(tableName);
  }

  select(fields) {
    this.selectedFields = fields;
    this.fallbackBuilder.select(fields);
    return this;
  }

  where(condition) {
    this.filters.push(condition);
    this.fallbackBuilder.where(condition);
    return this;
  }

  orderBy(field) {
    this.sortField = field;
    this.sortDesc = false;
    this.fallbackBuilder.orderBy(field);
    return this;
  }

  orderByDesc(field) {
    this.sortField = field;
    this.sortDesc = true;
    this.fallbackBuilder.orderByDesc(field);
    return this;
  }

  page(pageNumber, pageSize) {
    this.pageNumber = Number(pageNumber) || 1;
    this.pageSize = Number(pageSize) || 50;
    this.fallbackBuilder.page(pageNumber, pageSize);
    return this;
  }

  limit(count) {
    this.limitCount = Number(count);
    this.fallbackBuilder.limit(count);
    return this;
  }

  aggregate(aggregations) {
    this.aggregations = aggregations;
    this.fallbackBuilder.aggregate(aggregations);
    return this;
  }

  assertPermission(action) {
    const user = globalSessionInstance?.user?.();
    if (!user) return;
    const profile = user.profile || 'Manager_c';
    const access = getTableAccess(profile, this.tableName);
    if (!access) return;

    if (action === 'read' && access.access === 'None') {
      throw new Error(`[Security] Permission denied: Role '${profile}' has no read access to table '${this.tableName}'.`);
    }
    if (action === 'create' && !access.canCreate) {
      throw new Error(`[Security] Permission denied: Role '${profile}' cannot create records in table '${this.tableName}'.`);
    }
    if (action === 'update' && !access.canUpdate) {
      throw new Error(`[Security] Permission denied: Role '${profile}' cannot update records in table '${this.tableName}'.`);
    }
    if (action === 'delete' && !access.canDelete) {
      throw new Error(`[Security] Permission denied: Role '${profile}' cannot delete records from table '${this.tableName}'.`);
    }
  }

  async get(id) {
    this.assertPermission('read');
    if (!isSupabaseConfigured || !supabase) {
      return this.fallbackBuilder.get(id);
    }

    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('Id', id)
        .maybeSingle();

      if (error) {
        // Table does not exist in schema cache yet -> fallback
        return this.fallbackBuilder.get(id);
      }
      if (!data) {
        return { success: false, data: null, message: 'Record not found' };
      }
      return { success: true, data };
    } catch {
      return this.fallbackBuilder.get(id);
    }
  }

  async fetch() {
    this.assertPermission('read');
    if (!isSupabaseConfigured || !supabase) {
      return this.fallbackBuilder.fetch();
    }

    try {
      let query = supabase.from(this.tableName).select('*', { count: 'exact' });

      // Apply pushdown where filters if metadata is present
      for (const cond of this.filters) {
        if (cond && cond._meta) {
          const { op, field, value } = cond._meta;
          if (op === 'eq') {
            const actual = (value && typeof value === 'object' && value.Id) ? value.Id : value;
            query = query.eq(field, actual);
          } else if (op === 'contains' && value) {
            query = query.ilike(field, `%${value}%`);
          } else if (op === 'gte') {
            query = query.gte(field, value);
          } else if (op === 'gt') {
            query = query.gt(field, value);
          } else if (op === 'lt') {
            query = query.lt(field, value);
          } else if (op === 'lte') {
            query = query.lte(field, value);
          } else if (op === 'isNull') {
            query = query.is(field, null);
          } else if (op === 'or' && Array.isArray(cond._meta.conditions)) {
            const parts = [];
            for (const sub of cond._meta.conditions) {
              if (sub?._meta?.op === 'eq') {
                parts.push(`${sub._meta.field}.eq.${sub._meta.value}`);
              } else if (sub?._meta?.op === 'isNull') {
                parts.push(`${sub._meta.field}.is.null`);
              }
            }
            if (parts.length > 0) {
              query = query.or(parts.join(','));
            }
          }
        }
      }

      if (this.sortField) {
        query = query.order(this.sortField, { ascending: !this.sortDesc });
      }

      if (this.limitCount != null) {
        query = query.limit(this.limitCount);
      } else if (this.pageNumber && this.pageSize) {
        const from = (this.pageNumber - 1) * this.pageSize;
        const to = from + this.pageSize - 1;
        query = query.range(from, to);
      }

      const { data, count, error } = await query;

      if (error) {
        // Fall back to local simulator if table not yet migrated or query format mismatch
        return this.fallbackBuilder.fetch();
      }

      let rows = data || [];
      for (const cond of this.fallbackBuilder.conditions) {
        if (typeof cond === 'function') {
          rows = rows.filter(cond);
        }
      }

      if (this.selectedFields && Array.isArray(this.selectedFields) && this.selectedFields.length > 0) {
        const keys = this.selectedFields.map((f) => (typeof f === 'string' ? f : f.field)).filter(Boolean);
        rows = rows.map((row) => {
          const item = { Id: row.Id };
          keys.forEach((k) => {
            item[k] = row[k];
          });
          return item;
        });
      }

      const total = count ?? rows.length;
      const hasMore = (this.pageNumber * this.pageSize) < total;

      let aggregators = null;
      if (this.aggregations && Array.isArray(this.aggregations)) {
        aggregators = this.aggregations.map((agg) => ({
          id: agg.id || 'c',
          count: total,
          value: total,
          data: { count: total },
        }));
      }

      return {
        success: true,
        data: rows,
        total,
        hasMore,
        ...(aggregators ? { aggregators } : {}),
      };
    } catch {
      return this.fallbackBuilder.fetch();
    }
  }

  async create(payload) {
    this.assertPermission('create');
    if (!isSupabaseConfigured || !supabase) {
      return this.fallbackBuilder.create(payload);
    }

    const items = Array.isArray(payload) ? payload : [payload];
    if (!items.length) {
      return { success: true, data: [], messages: [] };
    }

    const prepared = items.map((item) => {
      let prefix = this.tableName.slice(0, 3);
      if (this.tableName === 'worker_payments_c') prefix = 'wpay';
      else if (this.tableName === 'purchase_payments_c') prefix = 'ppay';
      return {
        ...item,
        Id: item.Id || (prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      };
    });

    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .insert(prepared)
        .select();

      if (error) {
        console.error(`[SupabaseEngine] Error inserting into ${this.tableName}:`, error);
        return this.fallbackBuilder.create(payload);
      }

      const results = data || prepared;
      this.fallbackBuilder.create(results).catch(() => {});

      return {
        success: true,
        data: results,
        messages: [],
      };
    } catch {
      return this.fallbackBuilder.create(payload);
    }
  }

  async update(payload) {
    this.assertPermission('update');
    if (!isSupabaseConfigured || !supabase) {
      return this.fallbackBuilder.update(payload);
    }

    const items = Array.isArray(payload) ? payload : [payload];
    if (!items.length) {
      return { success: true, data: [], messages: [] };
    }

    try {
      const updatedRows = [];
      for (const item of items) {
        if (!item?.Id) continue;
        const { data, error } = await supabase
          .from(this.tableName)
          .update(item)
          .eq('Id', item.Id)
          .select();

        if (error) {
          return this.fallbackBuilder.update(payload);
        }
        if (data?.[0]) updatedRows.push(data[0]);
        else updatedRows.push(item);
      }

      this.fallbackBuilder.update(updatedRows).catch(() => {});

      return {
        success: true,
        data: updatedRows,
        messages: [],
      };
    } catch {
      return this.fallbackBuilder.update(payload);
    }
  }

  async remove(idOrIds) {
    this.assertPermission('delete');
    const ids = Array.isArray(idOrIds) ? idOrIds.map(String) : [String(idOrIds)];

    if (!isSupabaseConfigured || !supabase) {
      return this.fallbackBuilder.remove(idOrIds);
    }

    try {
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .in('Id', ids);

      if (error) {
        return this.fallbackBuilder.remove(idOrIds);
      }

      this.fallbackBuilder.remove(ids).catch(() => {});

      return {
        success: true,
        data: ids,
        messages: [],
      };
    } catch {
      return this.fallbackBuilder.remove(idOrIds);
    }
  }

  async clear() {
    this.assertPermission('delete');
    return fastClearTable(this.tableName);
  }
}

const SESSION_CACHE_KEY = 'dana_foundry_user_session';

function loadCachedSessionUser() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = localStorage.getItem(SESSION_CACHE_KEY);
      if (stored) return JSON.parse(stored);
    }
  } catch {}
  return null;
}

function saveCachedSessionUser(user) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (user) localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_CACHE_KEY);
    }
  } catch {}
}

class DualModeSession {
  constructor() {
    globalSessionInstance = this;
    this.localSession = localSdk.session;
    this.subscribers = new Set();
    this.currentUser = loadCachedSessionUser();
    this.isInitialized = Boolean(this.currentUser) || !isSupabaseConfigured;

    if (isSupabaseConfigured && supabase) {
      this.readyPromise = supabase.auth.getSession().then(async ({ data, error }) => {
        if (!error && data?.session?.user) {
          const mapped = this.mapSupabaseUser(data.session.user);
          this.currentUser = await this.resolveUserProfile(mapped);
          saveCachedSessionUser(this.currentUser);
          if (this.currentUser?.profile === 'Admin_c' && !data.session.user.user_metadata?.role) {
            supabase.auth.updateUser({ data: { role: 'Admin_c' } }).catch(() => {});
          }
        } else {
          this.currentUser = null;
          saveCachedSessionUser(null);
        }
        this.isInitialized = true;
        this.notify();
        return this.currentUser;
      }).catch(() => {
        this.currentUser = null;
        saveCachedSessionUser(null);
        this.isInitialized = true;
        this.notify();
        return null;
      });

      supabase.auth.onAuthStateChange(async (event, session) => {
        this.isInitialized = true;
        if (event === 'SIGNED_OUT') {
          this.currentUser = null;
          saveCachedSessionUser(null);
          this.notify();
          return;
        }
        if (session?.user) {
          const mapped = this.mapSupabaseUser(session.user);
          this.currentUser = await this.resolveUserProfile(mapped);
          saveCachedSessionUser(this.currentUser);
          this.notify();
        } else if (event === 'INITIAL_SESSION' && !session) {
          this.currentUser = null;
          saveCachedSessionUser(null);
          this.notify();
        }
      });
    } else {
      this.currentUser = this.localSession.user();
      this.isInitialized = true;
      this.readyPromise = Promise.resolve(this.currentUser);
    }
  }

  async resolveUserProfile(baseUser) {
    if (!baseUser || !isSupabaseConfigured || !supabase) return baseUser;
    try {
      const queryPromise = supabase
        .from('user_roles')
        .select('role, name')
        .eq('email', baseUser.emailAddress)
        .maybeSingle();

      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ data: null }), 1500));
      const { data } = await Promise.race([queryPromise, timeoutPromise]);

      if (data?.role) {
        const roleNormalized = String(data.role).toLowerCase().trim();
        baseUser.profile = (roleNormalized.includes('manage')) ? 'Manager_c' : 'Admin_c';
        if (data.name) {
          const parts = data.name.trim().split(' ');
          baseUser.firstName = parts[0];
          baseUser.lastName = parts.slice(1).join(' ') || baseUser.lastName;
        }
      }
    } catch {
      // Fall back to auth user metadata
    }
    return baseUser;
  }

  async isReady() {
    if (this.readyPromise) {
      await this.readyPromise;
    }
    return this.currentUser;
  }

  mapSupabaseUser(user) {
    if (!user) return null;
    const meta = user.user_metadata || {};
    const rawRole = meta.role || meta.profile || user.role || '';
    const roleNormalized = String(rawRole).toLowerCase().trim();
    // Checks for 'manager', 'manager_c', or words containing 'manage'
    const profile = (roleNormalized === 'manager' || roleNormalized === 'manager_c' || roleNormalized.includes('manage'))
      ? 'Manager_c'
      : 'Admin_c';

    return {
      Id: user.id,
      id: user.id,
      firstName: meta.first_name || meta.name || user.email?.split('@')[0] || 'Foundry',
      lastName: meta.last_name || (profile === 'Admin_c' ? 'Administrator' : 'Manager'),
      emailAddress: user.email,
      profile,
    };
  }

  notify() {
    if (!this.isInitialized && !this.currentUser) return;
    this.subscribers.forEach((fn) => {
      try {
        fn({ status: this.currentUser ? 'authenticated' : 'anonymous', user: this.currentUser });
      } catch {}
    });
  }

  user() {
    return this.currentUser;
  }

  getUser() {
    return this.user();
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    if (this.isInitialized || this.currentUser) {
      callback({ status: this.currentUser ? 'authenticated' : 'anonymous', user: this.currentUser });
    }
    return () => this.subscribers.delete(callback);
  }

  async login(credentials) {
    if (isSupabaseConfigured && supabase && credentials?.email && credentials?.password) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email.trim(),
          password: credentials.password,
        });

        if (error) {
          return { ok: false, error: { message: error.message } };
        }

        if (data?.user) {
          const mapped = this.mapSupabaseUser(data.user);
          this.currentUser = await this.resolveUserProfile(mapped);
          saveCachedSessionUser(this.currentUser);
          this.isInitialized = true;
          this.notify();
          return { ok: true, value: this.currentUser };
        }
        return { ok: false, error: { message: 'Authentication returned no user session' } };
      } catch (err) {
        return { ok: false, error: { message: err?.message || 'Login failed' } };
      }
    }

    const result = await this.localSession.login(credentials);
    if (result.ok) {
      this.currentUser = result.value;
      this.notify();
    }
    return result;
  }

  async register(credentials) {
    if (isSupabaseConfigured && supabase && credentials?.email && credentials?.password) {
      try {
        const email = credentials.email.trim();
        const firstName = credentials.firstName || email.split('@')[0];
        const lastName = credentials.lastName || '';
        const role = credentials.role || (credentials.profileSlug === 'manager' ? 'Manager_c' : 'Admin_c');

        const { data, error } = await supabase.auth.signUp({
          email,
          password: credentials.password,
          options: {
            data: {
              first_name: firstName,
              last_name: lastName,
              role,
              profile: role,
            },
          },
        });

        if (error) {
          return { ok: false, error: { message: error.message } };
        }

        if (data?.user) {
          if (!data.session) {
            return {
              ok: true,
              value: this.mapSupabaseUser(data.user),
              requiresConfirmation: true,
              message: 'Account created! If email confirmation is enabled, check your inbox to verify your email before logging in.',
            };
          }
          this.currentUser = this.mapSupabaseUser(data.user);
          this.notify();
          return { ok: true, value: this.currentUser };
        }
        return { ok: false, error: { message: 'Sign-up did not return a user.' } };
      } catch (err) {
        return { ok: false, error: { message: err?.message || 'Registration failed' } };
      }
    }

    const result = await this.localSession.register(credentials);
    if (result.ok) {
      this.currentUser = result.value;
      this.notify();
    }
    return result;
  }

  async sendResetLink({ email }) {
    if (isSupabaseConfigured && supabase && email) {
      try {
        const redirectUrl = `${window.location.origin}/reset-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: redirectUrl,
        });
        if (error) {
          return { ok: false, error: { message: error.message } };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: { message: err?.message || 'Failed to send reset email' } };
      }
    }
    return { ok: true };
  }

  async resetPassword({ newPassword }) {
    if (isSupabaseConfigured && supabase && newPassword) {
      try {
        const { data, error } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (error) {
          return { ok: false, error: { message: error.message } };
        }
        if (data?.user) {
          this.currentUser = this.mapSupabaseUser(data.user);
          this.notify();
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: { message: err?.message || 'Failed to update password' } };
      }
    }
    return { ok: true };
  }

  async changePassword({ newPassword }) {
    return this.resetPassword({ newPassword });
  }

  async verifyEmail({ code, email }) {
    if (isSupabaseConfigured && supabase && code) {
      try {
        const { data, error } = await supabase.auth.verifyOtp({
          token: code,
          type: 'signup',
          email,
        });
        if (error) {
          return { ok: false, error: { message: error.message } };
        }
        if (data?.user) {
          this.currentUser = this.mapSupabaseUser(data.user);
          this.notify();
        }
        return { ok: true, value: this.currentUser };
      } catch (err) {
        return { ok: false, error: { message: err?.message || 'Verification failed' } };
      }
    }
    return { ok: true };
  }

  async resendVerificationCode({ emailAddress }) {
    if (isSupabaseConfigured && supabase && emailAddress) {
      try {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: emailAddress,
        });
        if (error) {
          return { ok: false, error: { message: error.message } };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: { message: err?.message || 'Failed to resend code' } };
      }
    }
    return { ok: true };
  }

  async logout() {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch {}
    }
    await this.localSession.logout();
    this.currentUser = null;
    saveCachedSessionUser(null);
    this.notify();
    return { ok: true };
  }

  async retry() {
    return true;
  }
}

class DualModeStorage {
  constructor() {
    this.localStorage = localSdk.storage;
  }

  validate(file, config) {
    return this.localStorage.validate(file, config);
  }

  async upload(file, options) {
    if (isSupabaseConfigured && supabase) {
      try {
        const path = `evidence/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { data, error } = await supabase.storage.from('foundry-receipts').upload(path, file);
        if (!error && data) {
          const { data: urlData } = supabase.storage.from('foundry-receipts').getPublicUrl(path);
          return {
            Id: 'fil-' + Date.now().toString(36),
            Name: file.name,
            name: file.name,
            Size: Math.round(file.size / 1024),
            size: Math.round(file.size / 1024),
            Type: file.type,
            type: file.type,
            url: urlData.publicUrl,
            storagePath: path,
          };
        }
      } catch {
        // Fall back to local object storage
      }
    }
    return this.localStorage.upload(file, options);
  }

  async preview(file) {
    return this.localStorage.preview(file);
  }

  async download(file) {
    return this.localStorage.download(file);
  }

  toCreateFormat(files) {
    return this.localStorage.toCreateFormat(files);
  }

  getUrl(file) {
    return this.localStorage.getUrl(file);
  }
}

export const CLEAR_DATA_TIERS = [
  // Tier 1: Leaf child records (no foreign keys point to these)
  {
    name: 'Transaction & Operational Registers',
    tables: [
      'purchase_payments_c',
      'purchase_audit_c',
      'stock_movements_c',
      'worker_payments_c',
      'borrowing_repayments_c',
      'owner_funding_repayments_c',
      'transactions_c',
      'attendance_c',
      'payroll_c',
      'sales_c',
      'expenses_c',
      'production_c',
    ],
  },
  // Tier 2: Mid-level entities (referenced by Tier 1)
  {
    name: 'Procurement & Funding Accounts',
    tables: [
      'purchases_c',
      'borrowings_c',
      'owner_funding_c',
    ],
  },
  // Tier 3: Master catalogs / directories (referenced by Tier 1 & 2)
  {
    name: 'Master Catalogs & Directories',
    tables: [
      'stock_items_c',
      'lenders_c',
      'workers_c',
    ],
  },
];

function clearLocalTableCache(tableName) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const STORAGE_KEY = 'dana_foundry_erp_db_v1';
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed[tableName]) {
          parsed[tableName] = [];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
      }
    }
    if (localSdk && typeof localSdk.table === 'function') {
      const localTbl = localSdk.table(tableName);
      if (localTbl && typeof localTbl.clear === 'function') {
        localTbl.clear().catch(() => {});
      }
    }
  } catch {}
}

function clearLocalDatabaseStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const STORAGE_KEY = 'dana_foundry_erp_db_v1';
      const emptyDb = {};
      CLEAR_DATA_TIERS.forEach((tier) => {
        tier.tables.forEach((tbl) => {
          emptyDb[tbl] = [];
        });
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyDb));
    }
    if (localSdk && typeof localSdk.resetDatabase === 'function') {
      localSdk.resetDatabase();
    }
  } catch {}
}

export async function fastClearTable(tableName) {
  if (isSupabaseConfigured && supabase) {
    try {
      // 1. Direct single-roundtrip delete matching all rows in the table
      const { data, error } = await supabase
        .from(tableName)
        .delete()
        .neq('Id', '')
        .select('Id');

      if (error) {
        // Fallback filter if neq has specific type constraints
        const retry = await supabase
          .from(tableName)
          .delete()
          .not('Id', 'is', null)
          .select('Id');

        if (retry.error) {
          // If server filter is restricted, fallback to batch ID deletion
          for (let batch = 0; batch < 50; batch += 1) {
            const { data: idsData } = await supabase.from(tableName).select('Id').limit(500);
            if (!idsData || !idsData.length) break;
            const ids = idsData.map((r) => r.Id);
            await supabase.from(tableName).delete().in('Id', ids);
            if (idsData.length < 500) break;
          }
        }
      }

      // 2. Check if records still remain (indicating RLS delete policy blocked row removal)
      const { count } = await supabase.from(tableName).select('Id', { count: 'exact', head: true });
      if (count && count > 0) {
        const { data: remainingRows } = await supabase.from(tableName).select('Id').limit(500);
        if (remainingRows && remainingRows.length > 0) {
          const ids = remainingRows.map((r) => r.Id);
          const delRes = await supabase.from(tableName).delete().in('Id', ids).select('Id');
          if (!delRes.data || delRes.data.length === 0) {
            throw new Error(`Database security policy (RLS) prevented deletion of records from '${tableName}'. Please execute migration 004 in Supabase SQL editor.`);
          }
        }
      }
    } catch (err) {
      console.warn(`[SupabaseEngine] Fast delete on ${tableName} encountered exception:`, err);
      throw err;
    }
  }

  // Also clear in local simulator engine so offline/cached state stays consistent
  clearLocalTableCache(tableName);

  return { success: true };
}

export async function fastClearAllData(onProgress) {
  const user = globalSessionInstance?.user?.();
  const profile = user?.profile || 'Admin_c';
  if (profile !== 'Admin_c') {
    throw new Error('[Security] Only Administrators can execute Clear All Data.');
  }

  // Ensure current authenticated user metadata has role: Admin_c
  if (isSupabaseConfigured && supabase) {
    try {
      const { data: sessData } = await supabase.auth.getSession();
      if (sessData?.session?.user && !sessData.session.user.user_metadata?.role) {
        await supabase.auth.updateUser({ data: { role: 'Admin_c' } }).catch(() => {});
      }
    } catch {
      // Continue
    }
  }

  // 1. First attempt atomic server-side RPC truncation (clears all 18 tables in 1 single command)
  if (isSupabaseConfigured && supabase) {
    try {
      if (typeof onProgress === 'function') {
        onProgress({
          tier: 1,
          totalTiers: 1,
          tierName: 'All operational records',
          clearedCount: 0,
          totalTables: 18,
        });
      }
      const { data, error } = await supabase.rpc('clear_all_company_data');
      if (!error && (data?.success || data === true)) {
        clearLocalDatabaseStorage();
        return { success: true, method: 'rpc' };
      }
    } catch {
      // Fall through to tiered deletion
    }
  }

  // 2. Fallback: Tiered parallel deletion across table tiers
  let totalCleared = 0;
  const totalTables = CLEAR_DATA_TIERS.reduce((sum, t) => sum + t.tables.length, 0);

  for (let tierIdx = 0; tierIdx < CLEAR_DATA_TIERS.length; tierIdx += 1) {
    const tier = CLEAR_DATA_TIERS[tierIdx];
    if (typeof onProgress === 'function') {
      onProgress({
        tier: tierIdx + 1,
        totalTiers: CLEAR_DATA_TIERS.length,
        tierName: tier.name,
        clearedCount: totalCleared,
        totalTables,
      });
    }

    // Concurrently clear all tables in this dependency tier
    await Promise.all(
      tier.tables.map(async (table) => {
        await fastClearTable(table);
        totalCleared += 1;
      })
    );
  }

  // Also clean local simulator whole-db while preserving users & auth sessions
  clearLocalDatabaseStorage();

  return { success: true, tablesCleared: totalCleared };
}

export const dualSdk = {
  table: (tableName) => new DualModeQueryBuilder(tableName),
  session: new DualModeSession(),
  storage: new DualModeStorage(),
  functions: localSdk.functions,
  clearTable: (tableName) => fastClearTable(tableName),
  clearAllData: (onProgress) => fastClearAllData(onProgress),
  resetDatabase: () => fastClearAllData(),
  isSupabaseConfigured,
};

