import React, { useMemo, useState } from 'react';
import { sdk } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { getPeriodRange, todayLocalDate } from '@/services/periods';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import PeriodControls from '@/components/PeriodControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export const route = { path: '/wastage', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'Recycle', label: 'Wastage', section: 'Operations', order: 44 };

const DEFAULT_CATEGORIES = [
  'Runner & Riser Scrap',
  'Defective / Rejection Castings',
  'Slag & Dross',
  'Machining Chips & Borings',
  'Used Foundry Sand',
  'Other Industrial Scrap',
];

const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Other'];

function loadSavedCategories() {
  try {
    const raw = localStorage.getItem('dana_scrap_categories');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_CATEGORIES;
}

const cash = (val) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(val ?? 0));

const kg = (val) =>
  Number(val ?? 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  }) + ' kg';

const roundMoney = (val) => Math.round((Number(val) + Number.EPSILON) * 100) / 100;

export default function WastagePage() {
  const { profile } = useProfile();
  const permissions = getTableAccess(profile, 'wastage_c');

  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' | 'sales' | 'log'
  const [periodType, setPeriodType] = useState('month');
  const [anchorDate, setAnchorDate] = useState(todayLocalDate());
  const range = getPeriodRange(periodType, anchorDate);

  const [search, setSearch] = useState('');
  const [userCategories, setUserCategories] = useState(loadSavedCategories);
  const [newCategoryModalOpen, setNewCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState(null);

  const [logModalOpen, setLogModalOpen] = useState(false);
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [logForm, setLogForm] = useState({
    date_c: todayLocalDate(),
    category_c: DEFAULT_CATEGORIES[0],
    weightKg_c: '',
    source_c: '',
    storageLocation_c: 'Scrap Bay A',
    notes_c: '',
  });

  const [sellForm, setSellForm] = useState({
    date_c: todayLocalDate(),
    category_c: DEFAULT_CATEGORIES[0],
    weightKg_c: '',
    ratePerKg_c: '',
    buyerName_c: '',
    buyerContact_c: '',
    paymentMethod_c: 'Cash',
    notes_c: '',
  });

  const { data: allRecords, loading, error, run: reloadRecords } = useFetch(
    async () => {
      const results = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const res = await sdk.table('wastage_c').select().page(page, 100).fetch();
        if (!res.success) throw new Error(res.message || 'Could not load wastage records');
        results.push(...(res.data ?? []));
        hasMore = Boolean(res.hasMore);
        page += 1;
      }
      return results;
    },
    []
  );

  const records = allRecords ?? [];

  // Merge custom user categories with categories found in past records
  const categories = useMemo(() => {
    const set = new Set(userCategories);
    records.forEach((row) => {
      if (row.category_c && typeof row.category_c === 'string' && row.category_c.trim()) {
        set.add(row.category_c.trim());
      }
    });
    return Array.from(set);
  }, [userCategories, records]);

  // Compute category inventory balances across all historical records
  const categoryBalances = useMemo(() => {
    const map = {};
    categories.forEach((cat) => {
      map[cat] = { generated: 0, sold: 0, balance: 0 };
    });

    records.forEach((row) => {
      const cat = row.category_c || 'Other Industrial Scrap';
      if (!map[cat]) map[cat] = { generated: 0, sold: 0, balance: 0 };
      const weight = Number(row.weightKg_c || 0);
      if (row.recordType_c === 'Sold') {
        map[cat].sold += weight;
      } else {
        map[cat].generated += weight;
      }
    });

    Object.keys(map).forEach((cat) => {
      map[cat].balance = Math.max(0, roundMoney(map[cat].generated - map[cat].sold));
      map[cat].generated = roundMoney(map[cat].generated);
      map[cat].sold = roundMoney(map[cat].sold);
    });

    return map;
  }, [categories, records]);

  // Overall totals
  const overallKPIs = useMemo(() => {
    let totalGenerated = 0;
    let totalSold = 0;
    let totalRevenue = 0;

    records.forEach((row) => {
      const weight = Number(row.weightKg_c || 0);
      if (row.recordType_c === 'Sold') {
        totalSold += weight;
        totalRevenue += Number(row.revenueAmount_c || 0);
      } else {
        totalGenerated += weight;
      }
    });

    const stockInStorage = Math.max(0, roundMoney(totalGenerated - totalSold));

    return {
      totalGenerated: roundMoney(totalGenerated),
      stockInStorage,
      totalSold: roundMoney(totalSold),
      totalRevenue: roundMoney(totalRevenue),
    };
  }, [records]);

  // Period filtered records
  const periodFiltered = useMemo(() => {
    return records.filter((r) => {
      const d = r.date_c || '';
      return d >= range.start && d <= range.end;
    });
  }, [records, range]);

  const salesRecords = useMemo(() => {
    return periodFiltered
      .filter((r) => r.recordType_c === 'Sold')
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          (r.buyerName_c || '').toLowerCase().includes(q) ||
          (r.category_c || '').toLowerCase().includes(q) ||
          (r.notes_c || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(b.date_c).localeCompare(String(a.date_c)));
  }, [periodFiltered, search]);

  const generationRecords = useMemo(() => {
    return periodFiltered
      .filter((r) => r.recordType_c !== 'Sold')
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          (r.source_c || '').toLowerCase().includes(q) ||
          (r.category_c || '').toLowerCase().includes(q) ||
          (r.storageLocation_c || '').toLowerCase().includes(q) ||
          (r.notes_c || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(b.date_c).localeCompare(String(a.date_c)));
  }, [periodFiltered, search]);

  const recentActivity = useMemo(() => {
    return [...records]
      .sort((a, b) => String(b.date_c || b.CreatedOn || '').localeCompare(String(a.date_c || a.CreatedOn || '')))
      .slice(0, 8);
  }, [records]);

  // Category Management Handlers
  function handleAddCategory(e) {
    e?.preventDefault?.();
    const name = newCategoryName.trim();
    if (!name) {
      toast.error('Enter a category name.');
      return;
    }
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      toast.error('A scrap category with this name already exists.');
      return;
    }
    const updated = [...userCategories, name];
    setUserCategories(updated);
    try {
      localStorage.setItem('dana_scrap_categories', JSON.stringify(updated));
    } catch {}
    toast.success(`Scrap category "${name}" added.`);
    setNewCategoryName('');
    setNewCategoryModalOpen(false);
  }

  function confirmDeleteCategory() {
    if (!categoryToDelete) return;
    const cat = categoryToDelete;
    const updated = userCategories.filter((c) => c !== cat);
    setUserCategories(updated);
    try {
      localStorage.setItem('dana_scrap_categories', JSON.stringify(updated));
    } catch {}
    toast.success(`Category "${cat}" removed from active categories.`);
    setCategoryToDelete(null);
  }

  // Edit / Add Modal Handlers
  function openAddLog(category = null) {
    setEditingRecord(null);
    setLogForm({
      date_c: todayLocalDate(),
      category_c: category || categories[0] || 'Runner & Riser Scrap',
      weightKg_c: '',
      source_c: '',
      storageLocation_c: 'Scrap Bay A',
      notes_c: '',
    });
    setLogModalOpen(true);
  }

  function openEditLog(record) {
    setEditingRecord(record);
    setLogForm({
      date_c: record.date_c || todayLocalDate(),
      category_c: record.category_c || categories[0],
      weightKg_c: String(record.weightKg_c ?? ''),
      source_c: record.source_c || '',
      storageLocation_c: record.storageLocation_c || '',
      notes_c: record.notes_c || '',
    });
    setLogModalOpen(true);
  }

  function openQuickSell(category) {
    setEditingRecord(null);
    const bal = categoryBalances[category]?.balance ?? 0;
    setSellForm({
      date_c: todayLocalDate(),
      category_c: category,
      weightKg_c: bal > 0 ? String(bal) : '',
      ratePerKg_c: '',
      buyerName_c: '',
      buyerContact_c: '',
      paymentMethod_c: 'Cash',
      notes_c: '',
    });
    setSellModalOpen(true);
  }

  function openEditSale(sale) {
    setEditingRecord(sale);
    setSellForm({
      date_c: sale.date_c || todayLocalDate(),
      category_c: sale.category_c || categories[0],
      weightKg_c: String(sale.weightKg_c ?? ''),
      ratePerKg_c: String(sale.ratePerKg_c ?? ''),
      buyerName_c: sale.buyerName_c || '',
      buyerContact_c: sale.buyerContact_c || '',
      paymentMethod_c: sale.paymentMethod_c || 'Cash',
      notes_c: sale.notes_c || '',
    });
    setSellModalOpen(true);
  }

  // Submit Log Waste
  async function handleLogWaste(e) {
    e.preventDefault();
    if (submitting) return;
    const weight = Number(logForm.weightKg_c);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('Enter a valid weight in kg.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        Name: `${logForm.category_c} · ${weight} kg`,
        recordType_c: 'Generated',
        date_c: logForm.date_c,
        category_c: logForm.category_c,
        weightKg_c: weight,
        source_c: logForm.source_c.trim() || 'Foundry Production',
        storageLocation_c: logForm.storageLocation_c.trim() || 'Scrap Yard',
        notes_c: logForm.notes_c.trim(),
      };

      if (editingRecord) {
        const res = await sdk.table('wastage_c').update({ Id: editingRecord.Id, ...payload });
        if (res.messages?.length) throw new Error(res.messages[0]);
        toast.success(`Scrap entry updated (${weight} kg of ${logForm.category_c}).`);
      } else {
        const res = await sdk.table('wastage_c').create(payload);
        if (!res.data?.length) throw new Error(res.messages?.[0] || 'Could not log waste record.');
        toast.success(`${weight} kg of ${logForm.category_c} recorded in storage.`);
      }

      setLogModalOpen(false);
      setEditingRecord(null);
      setLogForm({
        date_c: todayLocalDate(),
        category_c: categories[0] || 'Runner & Riser Scrap',
        weightKg_c: '',
        source_c: '',
        storageLocation_c: 'Scrap Bay A',
        notes_c: '',
      });
      reloadRecords();
    } catch (err) {
      toast.error('Failed to save waste record.', { description: err.message ?? String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  // Submit Scrap Sale
  async function handleSellScrap(e) {
    e.preventDefault();
    if (submitting) return;
    const weight = Number(sellForm.weightKg_c);
    const rate = Number(sellForm.ratePerKg_c);
    // When editing an existing sale, credit back its current weight to avoid false stock validation failure
    const currentSoldWeight = editingRecord && editingRecord.recordType_c === 'Sold'
      ? Number(editingRecord.weightKg_c || 0)
      : 0;
    const available = (categoryBalances[sellForm.category_c]?.balance ?? 0) + currentSoldWeight;

    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('Enter a valid weight to sell.');
      return;
    }
    if (weight > available) {
      toast.error(`Cannot sell ${weight} kg. Only ${available} kg available in storage.`);
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Enter a valid rate per kg.');
      return;
    }
    if (!sellForm.buyerName_c.trim()) {
      toast.error('Enter the buyer or scrap dealer name.');
      return;
    }

    const revenue = roundMoney(weight * rate);
    setSubmitting(true);
    try {
      const payload = {
        Name: `Scrap Sale · ${sellForm.category_c} · ${weight} kg`,
        recordType_c: 'Sold',
        date_c: sellForm.date_c,
        category_c: sellForm.category_c,
        weightKg_c: weight,
        ratePerKg_c: rate,
        revenueAmount_c: revenue,
        buyerName_c: sellForm.buyerName_c.trim(),
        buyerContact_c: sellForm.buyerContact_c.trim(),
        paymentMethod_c: sellForm.paymentMethod_c,
        notes_c: sellForm.notes_c.trim(),
      };

      if (editingRecord) {
        const res = await sdk.table('wastage_c').update({ Id: editingRecord.Id, ...payload });
        if (res.messages?.length) throw new Error(res.messages[0]);
        toast.success(`Scrap sale updated (${cash(revenue)}).`);
      } else {
        const res = await sdk.table('wastage_c').create(payload);
        if (!res.data?.length) throw new Error(res.messages?.[0] || 'Could not record scrap sale.');
        toast.success(`Scrap sale recorded! Revenue of ${cash(revenue)} credited.`);
      }

      setSellModalOpen(false);
      setEditingRecord(null);
      setSellForm({
        date_c: todayLocalDate(),
        category_c: categories[0] || 'Runner & Riser Scrap',
        weightKg_c: '',
        ratePerKg_c: '',
        buyerName_c: '',
        buyerContact_c: '',
        paymentMethod_c: 'Cash',
        notes_c: '',
      });
      reloadRecords();
    } catch (err) {
      toast.error('Failed to record scrap sale.', { description: err.message ?? String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  // Delete Record Handler
  async function handleDeleteRecord() {
    if (!pendingDelete || submitting) return;
    setSubmitting(true);
    try {
      const res = await sdk.table('wastage_c').remove(pendingDelete.Id);
      if (res.messages?.length) throw new Error(res.messages[0]);
      toast.success('Wastage record deleted. Stock balance updated.');
      setPendingDelete(null);
      reloadRecords();
    } catch (err) {
      toast.error('Could not delete record.', { description: err.message ?? String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Operations / Industrial Waste</p>
          <h1 className="font-heading text-3xl font-semibold">Wastage & Scrap Management</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Track industrial production scrap, categorized storage stock, and monetize scrap sales as company revenue.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 rounded-sm"
            onClick={() => setNewCategoryModalOpen(true)}
          >
            <ApperIcon name="Tag" size={16} />
            + Add Category
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 rounded-sm"
            onClick={() => openAddLog()}
          >
            <ApperIcon name="PlusCircle" size={16} />
            Log Waste Produced
          </Button>
          <Button
            type="button"
            className="gap-1.5 rounded-sm bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => openQuickSell(categories[0])}
          >
            <ApperIcon name="Banknote" size={16} />
            Sell Scrap (Revenue)
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Total Waste Generated</p>
          <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{kg(overallKPIs.totalGenerated)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Cumulative industrial waste recorded</p>
        </div>
        <div className="border border-border bg-card p-4">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Current Stock in Storage</p>
          <p className="mt-2 font-heading text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {kg(overallKPIs.stockInStorage)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Available to sell or recycle</p>
        </div>
        <div className="border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Total Scrap Sold</p>
          <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{kg(overallKPIs.totalSold)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Dispatched to scrap buyers</p>
        </div>
        <div className="border border-border bg-card p-4">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Total Scrap Revenue</p>
          <p className="mt-2 font-heading text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {cash(overallKPIs.totalRevenue)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Earned from waste monetization</p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            activeTab === 'inventory'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ApperIcon name="Boxes" size={16} />
          Scrap Inventory & Storage
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sales')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            activeTab === 'sales'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ApperIcon name="ReceiptIndianRupee" size={16} />
          Scrap Sales & Revenue
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('log')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            activeTab === 'log'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ApperIcon name="ClipboardList" size={16} />
          Generation Log
        </button>
      </div>

      {/* TAB 1: Inventory Stock by Category */}
      {activeTab === 'inventory' && (
        <section className="space-y-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-base font-semibold">Categorized Scrap Storage Stock</h2>
              <p className="text-xs text-muted-foreground">Manage scrap categories, check live stock balances, and sell scrap.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 self-start rounded-sm sm:self-auto"
              onClick={() => setNewCategoryModalOpen(true)}
            >
              <ApperIcon name="Plus" size={15} />
              Add Scrap Category
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => {
              const info = categoryBalances[category] || { generated: 0, sold: 0, balance: 0 };
              const hasStock = info.balance > 0;
              return (
                <div key={category} className="flex flex-col justify-between rounded-sm border border-border bg-card p-5">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground">{category}</h3>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold ${
                            hasStock
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {hasStock ? 'In Stock' : 'Empty'}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-sm text-muted-foreground hover:text-destructive"
                          title={`Delete category: ${category}`}
                          onClick={() => setCategoryToDelete(category)}
                        >
                          <ApperIcon name="Trash2" size={13} />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Available in Storage:</span>
                        <span className="font-heading text-base font-bold tabular-nums text-foreground">
                          {kg(info.balance)}
                        </span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Total Generated:</span>
                        <span className="tabular-nums">{kg(info.generated)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Total Monetized / Sold:</span>
                        <span className="tabular-nums">{kg(info.sold)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex gap-2 border-t border-border pt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1 rounded-sm text-xs"
                      onClick={() => openAddLog(category)}
                    >
                      <ApperIcon name="Plus" size={13} className="mr-1" />
                      Log Waste
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={hasStock ? 'default' : 'outline'}
                      className="flex-1 rounded-sm text-xs"
                      onClick={() => openQuickSell(category)}
                      disabled={!hasStock}
                    >
                      <ApperIcon name="Banknote" size={13} className="mr-1" />
                      Sell Scrap
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent Operations Activity Table with Edit & Delete */}
          <section className="overflow-hidden border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">Recent Scrap Activity & Operations</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Quickly edit or delete recent scrap entries added by mistake.</p>
              </div>
              <span className="text-xs text-muted-foreground">{recentActivity.length} recent entries</span>
            </div>

            {loading ? (
              <div className="space-y-3 p-5"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : recentActivity.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No recent scrap operations.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3 text-right">Weight (kg)</th>
                      <th className="px-4 py-3">Details</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentActivity.map((row) => {
                      const isSold = row.recordType_c === 'Sold';
                      return (
                        <tr key={row.Id} className="hover:bg-muted/30">
                          <td className="whitespace-nowrap px-4 py-3">{formatLocalDate(row.date_c, DATE_FORMATS.SHORT)}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-semibold ${
                                isSold
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {isSold ? 'Sold' : 'Generated'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium">{row.category_c}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold">{kg(row.weightKg_c)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {isSold
                              ? `Buyer: ${row.buyerName_c || 'Dealer'} · Revenue: ${cash(row.revenueAmount_c)}`
                              : `Source: ${row.source_c || 'Foundry'} · Loc: ${row.storageLocation_c || 'Yard'}`}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0 text-muted-foreground hover:text-foreground"
                              title="Edit this scrap entry"
                              onClick={() => (isSold ? openEditSale(row) : openEditLog(row))}
                            >
                              <ApperIcon name="Pencil" size={14} />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0 text-destructive hover:text-destructive"
                              title="Delete this scrap entry"
                              onClick={() => setPendingDelete(row)}
                            >
                              <ApperIcon name="Trash2" size={14} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      )}

      {/* TAB 2 & 3: Period Controls & Filters */}
      {(activeTab === 'sales' || activeTab === 'log') && (
        <div className="space-y-4">
          <PeriodControls
            type={periodType}
            onTypeChange={setPeriodType}
            anchorDate={anchorDate}
            onAnchorDateChange={setAnchorDate}
          />

          <div className="relative max-w-lg">
            <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search records, categories, buyers, notes…"
              className="min-h-10 rounded-sm pl-9"
            />
          </div>
        </div>
      )}

      {/* TAB 2: Sales Records */}
      {activeTab === 'sales' && (
        <section className="overflow-hidden border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Scrap Monetization Register ({range.label})</h2>
            <span className="text-xs text-muted-foreground">{salesRecords.length} sales</span>
          </div>

          {loading ? (
            <div className="space-y-3 p-5"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : salesRecords.length === 0 ? (
            <div className="p-10 text-center">
              <ApperIcon name="Banknote" size={28} className="mx-auto text-muted-foreground" />
              <p className="mt-3 font-semibold">No scrap sales recorded for this period</p>
              <p className="mt-1 text-sm text-muted-foreground">Sell accumulated scrap to add revenue.</p>
              <Button className="mt-4 rounded-sm" onClick={() => openQuickSell(categories[0])}>
                Sell Scrap Now
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Buyer / Dealer</th>
                    <th className="px-4 py-3 text-right">Qty (kg)</th>
                    <th className="px-4 py-3 text-right">Rate / kg</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {salesRecords.map((sale) => (
                    <tr key={sale.Id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3">{formatLocalDate(sale.date_c, DATE_FORMATS.SHORT)}</td>
                      <td className="px-4 py-3 font-medium">{sale.category_c}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{sale.buyerName_c || 'Scrap Buyer'}</p>
                        {sale.buyerContact_c && <p className="text-xs text-muted-foreground">{sale.buyerContact_c}</p>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{kg(sale.weightKg_c)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{cash(sale.ratePerKg_c)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                        {cash(sale.revenueAmount_c)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-sm bg-muted px-2 py-0.5 text-xs font-medium">
                          {sale.paymentMethod_c || 'Cash'}
                        </span>
                      </td>
                      <td className="max-w-44 px-4 py-3 text-muted-foreground">{sale.notes_c || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0 text-muted-foreground hover:text-foreground"
                          title="Edit this scrap sale"
                          onClick={() => openEditSale(sale)}
                        >
                          <ApperIcon name="Pencil" size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0 text-destructive hover:text-destructive"
                          title="Delete this scrap sale"
                          onClick={() => setPendingDelete(sale)}
                        >
                          <ApperIcon name="Trash2" size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: Generation Log */}
      {activeTab === 'log' && (
        <section className="overflow-hidden border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Waste Generation Log ({range.label})</h2>
            <span className="text-xs text-muted-foreground">{generationRecords.length} records</span>
          </div>

          {loading ? (
            <div className="space-y-3 p-5"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : generationRecords.length === 0 ? (
            <div className="p-10 text-center">
              <ApperIcon name="Boxes" size={28} className="mx-auto text-muted-foreground" />
              <p className="mt-3 font-semibold">No waste production logged for this period</p>
              <p className="mt-1 text-sm text-muted-foreground">Log waste produced in furnaces or casting batches.</p>
              <Button className="mt-4 rounded-sm" onClick={() => openAddLog()}>
                Log Waste Produced
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[750px] text-left text-sm">
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Weight (kg)</th>
                    <th className="px-4 py-3">Source Process</th>
                    <th className="px-4 py-3">Storage Location</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {generationRecords.map((rec) => (
                    <tr key={rec.Id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3">{formatLocalDate(rec.date_c, DATE_FORMATS.SHORT)}</td>
                      <td className="px-4 py-3 font-medium">{rec.category_c}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{kg(rec.weightKg_c)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{rec.source_c || 'Production'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{rec.storageLocation_c || 'Scrap Yard'}</td>
                      <td className="max-w-44 px-4 py-3 text-muted-foreground">{rec.notes_c || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0 text-muted-foreground hover:text-foreground"
                          title="Edit this waste record"
                          onClick={() => openEditLog(rec)}
                        >
                          <ApperIcon name="Pencil" size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0 text-destructive hover:text-destructive"
                          title="Delete this waste record"
                          onClick={() => setPendingDelete(rec)}
                        >
                          <ApperIcon name="Trash2" size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Modal: Add Category */}
      <Dialog open={newCategoryModalOpen} onOpenChange={setNewCategoryModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Scrap Category</DialogTitle>
            <DialogDescription>
              Create a custom scrap category for tracking foundry waste.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddCategory} className="space-y-4 py-2">
            <div>
              <label htmlFor="cat-name" className="mb-1 block text-sm font-medium">Category Name *</label>
              <Input
                id="cat-name"
                placeholder="e.g. Copper Slag, Iron Turnings"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                autoFocus
                required
                className="rounded-sm"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setNewCategoryModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                Add Category
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Delete Category Confirmation */}
      <AlertDialog open={Boolean(categoryToDelete)} onOpenChange={(open) => { if (!open) setCategoryToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scrap Category?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>"{categoryToDelete}"</strong> from the category catalog?
              {categoryBalances[categoryToDelete]?.balance > 0 && (
                <span className="mt-2 block font-semibold text-amber-600 dark:text-amber-400">
                  Note: This category currently has {kg(categoryBalances[categoryToDelete]?.balance)} of stock in storage.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteCategory}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: Log Waste Generated (Add / Edit) */}
      <Dialog open={logModalOpen} onOpenChange={setLogModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRecord ? 'Edit Waste Record' : 'Log Waste Produced'}</DialogTitle>
            <DialogDescription>
              {editingRecord
                ? 'Update previously logged production waste details and correct values.'
                : 'Record scrap or production waste and add it to company storage stock.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleLogWaste} className="space-y-4 py-2">
            <div>
              <label htmlFor="log-date" className="mb-1 block text-sm font-medium">Date *</label>
              <Input
                id="log-date"
                type="date"
                value={logForm.date_c}
                onChange={(e) => setLogForm((c) => ({ ...c, date_c: e.target.value }))}
                required
                className="rounded-sm"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="log-category" className="block text-sm font-medium">Scrap Category *</label>
                <button
                  type="button"
                  className="text-xs font-semibold text-primary hover:underline"
                  onClick={() => setNewCategoryModalOpen(true)}
                >
                  + New Category
                </button>
              </div>
              <select
                id="log-category"
                value={logForm.category_c}
                onChange={(e) => setLogForm((c) => ({ ...c, category_c: e.target.value }))}
                className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="log-weight" className="mb-1 block text-sm font-medium">Weight Produced (kg) *</label>
              <Input
                id="log-weight"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="e.g. 250"
                value={logForm.weightKg_c}
                onChange={(e) => setLogForm((c) => ({ ...c, weightKg_c: e.target.value }))}
                required
                className="rounded-sm"
              />
            </div>

            <div>
              <label htmlFor="log-source" className="mb-1 block text-sm font-medium">Process / Source</label>
              <Input
                id="log-source"
                placeholder="e.g. Furnace Melt #10, Casting Mold Shakeout"
                value={logForm.source_c}
                onChange={(e) => setLogForm((c) => ({ ...c, source_c: e.target.value }))}
                className="rounded-sm"
              />
            </div>

            <div>
              <label htmlFor="log-storage" className="mb-1 block text-sm font-medium">Storage Location</label>
              <Input
                id="log-storage"
                placeholder="e.g. Scrap Bay A, Bin 3"
                value={logForm.storageLocation_c}
                onChange={(e) => setLogForm((c) => ({ ...c, storageLocation_c: e.target.value }))}
                className="rounded-sm"
              />
            </div>

            <div>
              <label htmlFor="log-notes" className="mb-1 block text-sm font-medium">Notes (optional)</label>
              <Textarea
                id="log-notes"
                placeholder="Details about scrap quality or cause..."
                value={logForm.notes_c}
                onChange={(e) => setLogForm((c) => ({ ...c, notes_c: e.target.value }))}
                rows={2}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setLogModalOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : editingRecord ? 'Update Waste Record' : 'Save to Storage'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Sell Scrap (Add / Edit) */}
      <Dialog open={sellModalOpen} onOpenChange={setSellModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRecord ? 'Edit Scrap Sale' : 'Sell Scrap & Monetize Waste'}</DialogTitle>
            <DialogDescription>
              {editingRecord
                ? 'Update previously recorded scrap sale details and revenue values.'
                : 'Sell stored scrap to a recycler or scrap dealer. Revenue will count towards company financial earnings.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSellScrap} className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="sell-date" className="mb-1 block text-sm font-medium">Date of Sale *</label>
                <Input
                  id="sell-date"
                  type="date"
                  value={sellForm.date_c}
                  onChange={(e) => setSellForm((c) => ({ ...c, date_c: e.target.value }))}
                  required
                  className="rounded-sm"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="sell-category" className="block text-sm font-medium">Scrap Category *</label>
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline"
                    onClick={() => setNewCategoryModalOpen(true)}
                  >
                    + New
                  </button>
                </div>
                <select
                  id="sell-category"
                  value={sellForm.category_c}
                  onChange={(e) => setSellForm((c) => ({ ...c, category_c: e.target.value }))}
                  className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"
                >
                  {categories.map((cat) => {
                    const bal = categoryBalances[cat]?.balance ?? 0;
                    return (
                      <option key={cat} value={cat}>
                        {cat} ({bal} kg in stock)
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="sell-weight" className="mb-1 block text-sm font-medium">
                  Weight to Sell (kg) *
                </label>
                <Input
                  id="sell-weight"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="kg"
                  value={sellForm.weightKg_c}
                  onChange={(e) => setSellForm((c) => ({ ...c, weightKg_c: e.target.value }))}
                  required
                  className="rounded-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Available in stock: <strong>{categoryBalances[sellForm.category_c]?.balance ?? 0} kg</strong>
                </p>
              </div>

              <div>
                <label htmlFor="sell-rate" className="mb-1 block text-sm font-medium">Rate per kg (₹) *</label>
                <Input
                  id="sell-rate"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 35.00"
                  value={sellForm.ratePerKg_c}
                  onChange={(e) => setSellForm((c) => ({ ...c, ratePerKg_c: e.target.value }))}
                  required
                  className="rounded-sm"
                />
              </div>
            </div>

            {/* Calculated Sale Revenue Card */}
            <div className="rounded-sm border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Scrap Revenue
                </span>
                <span className="font-heading text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {cash(roundMoney(Number(sellForm.weightKg_c || 0) * Number(sellForm.ratePerKg_c || 0)))}
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="sell-buyer" className="mb-1 block text-sm font-medium">Buyer / Scrap Trader *</label>
                <Input
                  id="sell-buyer"
                  placeholder="e.g. Gupta Metal Traders"
                  value={sellForm.buyerName_c}
                  onChange={(e) => setSellForm((c) => ({ ...c, buyerName_c: e.target.value }))}
                  required
                  className="rounded-sm"
                />
              </div>

              <div>
                <label htmlFor="sell-contact" className="mb-1 block text-sm font-medium">Buyer Contact</label>
                <Input
                  id="sell-contact"
                  placeholder="e.g. +91 98220 55443"
                  value={sellForm.buyerContact_c}
                  onChange={(e) => setSellForm((c) => ({ ...c, buyerContact_c: e.target.value }))}
                  className="rounded-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sell-payment" className="mb-1 block text-sm font-medium">Payment Received Via</label>
              <select
                id="sell-payment"
                value={sellForm.paymentMethod_c}
                onChange={(e) => setSellForm((c) => ({ ...c, paymentMethod_c: e.target.value }))}
                className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="sell-notes" className="mb-1 block text-sm font-medium">Notes (optional)</label>
              <Textarea
                id="sell-notes"
                placeholder="Optional delivery or vehicle number notes..."
                value={sellForm.notes_c}
                onChange={(e) => setSellForm((c) => ({ ...c, notes_c: e.target.value }))}
                rows={2}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setSellModalOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {submitting ? 'Saving…' : editingRecord ? 'Update Scrap Sale' : 'Record Sale & Collect Revenue'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open && !submitting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this wastage entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.Name || 'This entry'} will be permanently removed. Live scrap storage balances will be automatically adjusted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteRecord(); }}
              disabled={submitting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {submitting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
