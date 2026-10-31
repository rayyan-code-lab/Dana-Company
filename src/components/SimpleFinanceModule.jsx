import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { sdk, contains, or, gte, lt, eq } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { getPeriodRange, todayLocalDate } from '@/services/periods';
import { getProducedStockBalances, normalizeProductName, recordSale, updateSale } from '@/services/productionWorkflow';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import FilePicker from '@/components/FilePicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import PeriodControls from '@/components/PeriodControls';
import CustomerInvoiceModal from '@/components/CustomerInvoiceModal';

const cash = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value ?? 0));

function generateSalesId() {
  const stamp = todayLocalDate().replaceAll('-', '');
  const token = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 9)).toUpperCase();
  return 'SAL-' + stamp + '-' + token;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const MODULES = {
  sales: {
    title: 'Sales',
    table: 'sales_c',
    path: '/sales',
    singular: 'sale',
    icon: 'TrendingUp',
    amountKey: 'amount_c',
    dateKey: 'saleDate_c',
    counterpartyKey: 'customerName_c',
    searchFields: ['saleId_c', 'Name', 'customerName_c', 'notes_c'],
    selectFields: ['Name', 'saleId_c', 'saleDate_c', 'customerName_c', 'customerContact_c', 'productName_c', 'amount_c', 'paidAmount_c', 'balanceDue_c', 'paymentStatus_c', 'paymentMethod_c', 'weightKg_c', 'unitPrice_c', 'notes_c'],
    fields: [
      { key: 'saleDate_c', label: 'Date', type: 'Date', required: true },
      { key: 'customerName_c', label: 'Customer', type: 'Text', placeholder: 'Customer or company name' },
      { key: 'customerContact_c', label: 'Customer contact number', type: 'Text', placeholder: 'e.g. +91 98765 43210' },
      { key: 'productName_c', label: 'Product', type: 'ProducedProduct', required: true },
      { key: 'weightKg_c', label: 'Quantity (kg)', type: 'Decimal', required: true, placeholder: 'e.g. 125.00' },
      { key: 'unitPrice_c', label: 'Rate per kg (₹)', type: 'Decimal', required: true, placeholder: 'e.g. 80.50' },
      { key: 'paymentMethod_c', label: 'Payment method', type: 'Picklist', required: true, values: ['Cash', 'UPI', 'Bank Transfer', 'Other'] },
      { key: 'notes_c', label: 'Notes', type: 'MultilineText', placeholder: 'Optional details' },
    ],
    columns: [
      ['saleId_c', 'Sales ID'],
      ['saleDate_c', 'Date'],
      ['customerName_c', 'Customer'],
      ['productName_c', 'Product'],
      ['weightKg_c', 'Qty (kg)'],
      ['unitPrice_c', 'Rate / kg'],
      ['amount_c', 'Total'],
      ['paidAmount_c', 'Paid'],
      ['balanceDue_c', 'Pending'],
      ['paymentStatus_c', 'Status'],
      ['paymentMethod_c', 'Paid via'],
    ],
  },
  expenses: {
    title: 'Expenses',
    table: 'expenses_c',
    path: '/expenses',
    singular: 'expense',
    icon: 'ReceiptIndianRupee',
    amountKey: 'amount_c',
    dateKey: 'expenseDate_c',
    counterpartyKey: null,
    searchFields: ['Name', 'notes_c'],
    selectFields: ['Name', 'expenseDate_c', 'amount_c', 'paymentMethod_c', 'notes_c', 'attachments_c'],
    fields: [
      { key: 'Name', label: 'Expense description', type: 'Text', required: true, placeholder: 'e.g. Workshop electricity' },
      { key: 'expenseDate_c', label: 'Date', type: 'Date', required: true },
      { key: 'amount_c', label: 'Amount (₹)', type: 'Decimal', required: true, placeholder: '0.00' },
      { key: 'paymentMethod_c', label: 'Payment method', type: 'Picklist', required: true, values: ['Cash', 'UPI', 'Bank Transfer', 'Other'] },
      { key: 'notes_c', label: 'Notes', type: 'MultilineText', placeholder: 'Optional details' },
      { key: 'attachments_c', label: 'Receipt or expense photo', type: 'Files', supportMultipleValues: false, supportedExtensions: ['jpg', 'jpeg', 'png', 'webp'], minValue: 0, maxValue: 10240 },
    ],
    columns: [
      ['Name', 'Description'],
      ['expenseDate_c', 'Date'],
      ['amount_c', 'Amount'],
      ['paymentMethod_c', 'Paid via'],
      ['attachments_c', 'Receipt'],
    ],
  },
};

function legacySaleId(row) {
  return row.saleId_c || ('LEGACY-' + String(row.Id ?? '').slice(-8).toUpperCase());
}

async function loadRecords(config, search, range) {
  const results = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let query = sdk.table(config.table)
      .select(config.selectFields)
      .where(gte(config.dateKey, range.start))
      .where(lt(config.dateKey, range.endExclusive));

    if (search.trim()) {
      const filters = config.searchFields.map((field) => contains(field, search.trim()));
      query = query.where(or(...filters));
    }

    const response = await query.orderByDesc(config.dateKey).page(page, 100).fetch();
    if (!response.success) {
      throw new Error(response.message || 'Unable to load ' + config.title.toLowerCase());
    }

    results.push(...(response.data ?? []));
    hasMore = Boolean(response.hasMore);
    page += 1;
  }

  return results;
}

function cellValue(row, key, config) {
  const value = row[key];
  if (key === 'saleId_c') return legacySaleId(row);
  if (key === 'attachments_c') return null;
  if (key === 'paidAmount_c') {
    const total = Number(row.amount_c ?? 0);
    const paid = row.paidAmount_c != null ? Number(row.paidAmount_c) : total;
    return cash(paid);
  }
  if (key === 'balanceDue_c') {
    const total = Number(row.amount_c ?? 0);
    const paid = row.paidAmount_c != null ? Number(row.paidAmount_c) : total;
    const balance = row.balanceDue_c != null ? Number(row.balanceDue_c) : Math.max(0, total - paid);
    return cash(balance);
  }
  if (key === 'paymentStatus_c') {
    const total = Number(row.amount_c ?? 0);
    const paid = row.paidAmount_c != null ? Number(row.paidAmount_c) : total;
    const balance = row.balanceDue_c != null ? Number(row.balanceDue_c) : Math.max(0, total - paid);
    const status = row.paymentStatus_c || (balance <= 0 ? 'Paid' : paid <= 0 ? 'Unpaid' : 'Partially Paid');
    const badgeColor = status === 'Paid'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
      : status === 'Partially Paid'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20';
    return (
      <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold ${badgeColor}`}>
        {status}
      </span>
    );
  }
  if (value == null || value === '') return '—';
  if (key === config.amountKey || key === 'unitPrice_c') return cash(value);
  if (key === 'weightKg_c') return Number(value).toLocaleString('en-IN');
  if (key === config.dateKey) return formatLocalDate(value, DATE_FORMATS.SHORT);
  return String(value);
}

function ReceiptCell({ files }) {
  const file = Array.isArray(files) ? files[0] : null;

  async function openReceipt() {
    if (!file) return;
    try {
      const result = await sdk.storage.preview(file);
      if (result?.url) window.open(result.url, '_blank', 'noopener,noreferrer');
      else toast.error('The receipt preview is unavailable.');
    } catch (error) {
      toast.error('Could not open the receipt.', { description: error.message ?? String(error) });
    }
  }

  if (!file) return <span className="text-muted-foreground">—</span>;
  return (
    <Button type="button" size="sm" variant="outline" className="rounded-sm" onClick={openReceipt}>
      <ApperIcon name="Paperclip" size={14} />
      View receipt
    </Button>
  );
}

export function SimpleFinanceList({ kind }) {
  const config = MODULES[kind];
  const { profile } = useProfile();
  const permission = getTableAccess(profile, config.table);
  const [search, setSearch] = useState('');
  const [periodType, setPeriodType] = useState('month');
  const [anchorDate, setAnchorDate] = useState(todayLocalDate());
  const range = getPeriodRange(periodType, anchorDate);
  const { data, loading, error, run } = useFetch(
    () => loadRecords(config, search, range),
    [kind, search, periodType, anchorDate]
  );
  const rows = data ?? [];
  const total = rows.reduce((sum, row) => sum + Number(row[config.amountKey] ?? 0), 0);
  const cashTotal = rows.reduce((sum, row) => {
    return row.paymentMethod_c === 'Cash' ? sum + Number(row[config.amountKey] ?? 0) : sum;
  }, 0);

  const paidTotal = rows.reduce((sum, row) => {
    const totalRow = Number(row.amount_c ?? 0);
    return sum + (row.paidAmount_c != null ? Number(row.paidAmount_c) : totalRow);
  }, 0);

  const pendingTotal = rows.reduce((sum, row) => {
    const totalRow = Number(row.amount_c ?? 0);
    const paid = row.paidAmount_c != null ? Number(row.paidAmount_c) : totalRow;
    return sum + (row.balanceDue_c != null ? Number(row.balanceDue_c) : Math.max(0, totalRow - paid));
  }, 0);

  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [collectPaymentRow, setCollectPaymentRow] = useState(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collecting, setCollecting] = useState(false);

  async function handleCollectPayment(e) {
    e.preventDefault();
    if (!collectPaymentRow || collecting) return;
    const paying = Number(collectAmount);
    const totalRow = Number(collectPaymentRow.amount_c || 0);
    const currentPaid = collectPaymentRow.paidAmount_c != null ? Number(collectPaymentRow.paidAmount_c) : totalRow;
    const currentPending = collectPaymentRow.balanceDue_c != null ? Number(collectPaymentRow.balanceDue_c) : Math.max(0, totalRow - currentPaid);
    if (!Number.isFinite(paying) || paying <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    if (paying > currentPending) {
      toast.error(`Payment cannot exceed pending balance of ${cash(currentPending)}.`);
      return;
    }
    setCollecting(true);
    try {
      const newPaid = roundMoney(currentPaid + paying);
      const newPending = roundMoney(Math.max(0, totalRow - newPaid));
      const newStatus = newPending <= 0 ? 'Paid' : 'Partially Paid';
      const res = await sdk.table('sales_c').update({
        Id: collectPaymentRow.Id,
        paidAmount_c: newPaid,
        balanceDue_c: newPending,
        paymentStatus_c: newStatus,
      });
      if (!res.data?.length) throw new Error(res.messages?.[0] || 'Payment update failed.');
      toast.success(`Payment of ${cash(paying)} recorded. Remaining balance: ${cash(newPending)}.`);
      setCollectPaymentRow(null);
      setCollectAmount('');
      run();
    } catch (err) {
      toast.error('Could not record payment.', { description: err.message ?? String(err) });
    } finally {
      setCollecting(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const response = await sdk.table(config.table).remove(pendingDelete.Id);
      if (response.messages?.length) {
        toast.error(response.messages[0], { description: response.messages.slice(1).join('\n') || undefined });
        console.error(`${config.table} delete failed: ${response.messages.join('; ')}`);
        return;
      }
      toast.success(`${config.title.replace(/s$/, '')} deleted.`);
      setPendingDelete(null);
      run();
    } catch (error) {
      toast.error('Could not delete the ' + config.singular + '.', { description: error.message ?? String(error) });
      console.error(`${config.table} delete threw: ${error.message ?? String(error)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / {config.title}</p>
          <h1 className="font-heading text-3xl font-semibold">{config.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Record and review {config.title.toLowerCase()} in one place.</p>
        </div>
        {permission.canCreate && (
          <Button asChild className="min-h-10 rounded-sm">
            <Link to={config.path + '/new'}>
              <ApperIcon name="Plus" size={16} />
              Add {config.singular}
            </Link>
          </Button>
        )}
      </div>

      <PeriodControls
        type={periodType}
        onTypeChange={setPeriodType}
        anchorDate={anchorDate}
        onAnchorDateChange={setAnchorDate}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {kind === 'sales' ? (
          <>
            <section className="border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Total Sales · {range.label}</p>
              {loading && data === undefined ? <Skeleton className="mt-3 h-7 w-32" /> : <p className="mt-2 font-heading text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{cash(total)}</p>}
            </section>
            <section className="border border-border bg-card p-4">
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Total Received / Paid</p>
              {loading && data === undefined ? <Skeleton className="mt-3 h-7 w-32" /> : <p className="mt-2 font-heading text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{cash(paidTotal)}</p>}
            </section>
            <section className="border border-border bg-card p-4">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Pending Balance Due</p>
              {loading && data === undefined ? <Skeleton className="mt-3 h-7 w-32" /> : <p className="mt-2 font-heading text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{cash(pendingTotal)}</p>}
            </section>
          </>
        ) : (
          <>
            <section className="border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Total for {range.label}</p>
              {loading && data === undefined ? <Skeleton className="mt-3 h-7 w-32" /> : <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{cash(total)}</p>}
            </section>
            <section className="border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Records in period</p>
              {loading && data === undefined ? <Skeleton className="mt-3 h-7 w-20" /> : <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{rows.length.toLocaleString('en-IN')}</p>}
            </section>
            <section className="border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Cash total for period</p>
              {loading && data === undefined ? <Skeleton className="mt-3 h-7 w-32" /> : <p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{cash(cashTotal)}</p>}
            </section>
          </>
        )}
      </div>

      <div className="relative max-w-lg">
        <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={'Search ' + config.title.toLowerCase() + '…'}
          className="min-h-10 rounded-sm pl-9"
          aria-label={'Search ' + config.title.toLowerCase()}
        />
      </div>

      <section className="overflow-hidden border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{config.title} register</h2>
          <span className="text-xs text-muted-foreground">{loading && data === undefined ? 'Loading…' : rows.length + ' records'}</span>
        </div>
        {loading && data === undefined ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="font-medium">Could not load {config.title.toLowerCase()}</p>
            <p className="mt-1 text-sm text-muted-foreground">{String(error?.message ?? error)}</p>
            <Button variant="outline" className="mt-3 rounded-sm" onClick={() => run()}>Try again</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <ApperIcon name={config.icon} size={28} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-semibold">No {config.title.toLowerCase()} recorded for this period</p>
            <p className="mt-1 text-sm text-muted-foreground">Choose another period or add a new record.</p>
            {permission.canCreate && (
              <Button asChild className="mt-4 rounded-sm">
                <Link to={config.path + '/new'}><ApperIcon name="Plus" size={15} /> Add {config.singular}</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto" aria-busy={loading}>
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-3 font-semibold">#</th>
                  {config.columns.map(([key, label]) => (
                    <th key={key} className={'px-4 py-3 font-semibold ' + (key === config.amountKey || key === 'unitPrice_c' || key === 'weightKg_c' || key === 'paidAmount_c' || key === 'balanceDue_c' ? 'text-right' : '')}>{label}</th>
                  ))}
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, index) => {
                  const pendingDue = row.balanceDue_c != null ? Number(row.balanceDue_c) : Math.max(0, Number(row.amount_c || 0) - (row.paidAmount_c != null ? Number(row.paidAmount_c) : Number(row.amount_c || 0)));
                  return (
                    <tr key={row.Id} className="transition-colors hover:bg-muted/30">
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</td>
                      {config.columns.map(([key]) => (
                        <td key={key} className={'whitespace-nowrap px-4 py-3 ' + (key === config.amountKey || key === 'unitPrice_c' || key === 'weightKg_c' || key === 'paidAmount_c' || key === 'balanceDue_c' ? 'text-right tabular-nums' : '')}>
                          {key === 'attachments_c'
                            ? <ReceiptCell files={row.attachments_c} />
                            : cellValue(row, key, config)}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {kind === 'sales' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 rounded-sm px-2 text-xs"
                              onClick={() => setSelectedInvoice(row)}
                            >
                              <ApperIcon name="FileText" size={13} />
                              Invoice
                            </Button>
                          )}
                          {kind === 'sales' && pendingDue > 0 && permission.canUpdate && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 rounded-sm px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                              onClick={() => {
                                setCollectAmount(String(pendingDue));
                                setCollectPaymentRow(row);
                              }}
                              title="Record payment settlement"
                            >
                              <ApperIcon name="HandCoins" size={13} />
                              Collect
                            </Button>
                          )}
                          {permission.canUpdate && (
                            <Button asChild variant="ghost" size="sm" className="h-8 size-8 p-0 rounded-sm">
                              <Link to={config.path + '/' + row.Id + '/edit'} aria-label={'Edit ' + config.singular}>
                                <ApperIcon name="Pencil" size={14} />
                              </Link>
                            </Button>
                          )}
                          {permission.canDelete && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 size-8 p-0 rounded-sm text-destructive hover:text-destructive"
                              aria-label={'Delete ' + config.singular}
                              onClick={() => setPendingDelete(row)}
                            >
                              <ApperIcon name="Trash2" size={14} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Collect Payment Dialog */}
      <Dialog open={Boolean(collectPaymentRow)} onOpenChange={(open) => { if (!open && !collecting) setCollectPaymentRow(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment for Sale</DialogTitle>
            <DialogDescription>
              {collectPaymentRow && (
                <span>
                  Sale <strong className="font-mono">{legacySaleId(collectPaymentRow)}</strong> ({collectPaymentRow.customerName_c || 'Customer'}). Total: {cash(collectPaymentRow.amount_c)}, Pending: <strong>{cash(collectPaymentRow.balanceDue_c ?? collectPaymentRow.amount_c)}</strong>.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCollectPayment} className="space-y-4 py-2">
            <div>
              <label htmlFor="collect-amount" className="mb-1 block text-sm font-medium">Payment Amount (₹) *</label>
              <Input
                id="collect-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={collectPaymentRow ? (collectPaymentRow.balanceDue_c ?? collectPaymentRow.amount_c) : undefined}
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value)}
                required
                className="rounded-sm"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setCollectPaymentRow(null)} disabled={collecting}>Cancel</Button>
              <Button type="submit" disabled={collecting}>
                {collecting ? 'Recording…' : 'Record Payment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Customer Invoice Modal */}
      {selectedInvoice && (
        <CustomerInvoiceModal
          sale={selectedInvoice}
          open={Boolean(selectedInvoice)}
          onOpenChange={(open) => { if (!open) setSelectedInvoice(null); }}
        />
      )}

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {config.singular}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (kind === 'sales' ? legacySaleId(pendingDelete) : pendingDelete.Name || 'This expense')} will be permanently removed. This cannot be undone.
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
      <p className="text-xs text-muted-foreground">Totals reflect the selected date period and search results.</p>
    </div>
  );
}

function initialForm(config) {
  const values = {};
  config.fields.forEach((field) => {
    values[field.key] = field.key === config.dateKey ? todayLocalDate() : field.type === 'Files' ? [] : '';
  });
  return values;
}

function buildSalePayload(form, calculatedTotal) {
  const quantity = Number(form.weightKg_c);
  const rate = Number(form.unitPrice_c);
  const total = calculatedTotal != null ? calculatedTotal : roundMoney(quantity * rate);
  const statusOption = form.paymentStatus_c || 'Paid';
  const paid = statusOption === 'Paid'
    ? total
    : statusOption === 'Unpaid'
    ? 0
    : Math.min(total, Math.max(0, Number(form.paidAmount_c ?? total)));
  const balance = roundMoney(Math.max(0, total - paid));
  const finalStatus = balance <= 0 ? 'Paid' : paid <= 0 ? 'Unpaid' : 'Partially Paid';

  return {
    saleDate_c: form.saleDate_c,
    customerName_c: String(form.customerName_c ?? '').trim(),
    customerContact_c: String(form.customerContact_c ?? '').trim(),
    productName_c: String(form.productName_c ?? '').trim(),
    weightKg_c: quantity,
    unitPrice_c: rate,
    amount_c: total,
    paidAmount_c: paid,
    balanceDue_c: balance,
    paymentStatus_c: finalStatus,
    paymentMethod_c: form.paymentMethod_c,
    notes_c: String(form.notes_c ?? '').trim(),
  };
}

function formFromSale(sale, config) {
  const values = initialForm(config);
  config.fields.forEach((field) => {
    if (field.type === 'Files') return;
    const value = sale[field.key];
    values[field.key] = value == null ? '' : String(value);
  });
  if (sale.paidAmount_c != null) values.paidAmount_c = String(sale.paidAmount_c);
  if (sale.paymentStatus_c != null) values.paymentStatus_c = String(sale.paymentStatus_c);
  if (sale.balanceDue_c != null) values.balanceDue_c = String(sale.balanceDue_c);
  return values;
}

export function SimpleFinanceForm({ kind, mode = 'create' }) {
  const config = MODULES[kind];
  const { id } = useParams();
  const editing = mode === 'edit';
  const navigate = useNavigate();
  const { profile } = useProfile();
  const permission = getTableAccess(profile, config.table);
  const [form, setForm] = useState(() => initialForm(config));
  const [original, setOriginal] = useState(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  const [salesId, setSalesId] = useState(generateSalesId);
  const [uploading, setUploading] = useState(false);
  const { data: producedStock } = useFetch(
    () => (kind === 'sales' ? getProducedStockBalances() : Promise.resolve([])),
    [kind]
  );
  const { data: loadedRecord, error: loadError } = useFetch(
    () => (editing
      ? sdk.table(config.table).select(config.selectFields).get(id).then((res) => (res.success ? res.data ?? null : null))
      : Promise.resolve(null)),
    [editing, config, id]
  );
  useEffect(() => {
    if (!loadedRecord) return;
    setOriginal(loadedRecord);
    setForm(formFromSale(loadedRecord, config));
    if (kind === 'sales') {
      setSalesId(legacySaleId(loadedRecord));
    }
  }, [loadedRecord, config, kind]);
  const currentProductKey = normalizeProductName(form.productName_c);
  const productOptions = (producedStock ?? []).filter((item) => item.balance > 0 || (editing && item.key === currentProductKey));
  const selectedProduct = (producedStock ?? []).find((item) => item.key === currentProductKey);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const calculatedTotal = kind === 'sales'
    ? roundMoney(Number(form.weightKg_c || 0) * Number(form.unitPrice_c || 0))
    : 0;

  async function save(event) {
    event.preventDefault();
    if (saving || submittingRef.current) return;

    if (kind === 'sales') {
      const quantity = Number(form.weightKg_c);
      const rate = Number(form.unitPrice_c);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast.error('Quantity must be greater than zero.');
        return;
      }
      if (!Number.isFinite(rate) || rate <= 0) {
        toast.error('Rate per kilogram must be greater than zero.');
        return;
      }
      if (!String(form.productName_c ?? '').trim()) {
        toast.error('Choose the product being sold.');
        return;
      }
    } else {
      const amount = Number(form.amount_c);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error('Amount must be greater than zero.');
        return;
      }
    }

    if (!form[config.dateKey]) {
      toast.error('Choose a date.');
      return;
    }
    if (!form.paymentMethod_c) {
      toast.error('Choose a payment method.');
      return;
    }
    if (kind === 'sales' && !salesId) {
      toast.error('A Sales ID could not be generated. Please retry.');
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      if (kind === 'sales' && editing) {
        if (!original) throw new Error('The sale has not loaded yet. Refresh and try again.');
        await updateSale(original, buildSalePayload(form, calculatedTotal));
        toast.success('Sale ' + legacySaleId(original) + ' updated. Stock updated.');
        navigate(config.path);
        return;
      }

      if (kind === 'sales') {
        let candidateId = salesId;
        let uniqueIdConfirmed = false;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const existing = await sdk.table('sales_c')
            .select(['Name', 'saleId_c'])
            .where(eq('saleId_c', candidateId))
            .page(1, 2)
            .fetch();
          if (!existing.success) throw new Error(existing.message || 'Could not verify the Sales ID.');
          if (!(existing.data ?? []).length) {
            uniqueIdConfirmed = true;
            break;
          }
          candidateId = generateSalesId();
        }
        if (!uniqueIdConfirmed) throw new Error('Could not generate a unique Sales ID. Please retry.');
        setSalesId(candidateId);
        await recordSale({ Name: candidateId, saleId_c: candidateId, ...buildSalePayload(form, calculatedTotal) });
        toast.success('Sale saved with ID ' + candidateId + '.');
        navigate(config.path);
        return;
      }

      if (kind === 'expenses' && editing) {
        if (!original) throw new Error('The expense has not loaded yet. Refresh and try again.');
        const updatePayload = {
          Id: original.Id,
          Name: String(form.Name ?? '').trim(),
          expenseDate_c: form.expenseDate_c,
          amount_c: roundMoney(Number(form.amount_c)),
          paymentMethod_c: form.paymentMethod_c,
          notes_c: String(form.notes_c ?? '').trim(),
          attachments_c: sdk.storage.toCreateFormat(form.attachments_c ?? []),
        };
        const response = await sdk.table(config.table).update(updatePayload);
        if (!response.data?.length) {
          throw new Error(response.messages?.[0] || 'Could not update the expense.');
        }
        toast.success('Expense updated.');
        navigate(config.path);
        return;
      }

      const payload = {
        Name: String(form.Name ?? '').trim(),
        expenseDate_c: form.expenseDate_c,
        amount_c: roundMoney(Number(form.amount_c)),
        paymentMethod_c: form.paymentMethod_c,
        notes_c: String(form.notes_c ?? '').trim(),
        attachments_c: sdk.storage.toCreateFormat(form.attachments_c ?? []),
      };
      if (!payload.Name) {
        toast.error('Enter an expense description.');
        return;
      }
      const response = await sdk.table(config.table).create(payload);
      if (!response.data?.length) {
        toast.error(response.messages?.[0] || 'The record was not saved.');
        return;
      }
      toast.success('Expense saved.');
      navigate(config.path);
    } catch (error) {
      toast.error('Could not save the record.', { description: error.message ?? String(error) });
      console.error(`${config.table} save threw: ${error.message ?? String(error)}`);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  if (!(editing ? permission.canUpdate : permission.canCreate)) {
    return (
      <div className="space-y-3">
        <p>You do not have permission to {editing ? 'edit' : 'add'} {config.title.toLowerCase()}.</p>
        <Button asChild variant="outline"><Link to={config.path}>Back to {config.title}</Link></Button>
      </div>
    );
  }

  if (editing && loadError) {
    return (
      <div className="space-y-3">
        <p className="font-medium">Could not load this {config.singular}</p>
        <p className="text-sm text-muted-foreground">{String(loadError?.message ?? loadError)}</p>
        <Button asChild variant="outline"><Link to={config.path}>Back to {config.title}</Link></Button>
      </div>
    );
  }

  if (editing && loadedRecord === undefined) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (editing && loadedRecord === null) {
    return (
      <div className="space-y-3">
        <p>This {config.singular} could not be found.</p>
        <Button asChild variant="outline"><Link to={config.path}>Back to {config.title}</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm">
        <Link to={config.path}><ApperIcon name="ArrowLeft" size={16} /> Back to {config.title}</Link>
      </Button>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / {config.title}</p>
        <h1 className="font-heading text-3xl font-semibold">{editing ? 'Edit' : 'Add'} {config.singular}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Enter the required details and save the record.</p>
      </div>

      <form onSubmit={save} className="space-y-6 border border-border bg-card p-5 md:p-7">
        {kind === 'sales' && (
          <div className="border border-border bg-muted/30 p-4">
            <label htmlFor="sales-id" className="mb-1.5 block text-sm font-medium">Sales ID</label>
            <Input id="sales-id" value={salesId} readOnly className="min-h-10 rounded-sm bg-background font-mono" />
            <p className="mt-1 text-xs text-muted-foreground">Generated automatically. This ID will be stored with the sale.</p>
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {config.fields.map((field) => (
            <div key={field.key} className={field.type === 'MultilineText' || field.type === 'Files' ? 'sm:col-span-2' : ''}>
              <label htmlFor={'finance-' + field.key} className="mb-1.5 block text-sm font-medium">
                {field.label}{field.required ? ' *' : ''}
              </label>
              {field.type === 'Picklist' ? (
                <select
                  id={'finance-' + field.key}
                  value={form[field.key] ?? ''}
                  required={field.required}
                  onChange={(event) => setField(field.key, event.target.value)}
                  className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Choose {field.label.toLowerCase()}</option>
                  {field.values.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : field.type === 'MultilineText' ? (
                <Textarea
                  id={'finance-' + field.key}
                  value={form[field.key] ?? ''}
                  onChange={(event) => setField(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                />
              ) : field.type === 'ProducedProduct' ? (
                <>
                  <select
                    id={'finance-' + field.key}
                    value={form[field.key] ?? ''}
                    required={field.required}
                    onChange={(event) => setField(field.key, event.target.value)}
                    className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">{producedStock === undefined ? 'Loading products…' : 'Choose product in stock'}</option>
                    {productOptions.map((item) => (
                      <option key={item.key} value={item.name}>{item.name} ({item.balance.toLocaleString('en-IN')} kg available)</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedProduct
                      ? selectedProduct.balance.toLocaleString('en-IN') + ' kg in stock for this product.'
                      : 'Products appear here once production has been recorded.'}
                  </p>
                </>
              ) : field.type === 'Files' ? (
                <FilePicker
                  value={form[field.key] ?? []}
                  onChange={(files) => setField(field.key, files)}
                  fieldConfig={field}
                  maxFiles={1}
                  onUploadingChange={setUploading}
                />
              ) : (
                <Input
                  id={'finance-' + field.key}
                  type={field.type === 'Date' ? 'date' : field.type === 'Decimal' ? 'number' : 'text'}
                  value={form[field.key] ?? ''}
                  onChange={(event) => setField(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  min={field.key === 'amount_c' || field.key === 'weightKg_c' || field.key === 'unitPrice_c' ? '0.01' : undefined}
                  step={field.key === 'weightKg_c' ? '0.001' : field.type === 'Decimal' ? '0.01' : undefined}
                  className="min-h-10 rounded-sm"
                />
              )}
            </div>
          ))}
        </div>

        {kind === 'sales' && (
          <div className="space-y-4 rounded-sm border border-primary/20 bg-primary/5 p-4" aria-live="polite">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sale Total</p>
                <p className="font-heading text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{cash(calculatedTotal)}</p>
              </div>
              <div className="text-xs text-muted-foreground">
                {form.weightKg_c && form.unitPrice_c
                  ? Number(form.weightKg_c).toLocaleString('en-IN') + ' kg × ' + cash(form.unitPrice_c) + ' per kg'
                  : 'Enter quantity and rate to calculate the sale total.'}
              </div>
            </div>

            <div className="border-t border-primary/20 pt-4">
              <label htmlFor="finance-paymentStatus_c" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Payment Division & Status *
              </label>
              <select
                id="finance-paymentStatus_c"
                value={form.paymentStatus_c || 'Paid'}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  setForm((current) => ({
                    ...current,
                    paymentStatus_c: newStatus,
                    paidAmount_c: newStatus === 'Paid' ? String(calculatedTotal) : newStatus === 'Unpaid' ? '0' : current.paidAmount_c || String(calculatedTotal),
                  }));
                }}
                className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="Paid">Paid in Full ({cash(calculatedTotal)})</option>
                <option value="Partially Paid">Partially Paid (Custom amount received)</option>
                <option value="Unpaid">Unpaid / Full Credit (Pending: {cash(calculatedTotal)})</option>
              </select>
            </div>

            {form.paymentStatus_c === 'Partially Paid' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="finance-paidAmount_c" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Amount Paid Received (₹) *
                  </label>
                  <Input
                    id="finance-paidAmount_c"
                    type="number"
                    step="0.01"
                    min="0"
                    max={calculatedTotal}
                    value={form.paidAmount_c ?? ''}
                    onChange={(e) => setField('paidAmount_c', e.target.value)}
                    placeholder="0.00"
                    className="min-h-10 rounded-sm bg-background"
                    required
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Remaining Balance Due (₹)
                  </p>
                  <p className="min-h-10 flex items-center font-heading text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {cash(Math.max(0, calculatedTotal - Number(form.paidAmount_c || 0)))}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse justify-between gap-3 border-t border-border pt-5 sm:flex-row">
          <Button type="button" variant="outline" asChild className="rounded-sm"><Link to={config.path}>Cancel</Link></Button>
          <Button type="submit" disabled={saving || uploading} className="min-h-10 rounded-sm">
            {saving ? 'Saving…' : (editing ? 'Update ' : 'Save ') + config.singular}
            {!saving && <ApperIcon name="Check" size={16} />}
          </Button>
        </div>
      </form>
    </div>
  );
}
