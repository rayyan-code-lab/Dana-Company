import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import FilePicker from '@/components/FilePicker';
import ApperIcon from '@/components/ApperIcon';
import { toast } from 'sonner';
import { todayLocalDate } from '@/services/periods';
import { newIdempotencyKey } from '@/services/purchaseWorkflow';
import { getPurchases } from '@/services/purchaseWorkflow';
import { createOwnerFunding } from '@/services/borrowingWorkflow';

export const route = { path: '/owner-funding/new', layout: 'owner', access: "profile === 'Admin_c'" };

const FILE_CONFIG = { label: 'Receipt / supporting evidence', type: 'Files', supportMultipleValues: false, supportedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'], minValue: 0, maxValue: 10240 };

export default function OwnerFundingNewPage() {
  const navigate = useNavigate();
  const { data: purchases, loading, error } = useFetch(getPurchases, []);
  const [form, setForm] = useState({
    fundingPerson_c: 'Business owner',
    amount_c: '',
    fundingDate_c: todayLocalDate(),
    fundingTreatment_c: 'Repayable to owner',
    relatedPurchase_c: '',
    relatedExpense_c: '',
    notes_c: '',
    attachments_c: [],
  });
  const [saving, setSaving] = useState(false);
  const [key] = useState(() => newIdempotencyKey('OWNER_FUNDING'));
  const repayable = form.fundingTreatment_c === 'Repayable to owner';

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await createOwnerFunding(form, key);
      toast.success(result.duplicate ? 'This owner funding was already recorded.' : 'Owner funding recorded as ' + result.funding.fundingRef_c + '.');
      navigate('/owner-funding');
    } catch (saveError) {
      toast.error('Could not record owner funding', { description: saveError.message || String(saveError) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm"><Link to="/owner-funding"><ApperIcon name="ArrowLeft" size={16} /> Back to owner funding</Link></Button>
      <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / owner funds</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Record owner funding</h1><p className="mt-2 text-sm text-muted-foreground">Use this when business expenses or purchases are paid with personal money. It is separate from a third-party borrowing.</p></div>
      {error && <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Could not load purchases: {String(error)}</div>}

      <form onSubmit={save} className="space-y-5">
        <section className="border border-border bg-card">
          <div className="border-b border-border px-5 py-4"><h2 className="font-heading text-xl font-semibold">Funding details</h2></div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="funding-person" className="text-sm font-medium">Owner / funding person *</label><Input id="funding-person" required value={form.fundingPerson_c} onChange={(event) => setField('fundingPerson_c', event.target.value)} placeholder="Name" className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="owner-funding-amount" className="text-sm font-medium">Amount (₹) *</label><Input id="owner-funding-amount" type="number" required min="0.01" step="0.01" value={form.amount_c} onChange={(event) => setField('amount_c', event.target.value)} placeholder="0.00" className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="owner-funding-date" className="text-sm font-medium">Date *</label><Input id="owner-funding-date" type="date" required value={form.fundingDate_c} onChange={(event) => setField('fundingDate_c', event.target.value)} className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="owner-funding-treatment" className="text-sm font-medium">Treatment *</label><select id="owner-funding-treatment" value={form.fundingTreatment_c} onChange={(event) => setField('fundingTreatment_c', event.target.value)} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option value="Repayable to owner">Repayable to owner</option><option value="Owner contribution">Owner contribution — not repayable</option></select></div>
            <div className="space-y-1.5 md:col-span-2"><label htmlFor="owner-funding-purchase" className="text-sm font-medium">Related purchase bill (optional)</label><select id="owner-funding-purchase" value={form.relatedPurchase_c} onChange={(event) => setField('relatedPurchase_c', event.target.value)} disabled={loading} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option value="">No linked purchase</option>{(purchases ?? []).map((purchase) => <option key={purchase.Id} value={purchase.Id}>{purchase.purchaseRef_c || purchase.Name} · {purchase.supplierName_c || 'Supplier'}</option>)}</select></div>
            <div className="space-y-1.5 md:col-span-2"><label htmlFor="owner-funding-expense" className="text-sm font-medium">Related expense reference (optional)</label><Input id="owner-funding-expense" value={form.relatedExpense_c} onChange={(event) => setField('relatedExpense_c', event.target.value)} placeholder="Expense ID or short description" className="rounded-sm" /></div>
            <div className="space-y-1.5 md:col-span-2"><label htmlFor="owner-funding-notes" className="text-sm font-medium">Notes</label><Textarea id="owner-funding-notes" rows={3} value={form.notes_c} onChange={(event) => setField('notes_c', event.target.value)} placeholder="Optional details about what the personal funds paid for" /></div>
            <div className="space-y-1.5 md:col-span-2"><label className="text-sm font-medium">Receipt / evidence (optional)</label><FilePicker value={form.attachments_c} onChange={(files) => setField('attachments_c', files)} fieldConfig={FILE_CONFIG} maxFiles={1} /></div>
          </div>
        </section>
        <div className={repayable ? 'border border-warning-border bg-warning-muted/40 p-4 text-sm text-warning-foreground' : 'border border-success-border bg-success-muted/40 p-4 text-sm text-success'}>{repayable ? 'This amount creates an owner reimbursement liability. The outstanding balance will reduce only when a reimbursement is recorded.' : 'This is a contribution to the business, not a loan. The system will not create an amount due back to the owner.'}</div>
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row"><Button asChild variant="outline" disabled={saving} className="rounded-sm"><Link to="/owner-funding">Cancel</Link></Button><Button type="submit" disabled={saving || loading} className="rounded-sm">{saving ? 'Saving funding…' : 'Save owner funding'}</Button></div>
      </form>
    </div>
  );
}
