import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import FilePicker from '@/components/FilePicker';
import ApperIcon from '@/components/ApperIcon';
import { toast } from 'sonner';
import { todayLocalDate } from '@/services/periods';
import { formatInr, newIdempotencyKey } from '@/services/purchaseWorkflow';
import { getBorrowings, getLenders, createBorrowing } from '@/services/borrowingWorkflow';
import { getPurchases } from '@/services/purchaseWorkflow';

export const route = { path: '/borrowings/new', layout: 'owner', access: "profile === 'Admin_c'" };

const RECEIVING_METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Other'];
const PURPOSES = ['Purchase payment', 'Wages', 'Transportation', 'Operating expenses', 'Other'];
const INTEREST_TYPES = ['None', 'Flat', 'Annual', 'Monthly'];
const FILE_CONFIG = { label: 'Borrowing receipt or supporting document', type: 'Files', supportMultipleValues: false, supportedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'], minValue: 0, maxValue: 10240 };

export default function BorrowingNewPage() {
  const navigate = useNavigate();
  const { data: lenders, loading: lendersLoading, error: lendersError, run: reloadLenders } = useFetch(getLenders, []);
  const { data: purchases, loading: purchasesLoading, error: purchasesError } = useFetch(getPurchases, []);
  const [lenderMode, setLenderMode] = useState('existing');
  const [form, setForm] = useState({
    lender_c: '',
    lenderName_c: '',
    lenderPhone_c: '',
    lenderRelationship_c: 'Friend',
    amountBorrowed_c: '',
    borrowingDate_c: todayLocalDate(),
    fundingType_c: 'Received by business',
    receivedMethod_c: 'Cash',
    destinationAccount_c: 'Cash account',
    purpose_c: 'Purchase payment',
    relatedPurchase_c: '',
    interestRate_c: '',
    interestType_c: 'None',
    repaymentTerms_c: '',
    dueDate_c: '',
    notes_c: '',
    attachments_c: [],
  });
  const [saving, setSaving] = useState(false);
  const [submissionKey] = useState(() => newIdempotencyKey('BORROWING_FORM'));

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const direct = form.fundingType_c === 'Paid directly to supplier';
  const purchaseChoices = (purchases ?? []).filter((purchase) => purchase.recordStatus_c !== 'Cancelled');

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    if (lenderMode === 'existing' && !form.lender_c) {
      toast.error('Choose a lender or switch to creating a new lender.');
      return;
    }
    if (lenderMode === 'new' && !form.lenderName_c.trim()) {
      toast.error('Enter the lender name.');
      return;
    }
    setSaving(true);
    try {
      const result = await createBorrowing({
        ...form,
        lender_c: lenderMode === 'existing' ? form.lender_c : '',
        fundingType_c: direct ? 'Paid directly to supplier' : 'Received by business',
      }, submissionKey);
      toast.success(result.duplicate ? 'This borrowing was already recorded.' : 'Borrowing recorded as ' + result.borrowing.borrowingRef_c + '.');
      if (result.directPaymentPending) {
        toast.warning('Borrowing saved, but the supplier payment is still pending. Open the borrowing details to retry it.', {
          description: result.directPaymentError || 'No cash or bank receipt was created.',
        });
      }
      navigate('/borrowings/' + result.borrowing.Id);
    } catch (error) {
      toast.error('Could not record borrowing', { description: error.message || String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm"><Link to="/borrowings"><ApperIcon name="ArrowLeft" size={16} /> Back to borrowings</Link></Button>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / borrowings</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Record a borrowing</h1>
        <p className="mt-2 text-sm text-muted-foreground">Record the amount once. The form distinguishes funds received by the business from money a lender pays to a supplier directly.</p>
      </div>

      {(lendersError || purchasesError) && <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Some reference data could not load. {(lendersError || purchasesError)?.message || String(lendersError || purchasesError)} <button type="button" className="ml-2 underline" onClick={() => reloadLenders()}>Retry lenders</button></div>}

      <form onSubmit={save} className="space-y-5">
        <section className="border border-border bg-card">
          <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Lender and amount</h2><p className="mt-1 text-xs text-muted-foreground">The borrowing reference is generated automatically when you save.</p></div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="lender-mode" className="text-sm font-medium">Lender</label>
              <select id="lender-mode" value={lenderMode} onChange={(event) => { setLenderMode(event.target.value); setField('lender_c', ''); }} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">
                <option value="existing">Choose existing lender</option>
                <option value="new">Create a new lender</option>
              </select>
            </div>
            {lenderMode === 'existing' ? (
              <div className="space-y-1.5">
                <label htmlFor="existing-lender" className="text-sm font-medium">Lender name *</label>
                {lendersLoading ? <Skeleton className="h-10 w-full" /> : (
                  <select id="existing-lender" required value={form.lender_c} onChange={(event) => setField('lender_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">
                    <option value="">Choose a lender</option>
                    {(lenders ?? []).filter((lender) => lender.status_c !== 'Inactive').map((lender) => <option key={lender.Id} value={lender.Id}>{lender.Name}</option>)}
                  </select>
                )}
                {!lendersLoading && !(lenders ?? []).length && <p className="text-xs text-muted-foreground">No lenders yet. Choose “Create a new lender”.</p>}
              </div>
            ) : (
              <>
                <div className="space-y-1.5"><label htmlFor="new-lender-name" className="text-sm font-medium">New lender name *</label><Input id="new-lender-name" required value={form.lenderName_c} onChange={(event) => setField('lenderName_c', event.target.value)} placeholder="Friend, family member or lender" className="rounded-sm" /></div>
                <div className="space-y-1.5"><label htmlFor="new-lender-phone" className="text-sm font-medium">Phone (optional)</label><Input id="new-lender-phone" value={form.lenderPhone_c} onChange={(event) => setField('lenderPhone_c', event.target.value)} placeholder="Contact number" className="rounded-sm" /></div>
                <div className="space-y-1.5"><label htmlFor="new-lender-relationship" className="text-sm font-medium">Relationship</label><select id="new-lender-relationship" value={form.lenderRelationship_c} onChange={(event) => setField('lenderRelationship_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option>Friend</option><option>Family</option><option>Private lender</option><option>Other</option></select></div>
              </>
            )}
            <div className="space-y-1.5"><label htmlFor="borrowing-amount" className="text-sm font-medium">Amount borrowed (₹) *</label><Input id="borrowing-amount" type="number" required min="0.01" step="0.01" value={form.amountBorrowed_c} onChange={(event) => setField('amountBorrowed_c', event.target.value)} placeholder="0.00" className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="borrowing-date" className="text-sm font-medium">Date received *</label><Input id="borrowing-date" type="date" required value={form.borrowingDate_c} onChange={(event) => setField('borrowingDate_c', event.target.value)} className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="borrowing-purpose" className="text-sm font-medium">Purpose *</label><select id="borrowing-purpose" value={form.purpose_c} onChange={(event) => setField('purpose_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">{PURPOSES.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></div>
          </div>
        </section>

        <section className="border border-border bg-card">
          <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">How the funds were provided</h2><p className="mt-1 text-xs text-muted-foreground">Choose one of the two accounting cases. A direct supplier payment will not create a fake cash or bank receipt.</p></div>
          <div className="space-y-4 p-5">
            <div className="space-y-1.5"><label htmlFor="funding-type" className="text-sm font-medium">Funding type *</label><select id="funding-type" value={form.fundingType_c} onChange={(event) => { const value = event.target.value; setField('fundingType_c', value); if (value === 'Paid directly to supplier') { setField('receivedMethod_c', 'Direct to supplier'); setField('destinationAccount_c', ''); } else { setField('receivedMethod_c', 'Cash'); setField('destinationAccount_c', 'Cash account'); } }} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option value="Received by business">Money received by the business first</option><option value="Paid directly to supplier">Lender paid the supplier directly</option></select></div>
            {direct ? (
              <div className="space-y-4">
                <div className="border border-highlight/30 bg-highlight/5 p-4 text-sm"><p className="font-semibold">Direct supplier payment</p><p className="mt-1 text-muted-foreground">The supplier bill will be settled from the lender liability. The software will not add a cash or bank receipt.</p></div>
                <div className="space-y-1.5"><label htmlFor="direct-purchase" className="text-sm font-medium">Purchase bill paid by lender *</label><select id="direct-purchase" required value={form.relatedPurchase_c} onChange={(event) => setField('relatedPurchase_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option value="">Choose an outstanding purchase</option>{purchaseChoices.filter((purchase) => Number(purchase.outstandingBalance_c ?? 0) > 0 || purchase.paymentStatus_c !== 'Paid').map((purchase) => <option key={purchase.Id} value={purchase.Id}>{purchase.purchaseRef_c || purchase.Name} · {purchase.supplierName_c || 'Supplier'} · {formatInr(purchase.outstandingBalance_c)}</option>)}</select></div>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5"><label htmlFor="received-method" className="text-sm font-medium">Receiving method *</label><select id="received-method" required value={form.receivedMethod_c} onChange={(event) => setField('receivedMethod_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">{RECEIVING_METHODS.map((method) => <option key={method}>{method}</option>)}</select></div>
                <div className="space-y-1.5"><label htmlFor="destination-account" className="text-sm font-medium">Destination account / cash drawer</label><Input id="destination-account" value={form.destinationAccount_c} onChange={(event) => setField('destinationAccount_c', event.target.value)} placeholder="e.g. Main bank or Cash drawer" className="rounded-sm" /></div>
                <div className="space-y-1.5 md:col-span-2"><label htmlFor="related-purchase" className="text-sm font-medium">Related purchase bill (optional)</label><select id="related-purchase" value={form.relatedPurchase_c} onChange={(event) => setField('relatedPurchase_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option value="">No linked purchase</option>{purchaseChoices.map((purchase) => <option key={purchase.Id} value={purchase.Id}>{purchase.purchaseRef_c || purchase.Name} · {purchase.supplierName_c || 'Supplier'}</option>)}</select></div>
              </div>
            )}
          </div>
        </section>

        <section className="border border-border bg-card">
          <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Interest and repayment terms</h2><p className="mt-1 text-xs text-muted-foreground">Leave these blank when no terms have been agreed. The system does not assume interest.</p></div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="interest-rate" className="text-sm font-medium">Interest rate (%)</label><Input id="interest-rate" type="number" min="0" step="0.001" value={form.interestRate_c} onChange={(event) => setField('interestRate_c', event.target.value)} placeholder="Optional" className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="interest-type" className="text-sm font-medium">Interest type</label><select id="interest-type" value={form.interestType_c} onChange={(event) => setField('interestType_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">{INTEREST_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div>
            <div className="space-y-1.5"><label htmlFor="borrowing-due-date" className="text-sm font-medium">Expected repayment date</label><Input id="borrowing-due-date" type="date" value={form.dueDate_c} onChange={(event) => setField('dueDate_c', event.target.value)} className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="repayment-terms" className="text-sm font-medium">Repayment terms</label><Input id="repayment-terms" value={form.repaymentTerms_c} onChange={(event) => setField('repaymentTerms_c', event.target.value)} placeholder="e.g. Repay after next sale" className="rounded-sm" /></div>
            <div className="space-y-1.5 md:col-span-2"><label htmlFor="borrowing-notes" className="text-sm font-medium">Notes</label><Textarea id="borrowing-notes" value={form.notes_c} onChange={(event) => setField('notes_c', event.target.value)} placeholder="Optional context or agreement details" rows={3} /></div>
            <div className="space-y-1.5 md:col-span-2"><label className="text-sm font-medium">Receipt or supporting document (optional)</label><FilePicker value={form.attachments_c} onChange={(files) => setField('attachments_c', files)} fieldConfig={FILE_CONFIG} maxFiles={1} /></div>
          </div>
        </section>

        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button asChild variant="outline" disabled={saving} className="rounded-sm"><Link to="/borrowings">Cancel</Link></Button>
          <Button type="submit" disabled={saving || lendersLoading || purchasesLoading} className="rounded-sm">{saving ? 'Saving borrowing…' : 'Save borrowing'}</Button>
        </div>
      </form>
    </div>
  );
}
