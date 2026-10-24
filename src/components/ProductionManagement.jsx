import { useState } from 'react';
import { sdk, eq } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { getStockItems, getRawMaterialLedger } from '@/services/purchaseWorkflow';
import {
  createProductionRecord,
  deleteProductionRecord,
  getProducedStockBalances,
  getProductionConsumption,
  updateProductionRecord,
} from '@/services/productionWorkflow';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
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
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';

const TABLE = 'production_c';
const FIELDS = ['Name', 'productionDate_c', 'productName_c', 'rawMaterialKg_c', 'producedKg_c', 'notes_c'];

function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const kg = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('en-IN')} kg`);

const emptyForm = () => ({
  productionDate: localToday(),
  productName: '',
  stockItemId: '',
  producedKg: '',
  notes: '',
});

async function loadRawOptions() {
  const [items, ledger] = await Promise.all([getStockItems(), getRawMaterialLedger()]);
  const balances = new Map(ledger.items.map((entry) => [entry.id, entry.balance]));
  return items.map((item) => ({
    id: String(item.Id),
    name: item.Name,
    balance: balances.get(String(item.Id)) ?? 0,
  }));
}

export default function ProductionManagement() {
  const { profile } = useProfile();
  const permission = getTableAccess(profile, TABLE);

  const [filterDate, setFilterDate] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const canManage = permission.canUpdate || permission.canDelete;

  const { data, loading, error, run } = useFetch(() => {
    let q = sdk.table(TABLE).select(FIELDS);
    if (filterDate) q = q.where(eq('productionDate_c', filterDate));
    return q.orderByDesc('productionDate_c').page(1, 100).fetch().then((r) => {
      if (!r.success) throw new Error(r.message || 'Unable to load production records');
      return r.data ?? [];
    });
  }, [filterDate]);

  const { data: rawOptions, run: refreshRaw } = useFetch(() => loadRawOptions(), []);
  const { data: producedStock, loading: stockLoading, error: stockError, run: refreshStock } = useFetch(
    () => getProducedStockBalances(),
    []
  );
  const rows = data ?? [];
  const totalRaw = rows.reduce((sum, r) => sum + Number(r.rawMaterialKg_c ?? 0), 0);
  const totalProduced = rows.reduce((sum, r) => sum + Number(r.producedKg_c ?? 0), 0);

  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));

  async function openDialog(record = null) {
    setEditing(record);
    setIdempotencyKey(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (!record) {
      setForm(emptyForm());
      setOpen(true);
      return;
    }
    setForm({
      productionDate: record.productionDate_c || localToday(),
      productName: record.productName_c ?? '',
      stockItemId: '',
      producedKg: String(record.producedKg_c ?? ''),
      notes: record.notes_c ?? '',
    });
    setOpen(true);
    try {
      const consumption = await getProductionConsumption(record.Id);
      if (consumption) set('stockItemId', consumption.stockItemId);
    } catch (err) {
      toast.error('Could not load the raw material for this record', { description: err.message ?? String(err) });
    }
  }

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    const productName = form.productName.trim();
    const producedKg = Number(form.producedKg);
    if (!productName) {
      toast.error('Enter the product name.');
      return;
    }
    if (form.producedKg === '' || producedKg < 0) {
      toast.error('Enter valid kg quantities.');
      return;
    }
    setSaving(true);
    try {
      const input = {
        productionDate_c: form.productionDate,
        productName_c: productName,
        rawMaterialKg_c: producedKg,
        producedKg_c: producedKg,
        notes_c: form.notes.trim(),
        stockItem_c: form.stockItemId,
      };
      if (editing) {
        await updateProductionRecord(editing, input);
        toast.success('Production record updated. Stock balances updated.');
      } else {
        await createProductionRecord(input, idempotencyKey);
        toast.success('Production record saved. Stock balances updated.');
      }
      setOpen(false);
      setEditing(null);
      run();
      refreshStock();
      refreshRaw();
    } catch (err) {
      toast.error('Could not save production record', { description: err.message ?? String(err) });
      console.error(`production_c create threw: ${err.message ?? String(err)}`);
      run();
      refreshStock();
      refreshRaw();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteProductionRecord(pendingDelete);
      toast.success('Production record deleted. Stock balances updated.');
      setPendingDelete(null);
      run();
      refreshStock();
      refreshRaw();
    } catch (err) {
      toast.error('Could not delete production record', { description: err.message ?? String(err) });
      console.error(`production_c delete threw: ${err.message ?? String(err)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Operations / Records</p>
          <h1 className="font-heading text-3xl font-semibold">Production</h1>
          <p className="mt-2 text-sm text-muted-foreground">Record daily manufacturing activity and review it by date.</p>
        </div>
        {permission.canCreate && (
          <Button className="rounded-sm" onClick={() => openDialog()}>
            <ApperIcon name="Plus" size={16} /> Add production
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <label htmlFor="production-filter-date" className="text-sm font-medium">Date</label>
          <Input
            id="production-filter-date"
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="w-auto rounded-sm"
          />
        </div>
        {filterDate && (
          <Button variant="ghost" size="sm" className="rounded-sm" onClick={() => setFilterDate('')}>
            Show all dates
          </Button>
        )}
      </div>

      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <div className="flex justify-between border-b border-border px-4 py-3">
          <b className="text-sm">In-Hand Production/Stock</b>
          <span className="text-xs text-muted-foreground">Produced minus sold, by product</span>
        </div>
        {stockLoading && !producedStock ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : stockError ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Could not load produced stock.</p>
        ) : !producedStock?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No produced stock yet. Recorded production appears here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Product</th>
                  <th className="px-4 py-3 text-right font-semibold">Produced</th>
                  <th className="px-4 py-3 text-right font-semibold">Sold</th>
                  <th className="px-4 py-3 text-right font-semibold">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {producedStock.map((item) => (
                  <tr key={item.key} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3">{item.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{kg(item.produced)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{kg(item.sold)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{kg(item.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <div className="flex justify-between border-b border-border px-4 py-3">
          <b className="text-sm">Production register</b>
          <span className="text-xs text-muted-foreground">{loading && !data ? 'Loading…' : `${rows.length} records`}</span>
        </div>

        {loading && !data ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="font-medium">Could not load records</p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            <Button variant="outline" className="mt-3 rounded-sm" onClick={() => run()}>Retry</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <ApperIcon name="Factory" size={28} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-semibold">No production records{filterDate ? ' for this date' : ' yet'}</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a production record to start tracking output.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Product</th>
                  <th className="px-4 py-3 text-right font-semibold">Raw material used</th>
                  <th className="px-4 py-3 text-right font-semibold">Quantity produced</th>
                  <th className="px-4 py-3 font-semibold">Notes</th>
                  {canManage && <th className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.Id} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3">{row.productionDate_c ? formatLocalDate(row.productionDate_c, DATE_FORMATS.SHORT) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3">{row.productName_c || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{kg(row.rawMaterialKg_c)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{kg(row.producedKg_c)}</td>
                    <td className="max-w-xs px-4 py-3">
                      <span className="line-clamp-2 break-words text-muted-foreground">{row.notes_c || '—'}</span>
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {permission.canUpdate && (
                          <Button type="button" variant="ghost" size="sm" className="rounded-sm" aria-label="Edit production record" onClick={() => openDialog(row)}>
                            <ApperIcon name="Pencil" size={15} />
                          </Button>
                        )}
                        {permission.canDelete && (
                          <Button type="button" variant="ghost" size="sm" className="rounded-sm text-destructive hover:text-destructive" aria-label="Delete production record" onClick={() => setPendingDelete(row)}>
                            <ApperIcon name="Trash2" size={15} />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/40 text-sm font-semibold">
                <tr>
                  <td className="px-4 py-3" colSpan={2}>Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{kg(totalRaw)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{kg(totalProduced)}</td>
                  <td className="px-4 py-3" />
                  {canManage && <td className="px-4 py-3" />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(next) => { if (!next && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this production record?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.productName_c || 'This record'} will be removed. Its raw material is returned to stock and its produced quantity is taken out of stock. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="rounded-sm bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit production record' : 'Add production record'}</DialogTitle>
            <DialogDescription>Enter the day's manufacturing activity.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="production-date" className="block text-sm font-medium">Production date *</label>
                <Input id="production-date" type="date" required value={form.productionDate} onChange={(e) => set('productionDate', e.target.value)} className="rounded-sm" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="production-product" className="block text-sm font-medium">Product name *</label>
                <Input id="production-product" required value={form.productName} onChange={(e) => set('productName', e.target.value)} placeholder="Enter product name" className="rounded-sm" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="production-raw-item" className="block text-sm font-medium">Raw material *</label>
                <select
                  id="production-raw-item"
                  required
                  value={form.stockItemId}
                  onChange={(e) => set('stockItemId', e.target.value)}
                  className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Choose raw material</option>
                  {(rawOptions ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.name} ({kg(item.balance)} available)</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="production-produced" className="block text-sm font-medium">Quantity produced (kg) *</label>
                <Input id="production-produced" type="number" min="0" step="0.01" required value={form.producedKg} onChange={(e) => set('producedKg', e.target.value)} placeholder="0" className="rounded-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="production-notes" className="block text-sm font-medium">Notes</label>
              <Textarea id="production-notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Add details (optional)" />
            </div>
            <DialogFooter className="gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="rounded-sm" disabled={saving}>{saving ? 'Saving…' : 'Save record'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}