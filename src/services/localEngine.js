import { INITIAL_DATA } from './seedData';

const STORAGE_KEY = 'dana_foundry_erp_db_v1';
const SESSION_KEY = 'dana_foundry_erp_user_v1';

const DEFAULT_ADMIN_USER = {
  Id: 'usr-admin-01',
  firstName: 'DANA',
  lastName: 'Owner',
  emailAddress: 'owner@danacompany.in',
  profile: 'Admin_c',
};

class LocalDatabase {
  constructor() {
    this.tables = this.load();
    this.listeners = new Set();
  }

  load() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return JSON.parse(JSON.stringify(INITIAL_DATA));
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.save(INITIAL_DATA);
        return JSON.parse(JSON.stringify(INITIAL_DATA));
      }
      const parsed = JSON.parse(raw);
      // Merge any newly introduced tables from initial data
      for (const [key, rows] of Object.entries(INITIAL_DATA)) {
        if (!parsed[key]) parsed[key] = rows;
      }
      return parsed;
    } catch {
      return JSON.parse(JSON.stringify(INITIAL_DATA));
    }
  }

  save(data) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data || this.tables));
      }
    } catch (e) {
      console.warn('LocalDatabase save error:', e);
    }
  }

  resetAll() {
    this.tables = JSON.parse(JSON.stringify(INITIAL_DATA));
    this.save(this.tables);
    this.notify();
  }

  getTable(name) {
    if (!this.tables[name]) {
      this.tables[name] = [];
    }
    return this.tables[name];
  }

  notify() {
    this.save();
    this.listeners.forEach((fn) => fn());
  }
}

export const db = new LocalDatabase();

// --- Filter Condition Helpers ---
export const eq = (field, value) => {
  const fn = (row) => {
    const current = row[field];
    if (current && typeof current === 'object' && current.Id) {
      return String(current.Id) === String(value?.Id ?? value);
    }
    return String(current ?? '') === String(value ?? '');
  };
  fn._meta = { op: 'eq', field, value };
  return fn;
};

export const contains = (field, query) => {
  const fn = (row) => {
    if (!query) return true;
    const target = String(row[field] ?? '').toLowerCase();
    return target.includes(String(query).toLowerCase());
  };
  fn._meta = { op: 'contains', field, value: query };
  return fn;
};

export const or = (...conditions) => {
  const fn = (row) => {
    return conditions.some((cond) => {
      if (typeof cond === 'function') return cond(row);
      return false;
    });
  };
  fn._meta = { op: 'or', conditions };
  return fn;
};

export const gte = (field, value) => {
  const fn = (row) => {
    const cur = row[field];
    return cur != null && cur >= value;
  };
  fn._meta = { op: 'gte', field, value };
  return fn;
};

export const gt = (field, value) => {
  const fn = (row) => {
    const cur = row[field];
    return cur != null && cur > value;
  };
  fn._meta = { op: 'gt', field, value };
  return fn;
};

export const lt = (field, value) => {
  const fn = (row) => {
    const cur = row[field];
    return cur != null && cur < value;
  };
  fn._meta = { op: 'lt', field, value };
  return fn;
};

export const lte = (field, value) => {
  const fn = (row) => {
    const cur = row[field];
    return cur != null && cur <= value;
  };
  fn._meta = { op: 'lte', field, value };
  return fn;
};

export const isNull = (field) => {
  const fn = (row) => {
    return row[field] == null || row[field] === '';
  };
  fn._meta = { op: 'isNull', field };
  return fn;
};

// Polyfill window.ApperSDK globally so legacy components continue working without edits
if (typeof window !== 'undefined') {
  window.ApperSDK = window.ApperSDK || {};
  window.ApperSDK.CoreSDK = {
    eq,
    contains,
    or,
    gte,
    gt,
    lt,
    lte,
    isNull,
  };
}

class QueryBuilder {
  constructor(tableName) {
    this.tableName = tableName;
    this.selectedFields = null;
    this.conditions = [];
    this.sortField = null;
    this.sortDesc = false;
    this.pageNumber = 1;
    this.pageSize = 50;
    this.limitCount = null;
    this.aggregations = null;
  }

  select(fields) {
    this.selectedFields = fields;
    return this;
  }

  where(condition) {
    if (condition) {
      this.conditions.push(condition);
    }
    return this;
  }

  orderBy(field) {
    this.sortField = field;
    this.sortDesc = false;
    return this;
  }

  orderByDesc(field) {
    this.sortField = field;
    this.sortDesc = true;
    return this;
  }

  page(pageNumber, pageSize) {
    this.pageNumber = Number(pageNumber) || 1;
    this.pageSize = Number(pageSize) || 50;
    return this;
  }

  limit(count) {
    this.limitCount = Number(count);
    return this;
  }

  aggregate(aggregations) {
    this.aggregations = aggregations;
    return this;
  }

  async get(id) {
    const table = db.getTable(this.tableName);
    const row = table.find((item) => String(item.Id) === String(id));
    if (!row) {
      return { success: false, data: null, message: 'Record not found' };
    }
    return { success: true, data: { ...row } };
  }

  async fetch() {
    let rows = [...db.getTable(this.tableName)];

    // Apply where filters
    for (const cond of this.conditions) {
      if (typeof cond === 'function') {
        rows = rows.filter(cond);
      }
    }

    // Handle Aggregations if requested (used for badge counts in navigation)
    let aggregators = null;
    if (this.aggregations && Array.isArray(this.aggregations)) {
      aggregators = this.aggregations.map((agg) => {
        let count = rows.length;
        if (agg.where && typeof agg.where === 'function') {
          count = rows.filter(agg.where).length;
        }
        return {
          id: agg.id || 'c',
          count,
          value: count,
          data: { count },
        };
      });
    }

    // Sorting
    if (this.sortField) {
      const field = this.sortField;
      const desc = this.sortDesc;
      rows.sort((a, b) => {
        const valA = a[field] ?? '';
        const valB = b[field] ?? '';
        if (typeof valA === 'number' && typeof valB === 'number') {
          return desc ? valB - valA : valA - valB;
        }
        return desc
          ? String(valB).localeCompare(String(valA))
          : String(valA).localeCompare(String(valB));
      });
    }

    const total = rows.length;

    // Pagination / limit
    let pagedRows = rows;
    if (this.limitCount != null) {
      pagedRows = rows.slice(0, this.limitCount);
    } else if (this.pageNumber && this.pageSize) {
      const start = (this.pageNumber - 1) * this.pageSize;
      pagedRows = rows.slice(start, start + this.pageSize);
    }

    // Field selection projection
    let data = pagedRows;
    if (this.selectedFields && Array.isArray(this.selectedFields) && this.selectedFields.length > 0) {
      const keys = this.selectedFields.map((f) => (typeof f === 'string' ? f : f.field)).filter(Boolean);
      data = pagedRows.map((row) => {
        const item = { Id: row.Id };
        keys.forEach((k) => {
          item[k] = row[k];
        });
        return item;
      });
    }

    const hasMore = (this.pageNumber * this.pageSize) < total;

    return {
      success: true,
      data,
      total,
      hasMore,
      ...(aggregators ? { aggregators } : {}),
    };
  }

  async create(payload) {
    const table = db.getTable(this.tableName);
    const items = Array.isArray(payload) ? payload : [payload];
    const now = new Date().toISOString();
    const createdRecords = [];

    for (const item of items) {
      if (!item) continue;
      const id = item.Id || (this.tableName.slice(0, 3) + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      const newRecord = {
        ...item,
        Id: id,
        CreatedOn: item.CreatedOn || now,
        ModifiedOn: now,
      };
      table.unshift(newRecord);
      createdRecords.push(newRecord);
    }

    db.notify();
    return {
      success: true,
      data: createdRecords,
      messages: [],
    };
  }

  async update(payload) {
    const table = db.getTable(this.tableName);
    const items = Array.isArray(payload) ? payload : [payload];
    const updatedRecords = [];
    const now = new Date().toISOString();

    for (const item of items) {
      if (!item || !item.Id) continue;
      const index = table.findIndex((r) => String(r.Id) === String(item.Id));
      if (index !== -1) {
        table[index] = {
          ...table[index],
          ...item,
          ModifiedOn: now,
        };
        updatedRecords.push({ ...table[index] });
      }
    }

    db.notify();
    return {
      success: true,
      data: updatedRecords,
      messages: updatedRecords.length ? [] : ['Records not found for update'],
    };
  }

  async remove(idOrIds) {
    const ids = Array.isArray(idOrIds) ? idOrIds.map(String) : [String(idOrIds)];
    const table = db.getTable(this.tableName);
    const filtered = table.filter((r) => !ids.includes(String(r.Id)));
    db.tables[this.tableName] = filtered;
    db.notify();
    return {
      success: true,
      data: ids,
      messages: [],
    };
  }
}

// Session Management
class LocalSession {
  constructor() {
    this.currentUser = this.loadUser();
    this.subscribers = new Set();
    this.initFailed = false;
  }

  loadUser() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = localStorage.getItem(SESSION_KEY);
        if (stored) return JSON.parse(stored);
      }
    } catch {}
    return null;
  }

  saveUser(user) {
    this.currentUser = user;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
        else localStorage.removeItem(SESSION_KEY);
      }
    } catch {}
    this.subscribers.forEach((fn) => fn({ status: user ? 'authenticated' : 'anonymous', user }));
  }

  user() {
    return this.currentUser;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    // Initial emission
    if (this.currentUser) {
      callback({ status: 'authenticated', user: this.currentUser });
    } else {
      callback({ status: 'anonymous', user: null });
    }
    return () => this.subscribers.delete(callback);
  }

  async login({ email, password, profileSlug }) {
    const user = {
      ...DEFAULT_ADMIN_USER,
      emailAddress: email || DEFAULT_ADMIN_USER.emailAddress,
      profile: profileSlug === 'manager' ? 'Manager_c' : 'Admin_c',
    };
    this.saveUser(user);
    return { ok: true, value: user };
  }

  async register({ email, password, profileSlug }) {
    return this.login({ email, password, profileSlug });
  }

  async logout() {
    this.saveUser(null);
    return { ok: true };
  }

  async retry() {
    this.initFailed = false;
    return true;
  }
}

// Storage Helpers
class LocalStorageService {
  validate(file, config = {}) {
    if (!file) return { valid: false, error: 'No file provided' };
    const maxKb = config.maxValue || 10240;
    const fileKb = file.size / 1024;
    if (fileKb > maxKb) {
      return { valid: false, error: `File exceeds maximum allowed size of ${maxKb} KB` };
    }
    if (config.supportedExtensions) {
      const allowed = Array.isArray(config.supportedExtensions)
        ? config.supportedExtensions.map((e) => e.toLowerCase().replace(/^\./, ''))
        : String(config.supportedExtensions).split(',').map((e) => e.trim().toLowerCase().replace(/^\./, ''));
      const ext = file.name?.split('.').pop()?.toLowerCase();
      if (allowed.length && (!ext || !allowed.includes(ext))) {
        return { valid: false, error: `Unsupported file type .${ext}. Allowed: ${allowed.join(', ')}` };
      }
    }
    return { valid: true };
  }

  async upload(file, { onProgress } = {}) {
    onProgress?.(30);
    const id = 'fil-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const url = URL.createObjectURL(file);
    onProgress?.(100);

    return {
      Id: id,
      id,
      Name: file.name,
      name: file.name,
      Size: Math.round(file.size / 1024),
      size: Math.round(file.size / 1024),
      Type: file.type,
      type: file.type,
      url,
    };
  }

  async preview(file) {
    return { url: file.url || (typeof file === 'string' ? file : '') };
  }

  async download(file) {
    return {
      url: file.url || (typeof file === 'string' ? file : ''),
      name: file.Name || file.name || 'download',
    };
  }

  toCreateFormat(files) {
    if (!files) return [];
    if (!Array.isArray(files)) files = [files];
    return files.map((f) => ({
      Id: f.Id || f.id || ('fil-' + Math.random().toString(36).slice(2, 8)),
      Name: f.Name || f.name || 'file',
      name: f.Name || f.name || 'file',
      Size: f.Size || f.size || 0,
      size: f.Size || f.size || 0,
      Type: f.Type || f.type || 'application/octet-stream',
      type: f.Type || f.type || 'application/octet-stream',
      url: f.url || (typeof f === 'string' ? f : ''),
    }));
  }

  getUrl(file) {
    if (!file) return '';
    if (typeof file === 'string') return file;
    return file.url || '';
  }
}

export const localSdk = {
  table: (tableName) => new QueryBuilder(tableName),
  session: new LocalSession(),
  storage: new LocalStorageService(),
  functions: {
    invoke: async (functionName, body) => {
      console.log(`[localSdk] Invoked mock function: ${functionName}`, body);
      return { ok: true, value: { success: true } };
    },
  },
  resetDatabase: () => db.resetAll(),
};
