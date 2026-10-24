import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import FilePicker from '@/components/FilePicker';
import ApperIcon from '@/components/ApperIcon';
import { toast } from 'sonner';
import { todayLocalDate } from '@/services/periods';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { formatInr, newIdempotencyKey } from '@/services/purchaseWorkflow';
import { getBorrowingById, getBorrowingRepayments, recordBorrowingRepayment, settleDirectSupplierPayment } from '@/services/borrowingWorkflow';
import { getPurchaseById } from '@/services/purchaseWorkflow';

export const route = { path: '/borrowings/:id', layout: 'owner', access: "profile === 'Admin_c'" };

const dateLabel = (value) => value ? formatLocalDate(value, DATE_FORMATS.SHORT) : '—';
const amount = (value) => Number(value ?? 0);
const FILE_CONFIG = { label: 'Repayment receipt', type: 'Files', supportMultipleValues: false, supportedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'], minValue: 0, maxValue: 10240 };

function Metric({ label, value, note, icon }) {
  return (
    <div className="border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><ApperIcon name={icon} size={17} className="text-primary" /></div>
      <p className="mt-3 font-heading text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  const classes = status === 'Fully Repaid'
    ? 'border-success-border bg-success-muted text-success'
    : status === 'Partially Repaid'
      ? 'border-warning-border bg-warning-muted text-warning-foreground'
      : 'border-border bg-muted text-muted-foreground';
  return <span className={'inline-flex rounded-sm border px-2 py-1 text-xs font-semibold ' + classes}>{status || 'Outstanding'}</span>;
}

export default function BorrowingDetailPage() {
  const { id } = useParams();
  const { data: borrowing, loading, error, run: reloadBorrowing } = useFetch(() => getBorrowingById(id), [id]);
  const { data: repayments, loading: repaymentLoading, error: repaymentError, run: reloadRepayments } = useFetch(() => getBorrowingRepayments(id), [id]);
  const purchaseId = borrowing?.relatedPurchase_c?.Id ?? borrowing?.relatedPurchase_c ?? '';
  const { data: purchase, run: reloadPurchase } = useFetch(
    () => purchaseId ? getPurchaseById(purchaseId) : Promise.resolve(null),
    [purchaseId],
    { initialLoading: Boolean(purchaseId) },
  );
  const [showRepaymentForm, setShowRepaymentForm] = useState(false);
  const [form, setForm] = useState({
    repaymentDate_c: todayLocalDate(),
    principalAmount_c: '',
    interestAmount_c: '',
    paymentMethod_c: 'Cash',
    paidFromAccount_c: '',
    notes_c: '',
    attachments_c: [],
  });
  const [saving, setSaving] = useState(false);
  const [settlingDirect, setSettlingDirect] = useState(false);
  const [repaymentKey, setRepaymentKey] = useState(() => newIdempotencyKey('BORROWING_REPAYMENT'));

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveRepayment(event) {
    event.preventDefault();
    if (saving || !borrowing) return;
    setSaving(true);
    try {
      const result = await recordBorrowingRepayment(borrowing.Id, form, repaymentKey);
      toast.success(result.duplicate ? 'This repayment was already recorded.' : 'Repayment recorded.');
      if (!result.summarySynced) toast.warning('Repayment saved, but the summary did not refresh. Retry to reconcile it.');
      setForm({
        repaymentDate_c: todayLocalDate(),
        principalAmount_c: '',
        interestAmount_c: '',
        paymentMethod_c: 'Cash',
        paidFromAccount_c: '',
        notes_c: '',
        attachments_c: [],
      });
      setRepaymentKey(newIdempotencyKey('BORROWING_REPAYMENT'));
      setShowRepaymentForm(false);
      await Promise.all([reloadBorrowing(), reloadRepayments()]);
    } catch (saveError) {
      toast.error('Could not record repayment', { description: saveError.message || String(saveError) });
    } finally {
      setSaving(false);
    }
  }

  async function retryDirectPayment() {
    if (!borrowing || settlingDirect) return;
    setSettlingDirect(true);
    try {
      await settleDirectSupplierPayment(borrowing.Id);
      toast.success('Supplier payment recorded against the borrowing. No cash or bank receipt was created.');
      await Promise.all([reloadBorrowing(), reloadRepayments(), reloadPurchase()]);
    } catch (saveError) {
      toast.error('Supplier payment is still pending', { description: saveError.message || String(saveError) });
    } finally {
      setSettlingDirect(false);
    }
  }

  if (loading && borrowing === undefined) {
    return <div className="mx-auto max-w-5xl space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-36 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }

  if (error || !borrowing) {
    return <div className="mx-auto max-w-3xl space-y-3"><h1 className="font-heading text-2xl font-semibold">Borrowing not found</h1><p className="text-sm text-muted-foreground">{String(error || 'This record may have been removed or you may not have access.')}</p><Button variant="outline" onClick={() => reloadBorrowing()}>Retry</Button><Button asChild variant="ghost"><Link to="/borrowings">Back to borrowings</Link></Button></div>;
  }

  const principalOutstanding = Math.max(0, amount(borrowing.amountBorrowed_c) - amount(borrowing.amountRepaid_c));
  const canRepay = principalOutstanding > 0.005 && borrowing.status_c !== 'Reversed';
  const availableToUse = borrowing.fundingType_c === 'Received by business'
    ? Math.max(0, amount(borrowing.amountBorrowed_c) - amount(borrowing.amountApplied_c) - amount(borrowing.amountRepaid_c))
    : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm"><Link to="/borrowings"><ApperIcon name="ArrowLeft" size={16} /> Back to borrowings</Link></Button>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Borrowing record</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{borrowing.borrowingRef_c}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Lender: <strong className="text-foreground">{borrowing.lender_c?.Name || 'Unknown lender'}</strong> · Borrowed {dateLabel(borrowing.borrowingDate_c)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge status={borrowing.status_c} /><span className="rounded-sm border border-border px-2 py-1 text-xs">{borrowing.fundingType_c === 'Paid directly to supplier' ? 'Direct supplier payment' : 'Received by business'}</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRepay && <Button className="rounded-sm" onClick={() => setShowRepaymentForm((value) => !value)}><ApperIcon name="Plus" size={16} /> Record repayment</Button>}
          {borrowing.fundingType_c === 'Paid directly to supplier' && borrowing.directPaymentStatus_c !== 'Recorded' && <Button variant="outline" className="rounded-sm" onClick={retryDirectPayment} disabled={settlingDirect}>{settlingDirect ? 'Recording supplier payment…' : 'Retry supplier payment'}</Button>}
        </div>
      </div>
      {borrowing.fundingType_c === 'Paid directly to supplier' && borrowing.directPaymentStatus_c !== 'Recorded' && (
        <div className="border border-warning-border bg-warning-muted/40 p-4 text-sm text-warning-foreground">
          The borrowing has been recorded, but the supplier bill payment has not been confirmed. Retry after checking the bill balance. No cash or bank receipt has been created.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Original principal" value={formatInr(borrowing.amountBorrowed_c)} note={dateLabel(borrowing.borrowingDate_c) + ' · ' + (borrowing.receivedMethod_c || 'Method not recorded')} icon="Wallet" />
        <Metric label="Principal repaid" value={formatInr(borrowing.amountRepaid_c)} note="Interest payments are kept separate" icon="ArrowDownLeft" />
        <Metric label="Outstanding principal" value={formatInr(principalOutstanding)} note={borrowing.dueDate_c ? 'Expected by ' + dateLabel(borrowing.dueDate_c) : 'No repayment date recorded'} icon="CircleDollarSign" />
        <Metric label="Unallocated received funds" value={formatInr(availableToUse)} note={borrowing.fundingType_c === 'Received by business' ? 'Available for purchase payments in this preview' : 'Direct supplier funds are not available as cash'} icon="Landmark" />
      </div>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="border border-border bg-card">
          <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Borrowing details</h2></div>
          <dl className="grid sm:grid-cols-2">
            <div className="border-b border-border/70 px-5 py-4"><dt className="text-xs text-muted-foreground">Purpose</dt><dd className="mt-1 text-sm font-medium">{borrowing.purpose_c}</dd></div>
            <div className="border-b border-border/70 px-5 py-4"><dt className="text-xs text-muted-foreground">Destination account</dt><dd className="mt-1 text-sm font-medium">{borrowing.destinationAccount_c || 'Not applicable'}</dd></div>
            <div className="border-b border-border/70 px-5 py-4"><dt className="text-xs text-muted-foreground">Interest terms</dt><dd className="mt-1 text-sm font-medium">{amount(borrowing.interestRate_c) > 0 ? String(borrowing.interestRate_c) + '% · ' + borrowing.interestType_c : 'No interest specified'}</dd></div>
            <div className="border-b border-border/70 px-5 py-4"><dt className="text-xs text-muted-foreground">Repayment terms</dt><dd className="mt-1 text-sm font-medium">{borrowing.repaymentTerms_c || 'Not recorded'}</dd></div>
            <div className="border-b border-border/70 px-5 py-4 sm:col-span-2"><dt className="text-xs text-muted-foreground">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-sm font-medium">{borrowing.notes_c || '—'}</dd></div>
            <div className="px-5 py-4 sm:col-span-2"><dt className="text-xs text-muted-foreground">Linked purchase</dt><dd className="mt-1 text-sm font-medium">{purchaseId ? (purchase?.purchaseRef_c || borrowing.relatedPurchase_c?.Name || 'Linked purchase') : 'No purchase linked'}{purchaseId && purchase && <span className="ml-2 text-muted-foreground">· supplier balance {formatInr(purchase.outstandingBalance_c)}</span>}</dd>{purchaseId && <Link to={'/purchases/' + purchaseId} className="mt-1 inline-block text-xs text-primary hover:underline">Open purchase bill</Link>}</div>
          </dl>
        </div>
        <div className="border border-border bg-card">
          <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Repayment history</h2><p className="mt-1 text-xs text-muted-foreground">Principal reduces the liability. Interest is tracked as a separate amount.</p></div>
          {repaymentError ? <div className="p-5 text-sm text-destructive">{String(repaymentError)}</div> : repaymentLoading && repayments === undefined ? <div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : !(repayments ?? []).length ? <div className="p-8 text-center"><ApperIcon name="ReceiptText" size={24} className="mx-auto text-muted-foreground" /><p className="mt-2 font-semibold">No repayments yet</p><p className="mt-1 text-sm text-muted-foreground">Repayments will appear here after recording them.</p></div> : (
            <div className="divide-y divide-border">
              {(repayments ?? []).map((row) => <div key={row.Id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{row.repaymentRef_c}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(row.repaymentDate_c)} · {row.paymentMethod_c}{row.paidFromAccount_c ? ' · ' + row.paidFromAccount_c : ''}</p></div><p className="text-right font-semibold tabular-nums">{formatInr(amount(row.principalAmount_c) + amount(row.interestAmount_c))}</p></div><div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span>Principal: {formatInr(row.principalAmount_c)}</span><span>Interest: {formatInr(row.interestAmount_c)}</span></div>{row.notes_c && <p className="mt-2 text-sm text-muted-foreground">{row.notes_c}</p>}</div>)}
            </div>
          )}
        </div>
      </section>

      {showRepaymentForm && canRepay && (
        <section className="border border-highlight/30 bg-highlight/5 p-5">
          <div className="mb-4"><p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-highlight">Repayment entry</p><h2 className="mt-2 font-heading text-xl font-semibold">Record a repayment</h2><p className="mt-1 text-sm text-muted-foreground">Principal remaining: <strong>{formatInr(principalOutstanding)}</strong>. Interest is optional and does not reduce principal.</p></div>
          <form onSubmit={saveRepayment} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5"><label htmlFor="repayment-date" className="text-sm font-medium">Repayment date *</label><Input id="repayment-date" type="date" required value={form.repaymentDate_c} onChange={(event) => setField('repaymentDate_c', event.target.value)} className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="principal-amount" className="text-sm font-medium">Principal paid (₹)</label><Input id="principal-amount" type="number" min="0" max={principalOutstanding} step="0.01" value={form.principalAmount_c} onChange={(event) => setField('principalAmount_c', event.target.value)} placeholder="0.00" className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="interest-amount" className="text-sm font-medium">Interest paid (₹)</label><Input id="interest-amount" type="number" min="0" step="0.01" value={form.interestAmount_c} onChange={(event) => setField('interestAmount_c', event.target.value)} placeholder="0.00" className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="repayment-method" className="text-sm font-medium">Payment method *</label><select id="repayment-method" value={form.paymentMethod_c} onChange={(event) => setField('paymentMethod_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Other</option></select></div>
            <div className="space-y-1.5"><label htmlFor="paid-from-account" className="text-sm font-medium">Cash / bank account</label><Input id="paid-from-account" value={form.paidFromAccount_c} onChange={(event) => setField('paidFromAccount_c', event.target.value)} placeholder="Account name (optional)" className="rounded-sm" /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Receipt (optional)</label><FilePicker value={form.attachments_c} onChange={(files) => setField('attachments_c', files)} fieldConfig={FILE_CONFIG} maxFiles={1} /></div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-3"><label htmlFor="repayment-notes" className="text-sm font-medium">Notes</label><Textarea id="repayment-notes" value={form.notes_c} onChange={(event) => setField('notes_c', event.target.value)} rows={2} placeholder="Optional repayment details" /></div>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-3"><Button type="submit" disabled={saving || (amount(form.principalAmount_c) <= 0 && amount(form.interestAmount_c) <= 0) || amount(form.principalAmount_c) > principalOutstanding + 0.005} className="rounded-sm">{saving ? 'Saving repayment…' : 'Save repayment'}</Button><Button type="button" variant="outline" disabled={saving} className="rounded-sm" onClick={() => setShowRepaymentForm(false)}>Cancel</Button></div>
          </form>
        </section>
      )}
    </div>
  );
}
