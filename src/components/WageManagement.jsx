import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sdk, lte, eq } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { todayLocalDate, getPeriodRange } from '@/services/periods';
import { calculateWorkerWageSummary, cash, payPeriodBounds } from '@/services/wageCalculations';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import PeriodControls from '@/components/PeriodControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

const WORKER_FIELDS = ['Name', 'role_c', 'phone_c', 'dailyRate_c', 'status_c', 'joinedOn_c', 'notes_c', 'workerType_c'];
const ATTENDANCE_FIELDS = ['Name', 'worker_c', 'attendanceDate_c', 'status_c', 'wagePerDay_c', 'attendanceUnits_c', 'earnedWage_c', 'attendanceKey_c', 'notes_c'];
const PAYMENT_FIELDS = ['Id', 'Name', 'worker_c', 'paymentDate_c', 'amount_c', 'paymentMethod_c', 'transactionType_c', 'notes_c', 'CreatedOn'];
const PAYROLL_FIELDS = ['Name', 'worker_c', 'payPeriod_c', 'daysPresent_c', 'grossPay_c', 'advance_c', 'deductions_c', 'netPay_c', 'status_c', 'paidOn_c', 'notes_c'];

async function fetchAll(table, fields, filter) {
  const result = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    let query = sdk.table(table).select(fields);
    if (filter) query = query.where(filter);
    const response = await query.orderByDesc('CreatedOn').page(page, 100).fetch();
    if (!response.success) throw new Error(response.message || 'Could not load ' + table + '.');
    result.push(...(response.data ?? []));
    hasMore = Boolean(response.hasMore);
    page += 1;
  }
  return result;
}

async function loadWageData(throughDate) {
  const [workers, attendance, payments, legacyPayroll] = await Promise.all([
    fetchAll('workers_c', WORKER_FIELDS),
    fetchAll('attendance_c', ATTENDANCE_FIELDS, lte('attendanceDate_c', throughDate)),
    fetchAll('worker_payments_c', PAYMENT_FIELDS, lte('paymentDate_c', throughDate)),
    fetchAll('payroll_c', PAYROLL_FIELDS),
  ]);
  return { workers, attendance, payments, legacyPayroll };
}

function randomReference(prefix, date) {
  const token = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
  return prefix + '-' + String(date).replaceAll('-', '') + '-' + token;
}

function periodOverlaps(payPeriod, range) {
  const bounds = payPeriodBounds(payPeriod);
  return bounds && bounds.start <= range.end && bounds.end >= range.start;
}

export default function WageManagement() {
  const { profile } = useProfile();
  const paymentAccess = getTableAccess(profile, 'worker_payments_c');
  const [periodType, setPeriodType] = useState('month');
  const [anchorDate, setAnchorDate] = useState(todayLocalDate());
  const [search, setSearch] = useState('');
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [form, setForm] = useState({
    workerId: '',
    transactionType: 'Wage Payment',
    amount: '',
    paymentDate: todayLocalDate(),
    paymentMethod: 'Cash',
    reference: '',
    notes: '',
  });
  const range = getPeriodRange(periodType, anchorDate);

  const { data, loading, error, run } = useFetch(
    () => loadWageData(range.end),
    [range.end]
  );

  const workers = data?.workers ?? [];
  const attendance = data?.attendance ?? [];
  const payments = data?.payments ?? [];
  const legacyPayroll = data?.legacyPayroll ?? [];

  const summaries = workers.map((worker) => calculateWorkerWageSummary({
    worker,
    attendance,
    payments,
    legacyPayroll,
    range,
  })).filter((item) => item.worker.status_c === 'Active'
    || item.periodAttendance.length
    || item.periodPayments.length
    || item.legacyRows.length
    || item.closingBalance !== 0)
    .filter((item) => {
      if (!search.trim()) return true;
      const query = search.trim().toLocaleLowerCase();
      return String(item.worker.Name).toLocaleLowerCase().includes(query)
        || String(item.worker.role_c ?? '').toLocaleLowerCase().includes(query);
    })
    .sort((a, b) => String(a.worker.Name).localeCompare(String(b.worker.Name)));

  const totalEarned = summaries.reduce((sum, item) => sum + item.earned, 0);
  const totalPaid = summaries.reduce((sum, item) => sum + item.periodPaid, 0);
  const totalAdvances = summaries.reduce((sum, item) => sum + item.periodAdvances, 0);
  const advanceCredit = summaries.reduce((sum, item) => sum + item.advanceCredit, 0);

  const periodPayroll = legacyPayroll.filter((record) => periodOverlaps(record.payPeriod_c, range))
    .sort((a, b) => String(a.payPeriod_c).localeCompare(String(b.payPeriod_c)));

  const periodPaymentsList = payments.filter((record) => {
    const date = String(record.paymentDate_c ?? '');
    return date && date >= range.start && date <= range.end;
  }).sort((a, b) => String(b.paymentDate_c || '').localeCompare(String(a.paymentDate_c || '')) || String(b.CreatedOn || '').localeCompare(String(a.CreatedOn || '')));

  const filteredPayments = periodPaymentsList.filter((record) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const workerName = String(record.worker_c?.Name || workers.find((w) => String(w.Id) === String(record.worker_c?.Id ?? record.worker_c))?.Name || '').toLowerCase();
    const type = String(record.transactionType_c || '').toLowerCase();
    const notes = String(record.notes_c || '').toLowerCase();
    return workerName.includes(q) || type.includes(q) || notes.includes(q);
  });

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function savePayment(event) {
    event.preventDefault();
    if (savingPayment) return;
    if (!paymentAccess.canCreate) {
      toast.error('You do not have permission to record wage payments.');
      return;
    }
    const worker = workers.find((item) => String(item.Id) === String(form.workerId));
    const amount = Number(form.amount);
    if (!worker) {
      toast.error('Choose a worker.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Amount must be greater than zero.');
      return;
    }
    if (!form.paymentDate || !form.paymentMethod) {
      toast.error('Choose the payment date and method.');
      return;
    }

    setSavingPayment(true);
    try {
      const reference = randomReference(form.transactionType === 'Advance' ? 'ADV' : 'WAGE', form.paymentDate);
      const cleanRef = form.reference.trim();
      const cleanNotes = form.notes.trim();
      const combinedNotes = cleanRef
        ? (cleanNotes ? `Ref: ${cleanRef} | ${cleanNotes}` : `Ref: ${cleanRef}`)
        : cleanNotes;

      const payload = {
        Id: 'wpay-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        Name: reference,
        worker_c: { Id: worker.Id, Name: worker.Name },
        paymentDate_c: form.paymentDate,
        amount_c: Math.round(amount * 100) / 100,
        paymentMethod_c: form.paymentMethod,
        transactionType_c: form.transactionType,
        notes_c: combinedNotes,
      };

      const response = await sdk.table('worker_payments_c').create(payload);
      if (!response.data?.length) {
        toast.error(response.messages?.[0] || 'The payment was not saved.');
        return;
      }

      toast.success(form.transactionType === 'Advance' ? 'Advance recorded.' : 'Wage payment recorded.');
      setPaymentFormOpen(false);
      setForm({
        workerId: '',
        transactionType: 'Wage Payment',
        amount: '',
        paymentDate: todayLocalDate(),
        paymentMethod: 'Cash',
        reference: '',
        notes: '',
      });
      await run();
    } catch (saveError) {
      toast.error('Could not record the transaction.', { description: saveError.message ?? String(saveError) });
    } finally {
      setSavingPayment(false);
    }
  }

  async function handleDeletePayment(paymentId) {
    if (!paymentAccess.canDelete) {
      toast.error('You do not have permission to delete payments.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this payment record?')) return;
    try {
      const res = await sdk.table('worker_payments_c').remove(paymentId);
      if (res.success) {
        toast.success('Payment record removed.');
        await run();
      } else {
        toast.error('Could not remove payment record.');
      }
    } catch (err) {
      toast.error('Could not remove payment record.', { description: err.message ?? String(err) });
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / Daily wages</p>
          <h1 className="font-heading text-3xl font-semibold">Payroll & wage ledger</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Earned wages come from saved attendance. Payments and advances are tracked separately and carry forward into each worker’s balance.</p>
        </div>
        {paymentAccess.canCreate && (
          <Button type="button" className="min-h-10 rounded-sm" onClick={() => setPaymentFormOpen((open) => !open)}>
            <ApperIcon name="Plus" size={16} />
            Record payment / advance
          </Button>
        )}
      </header>

      <PeriodControls type={periodType} onTypeChange={setPeriodType} anchorDate={anchorDate} onAnchorDateChange={setAnchorDate} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Earned in period" value={cash(totalEarned)} />
        <Metric label="Wage payments in period" value={cash(totalPaid)} />
        <Metric label="Advances in period" value={cash(totalAdvances)} />
        <Metric label="Advance / credit balance" value={cash(advanceCredit)} />
      </div>

      {paymentFormOpen && (
        <section className="border border-border bg-card p-5">
          <div className="mb-4">
            <h2 className="font-heading text-xl font-semibold">Record a worker transaction</h2>
            <p className="mt-1 text-sm text-muted-foreground">A saved payment is a separate transaction and will not modify attendance records.</p>
          </div>
          <form onSubmit={savePayment} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label htmlFor="wage-worker" className="mb-1.5 block text-sm font-medium">Worker *</label>
              <select id="wage-worker" value={form.workerId} onChange={(event) => setField('workerId', event.target.value)} required className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">
                <option value="">Choose worker</option>
                {workers.filter((worker) => worker.status_c === 'Active' || worker.workerType_c === 'Temporary').map((worker) => <option key={worker.Id} value={worker.Id}>{worker.Name}{worker.workerType_c === 'Temporary' ? ' · Temporary' : ''}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="wage-type" className="mb-1.5 block text-sm font-medium">Transaction type *</label>
              <select id="wage-type" value={form.transactionType} onChange={(event) => setField('transactionType', event.target.value)} className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">
                <option value="Wage Payment">Wage payment</option>
                <option value="Advance">Advance</option>
              </select>
            </div>
            <div>
              <label htmlFor="wage-amount" className="mb-1.5 block text-sm font-medium">Amount (₹) *</label>
              <Input id="wage-amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setField('amount', event.target.value)} required placeholder="0.00" className="min-h-10 rounded-sm" />
            </div>
            <div>
              <label htmlFor="wage-date" className="mb-1.5 block text-sm font-medium">Transaction date *</label>
              <Input id="wage-date" type="date" value={form.paymentDate} onChange={(event) => setField('paymentDate', event.target.value)} required className="min-h-10 rounded-sm" />
            </div>
            <div>
              <label htmlFor="wage-method" className="mb-1.5 block text-sm font-medium">Payment method *</label>
              <select id="wage-method" value={form.paymentMethod} onChange={(event) => setField('paymentMethod', event.target.value)} required className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="wage-reference" className="mb-1.5 block text-sm font-medium">Reference (optional)</label>
              <Input id="wage-reference" value={form.reference} onChange={(event) => setField('reference', event.target.value)} placeholder="Receipt or transfer reference" className="min-h-10 rounded-sm" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="wage-notes" className="mb-1.5 block text-sm font-medium">Notes (optional)</label>
              <Input id="wage-notes" value={form.notes} onChange={(event) => setField('notes', event.target.value)} placeholder="Optional payment note" className="min-h-10 rounded-sm" />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-4">
              <Button type="submit" disabled={savingPayment} className="min-h-10 rounded-sm">{savingPayment ? 'Saving…' : 'Save transaction'}</Button>
              <Button type="button" variant="outline" disabled={savingPayment} onClick={() => setPaymentFormOpen(false)} className="min-h-10 rounded-sm">Cancel</Button>
            </div>
          </form>
        </section>
      )}

      <div className="relative max-w-lg">
        <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search worker or role…" className="min-h-10 rounded-sm pl-9" aria-label="Search payroll workers" />
      </div>

      <section className="overflow-hidden border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div><h2 className="text-sm font-semibold">Worker wage statements</h2><p className="mt-1 text-xs text-muted-foreground">{range.label} · saved attendance only</p></div>
          <span className="text-xs text-muted-foreground">{summaries.length} workers</span>
        </div>
        {loading && !data ? (
          <div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : error ? (
          <div className="p-6"><p className="font-medium">Payroll data could not be loaded.</p><p className="mt-1 text-sm text-muted-foreground">{String(error?.message ?? error)}</p><Button type="button" variant="outline" className="mt-3 rounded-sm" onClick={() => run()}>Retry</Button></div>
        ) : summaries.length === 0 ? (
          <div className="p-8 text-center"><ApperIcon name="WalletCards" size={28} className="mx-auto text-muted-foreground" /><p className="mt-3 font-semibold">No wage activity for this period</p><p className="mt-1 text-sm text-muted-foreground">Mark attendance in the Attendance daybook or record a payment.</p><Button asChild className="mt-4 rounded-sm"><Link to="/attendance">Open attendance</Link></Button></div>
        ) : (
          <div className="overflow-x-auto" aria-busy={loading}>
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr>
                <th className="px-4 py-3">Worker</th>
                <th className="px-4 py-3 text-right">Full days</th>
                <th className="px-4 py-3 text-right">Half days</th>
                <th className="px-4 py-3 text-right">Counted units</th>
                <th className="px-4 py-3 text-right">Earned</th>
                <th className="px-4 py-3 text-right">Paid in period</th>
                <th className="px-4 py-3 text-right">Advances in period</th>
                <th className="px-4 py-3 text-right">Closing balance</th>
                <th className="px-4 py-3">Statement</th>
              </tr></thead>
              <tbody className="divide-y divide-border">{summaries.map((item) => (
                <tr key={item.worker.Id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{item.worker.Name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.worker.role_c || 'Worker'} · {item.worker.workerType_c === 'Temporary' ? 'Temporary' : 'Regular'}{item.worker.status_c === 'Inactive' ? ' · Inactive' : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.fullDays}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.halfDays}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.attendanceUnits.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{cash(item.earned)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{cash(item.periodPaid)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{cash(item.periodAdvances)}</td>
                  <td className="px-4 py-3 text-right">
                    {item.closingBalance > 0 ? <span className="font-semibold text-warning-foreground">{cash(item.closingBalance)} due</span>
                      : item.closingBalance < 0 ? <span className="font-semibold text-primary">{cash(item.advanceCredit)} credit</span>
                        : <span className="font-semibold">{cash(0)}</span>}
                  </td>
                  <td className="px-4 py-3"><Button asChild size="sm" variant="outline" className="rounded-sm"><Link to={'/workers/' + item.worker.Id}>View statement</Link></Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border p-3 text-[11px] text-muted-foreground">Closing balances include recorded attendance and prior payment/advance entries through the selected period end. Existing legacy payroll advances and paid net amounts are included once; their original advance dates may not be available.</p>
      </section>

      <section className="overflow-hidden border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Recorded payments & advances</h2>
            <p className="mt-1 text-xs text-muted-foreground">{range.label} · direct worker wage disbursements and advances</p>
          </div>
          <span className="text-xs text-muted-foreground">{filteredPayments.length} transaction{filteredPayments.length === 1 ? '' : 's'}</span>
        </div>
        {filteredPayments.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No wage payments or advances recorded for {range.label}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Notes / Ref</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  {paymentAccess.canDelete && <th className="px-4 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredPayments.map((record) => {
                  const workerName = record.worker_c?.Name || workers.find((w) => String(w.Id) === String(record.worker_c?.Id ?? record.worker_c))?.Name || 'Worker';
                  return (
                    <tr key={record.Id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{record.paymentDate_c}</td>
                      <td className="px-4 py-3 font-semibold">{workerName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          record.transactionType_c === 'Advance'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}>
                          {record.transactionType_c}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{record.paymentMethod_c}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{record.notes_c || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{cash(record.amount_c)}</td>
                      {paymentAccess.canDelete && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeletePayment(record.Id)}
                          >
                            <ApperIcon name="Trash2" size={14} className="mr-1" />
                            Delete
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Existing payroll records</h2><p className="mt-1 text-xs text-muted-foreground">Historical payroll entries are preserved and displayed by their stored pay-period dates.</p></div>
        {periodPayroll.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No saved payroll records overlap {range.label}.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Worker</th><th className="px-4 py-3">Pay period</th><th className="px-4 py-3 text-right">Days</th><th className="px-4 py-3 text-right">Gross</th><th className="px-4 py-3 text-right">Advance</th><th className="px-4 py-3 text-right">Net pay</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-border">{periodPayroll.map((record) => (
                <tr key={record.Id}>
                  <td className="px-4 py-3 font-medium">{record.worker_c?.Name ?? 'Unknown worker'}</td>
                  <td className="px-4 py-3">{record.payPeriod_c}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{Number(record.daysPresent_c ?? 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{cash(record.grossPay_c)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{cash(record.advance_c)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{cash(record.netPay_c)}</td>
                  <td className="px-4 py-3">{record.status_c}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return <section className="border border-border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 font-heading text-xl font-semibold tabular-nums">{value}</p></section>;
}
