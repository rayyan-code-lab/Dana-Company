import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { todayLocalDate } from '@/services/periods';
import { formatInr, newIdempotencyKey } from '@/services/purchaseWorkflow';
import { getOwnerFunding, recordOwnerFundingReimbursement } from '@/services/borrowingWorkflow';

export const route = { path: '/owner-funding', layout: 'owner', access: "profile === 'Admin_c'" };
export const nav = { icon: 'HandCoins', label: 'Owner funding', section: 'Finance', profiles: ['Admin_c'], order: 44 };

const dateLabel = (value) => value ? formatLocalDate(value, DATE_FORMATS.SHORT) : '—';
const amount = (value) => Number(value ?? 0);

function StatusBadge({ status }) {
  const classes = status === 'Reimbursed' || status === 'Owner Contribution'
    ? 'border-success-border bg-success-muted text-success'
    : status === 'Partially Reimbursed'
      ? 'border-warning-border bg-warning-muted text-warning-foreground'
      : 'border-border bg-muted text-muted-foreground';
  return <span className={'inline-flex rounded-sm border px-2 py-1 text-xs font-semibold ' + classes}>{status}</span>;
}

export default function OwnerFundingPage() {
  const { data, loading, error, run } = useFetch(getOwnerFunding, []);
  const [search, setSearch] = useState('');
  const [treatment, setTreatment] = useState('All');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ reimbursementDate_c: todayLocalDate(), amount_c: '', paymentMethod_c: 'Cash', notes_c: '' });
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(() => newIdempotencyKey('OWNER_REIMBURSEMENT'));
  const pageSize = 10;
  const rows = data ?? [];

  const totals = rows.reduce((result, row) => {
    result.funded += amount(row.amount_c);
    result.reimbursed += amount(row.amountReimbursed_c);
    result.outstanding += amount(row.outstandingReimbursement_c);
    return result;
  }, { funded: 0, reimbursed: 0, outstanding: 0 });

  const filtered = useMemo(() => rows.filter((row) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [row.fundingRef_c, row.fundingPerson_c, row.relatedPurchase_c?.Name, row.relatedExpense_c].join(' ').toLowerCase().includes(query);
    const matchesTreatment = treatment === 'All' || row.fundingTreatment_c === treatment;
    return matchesSearch && matchesTreatment;
  }), [rows, search, treatment]);

  useEffect(() => setPage(1), [search, treatment]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  async function saveReimbursement(event) {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    try {
      const result = await recordOwnerFundingReimbursement(selected.Id, form, key);
      toast.success(result.duplicate ? 'This reimbursement was already recorded.' : 'Owner reimbursement recorded.');
      if (!result.summarySynced) toast.warning('Reimbursement saved, but the summary needs a refresh.');
      setSelected(null);
      setForm({ reimbursementDate_c: todayLocalDate(), amount_c: '', paymentMethod_c: 'Cash', notes_c: '' });
      setKey(newIdempotencyKey('OWNER_REIMBURSEMENT'));
      await run();
    } catch (saveError) {
      toast.error('Could not record reimbursement', { description: saveError.message || String(saveError) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / owner funds</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Owner funding</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Keep personal money used for business separate from third-party borrowings and distinguish repayable amounts from owner contributions.</p></div>
        <Button asChild className="rounded-sm"><Link to="/owner-funding/new"><ApperIcon name="Plus" size={16} /> Record owner funding</Link></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border border-border bg-card p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Owner funding recorded</p><p className="mt-3 font-heading text-2xl font-semibold">{formatInr(totals.funded)}</p></div>
        <div className="border border-border bg-card p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Reimbursed</p><p className="mt-3 font-heading text-2xl font-semibold">{formatInr(totals.reimbursed)}</p></div>
        <div className="border border-border bg-card p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Due to owner</p><p className="mt-3 font-heading text-2xl font-semibold">{formatInr(totals.outstanding)}</p><p className="mt-1 text-xs text-muted-foreground">Contributions are not included in this liability.</p></div>
      </div>
      <section className="border border-border bg-card">
        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(240px,1fr)_220px]">
          <div className="relative"><ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search owner funding" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search owner, reference or linked record…" className="rounded-sm pl-9" /></div>
          <select aria-label="Funding treatment" value={treatment} onChange={(event) => setTreatment(event.target.value)} className="h-9 rounded-sm border border-input bg-background px-3 text-sm"><option value="All">All funding types</option><option value="Repayable to owner">Repayable to owner</option><option value="Owner contribution">Owner contribution</option></select>
        </div>
        {error ? <div className="p-10 text-center"><p className="font-semibold">Could not load owner funding</p><p className="mt-1 text-sm text-muted-foreground">{String(error)}</p><Button className="mt-3" variant="outline" onClick={() => run()}>Retry</Button></div> : loading && data === undefined ? <div className="space-y-3 p-4"><div className="h-10 animate-pulse bg-muted" /><div className="h-10 animate-pulse bg-muted" /></div> : !filtered.length ? <div className="p-10 text-center"><ApperIcon name="HandCoins" size={25} className="mx-auto text-muted-foreground" /><h2 className="mt-3 font-heading text-xl font-semibold">No owner-funded transactions</h2><p className="mt-1 text-sm text-muted-foreground">Record personal funds used for a business expense or purchase, then choose whether the money is repayable.</p><Button asChild className="mt-4 rounded-sm"><Link to="/owner-funding/new">Record owner funding</Link></Button></div> : (
          <>
            <div className={loading ? 'overflow-x-auto opacity-60 transition-opacity' : 'overflow-x-auto'} aria-busy={loading}>
              <table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Reference / funded by</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Treatment</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Reimbursed</th><th className="px-4 py-3 text-right">Outstanding</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead>
                <tbody className="divide-y divide-border">{visible.map((row) => <tr key={row.Id} className={row.fundingTreatment_c === 'Owner contribution' ? 'bg-success/5' : row.status_c === 'Partially Reimbursed' ? 'bg-warning/5' : ''}>
                  <td className="px-4 py-3"><p className="font-semibold">{row.fundingRef_c}</p><p className="mt-1 text-xs text-muted-foreground">{row.fundingPerson_c}</p><p className="mt-1 text-xs text-muted-foreground">{row.relatedPurchase_c?.Name || row.relatedExpense_c || 'No linked record'}</p></td>
                  <td className="px-4 py-3">{dateLabel(row.fundingDate_c)}</td>
                  <td className="px-4 py-3">{row.fundingTreatment_c}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatInr(row.amount_c)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatInr(row.amountReimbursed_c)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatInr(row.outstandingReimbursement_c)}</td>
                  <td className="px-4 py-3"><StatusBadge status={row.status_c} /></td>
                  <td className="px-4 py-3">{row.fundingTreatment_c === 'Repayable to owner' && amount(row.outstandingReimbursement_c) > 0.005 ? <Button size="sm" variant="outline" className="rounded-sm" onClick={() => { setSelected(row); setForm({ reimbursementDate_c: todayLocalDate(), amount_c: String(row.outstandingReimbursement_c), paymentMethod_c: 'Cash', notes_c: '' }); setKey(newIdempotencyKey('OWNER_REIMBURSEMENT')); }}>Record reimbursement</Button> : <span className="text-xs text-muted-foreground">No reimbursement due</span>}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} records</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" className="rounded-sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button variant="outline" size="sm" className="rounded-sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
          </>
        )}
      </section>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !saving) setSelected(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reimburse the owner</DialogTitle><DialogDescription>{selected ? 'Outstanding reimbursement: ' + formatInr(selected.outstandingReimbursement_c) + '. This reduces the owner liability; it is not an operating expense.' : ''}</DialogDescription></DialogHeader>
          <form onSubmit={saveReimbursement} className="space-y-4">
            <div className="space-y-1.5"><label htmlFor="owner-reimbursement-date" className="text-sm font-medium">Payment date *</label><Input id="owner-reimbursement-date" type="date" required value={form.reimbursementDate_c} onChange={(event) => setForm((current) => ({ ...current, reimbursementDate_c: event.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="owner-reimbursement-amount" className="text-sm font-medium">Amount reimbursed (₹) *</label><Input id="owner-reimbursement-amount" type="number" min="0.01" step="0.01" max={selected?.outstandingReimbursement_c} required value={form.amount_c} onChange={(event) => setForm((current) => ({ ...current, amount_c: event.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><label htmlFor="owner-reimbursement-method" className="text-sm font-medium">Payment method *</label><select id="owner-reimbursement-method" value={form.paymentMethod_c} onChange={(event) => setForm((current) => ({ ...current, paymentMethod_c: event.target.value }))} className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Other</option></select></div>
            <div className="space-y-1.5"><label htmlFor="owner-reimbursement-notes" className="text-sm font-medium">Notes</label><Input id="owner-reimbursement-notes" value={form.notes_c} onChange={(event) => setForm((current) => ({ ...current, notes_c: event.target.value }))} placeholder="Optional details" className="rounded-sm" /></div>
            <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setSelected(null)} className="rounded-sm">Cancel</Button><Button type="submit" disabled={saving || !selected || amount(form.amount_c) <= 0 || amount(form.amount_c) > amount(selected.outstandingReimbursement_c) + 0.005} className="rounded-sm">{saving ? 'Saving…' : 'Save reimbursement'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
