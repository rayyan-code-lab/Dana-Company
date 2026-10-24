import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { sdk } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { todayLocalDate } from '@/services/periods';

const FIELDS = ['Name', 'role_c', 'phone_c', 'dailyRate_c', 'status_c', 'joinedOn_c', 'notes_c', 'workerType_c', 'payType_c', 'monthlySalary_c'];
const ROLES = ['Operator', 'Machine Operator', 'Supervisor', 'Loader', 'Driver', 'Helper', 'Storekeeper', 'Other'];
const PAY_TYPES = ['Daily Wage', 'Monthly Salary'];

export const route = { path: '/workers/:id/edit', layout: 'owner', access: 'authenticated' };

function buildForm(worker) {
  return {
    Name: worker?.Name ?? '',
    role_c: worker?.role_c ?? 'Helper',
    phone_c: worker?.phone_c ?? '',
    dailyRate_c: String(worker?.dailyRate_c ?? ''),
    status_c: worker?.status_c ?? 'Active',
    joinedOn_c: worker?.joinedOn_c?.slice(0, 10) ?? todayLocalDate(),
    notes_c: worker?.notes_c ?? '',
    workerType_c: worker?.workerType_c ?? 'Regular',
    payType_c: worker?.payType_c ?? 'Daily Wage',
    monthlySalary_c: String(worker?.monthlySalary_c ?? ''),
  };
}

export default function WorkerEditPage({ create = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const access = getTableAccess(profile, 'workers_c');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => buildForm(null));
  const { data: worker, loading, error, run } = useFetch(async () => {
    if (create) return null;
    const response = await sdk.table('workers_c').select(FIELDS).get(id);
    return response.data;
  }, [id, create]);

  useEffect(() => {
    setForm(buildForm(worker));
  }, [worker]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (saving || !(create ? access.canCreate : access.canUpdate)) return;
    const isMonthly = form.payType_c === 'Monthly Salary';
    const salary = Number(form.monthlySalary_c);
    const wage = isMonthly ? Math.round((salary / 30) * 100) / 100 : Number(form.dailyRate_c);
    if (!form.Name?.trim()) return toast.error('Enter the worker name.');
    if (isMonthly && (!Number.isFinite(salary) || salary <= 0)) return toast.error('Monthly salary must be greater than zero.');
    if (!Number.isFinite(wage) || wage <= 0) return toast.error('Daily wage must be greater than zero.');
    if (!form.joinedOn_c) return toast.error('Choose a joining date.');

    setSaving(true);
    try {
      const payload = {
        Name: form.Name.trim(),
        role_c: form.role_c,
        phone_c: form.phone_c.trim(),
        dailyRate_c: wage,
        status_c: form.status_c,
        joinedOn_c: form.joinedOn_c,
        notes_c: form.notes_c.trim(),
        workerType_c: form.workerType_c,
        payType_c: form.payType_c,
        monthlySalary_c: isMonthly ? salary : 0,
      };
      const response = create
        ? await sdk.table('workers_c').create(payload)
        : await sdk.table('workers_c').update({ Id: id, ...payload });
      if (response.messages.length) {
        toast.error(response.messages[0], { description: response.messages.slice(1).join('\n') || undefined });
        console.error(`workers_c save failed: ${response.messages.join('; ')}`);
      }
      if (!response.data.length) return;
      await run();
      toast.success(create ? 'Worker added.' : 'Worker profile updated. Past attendance wage snapshots were not changed.');
      navigate(create ? '/workers' : '/workers/' + id);
    } catch (saveError) {
      toast.error('Could not save worker details.', { description: saveError.message ?? String(saveError) });
      console.error(`workers_c save failed: ${saveError.message ?? String(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  if (!(create ? access.canCreate : access.canUpdate)) return <div className="space-y-3"><p>You do not have permission to manage worker profiles.</p><Button asChild variant="outline"><Link to="/workers">Back to workers</Link></Button></div>;
  if (loading && !worker) return <div className="space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-72 w-full" /></div>;
  if (error || (!create && !worker)) return <div className="space-y-3"><h1 className="font-heading text-2xl font-semibold">{error ? 'Could not load worker' : 'Worker not found'}</h1><p className="text-sm text-muted-foreground">{String(error?.message ?? error ?? 'The worker could not be loaded.')}</p>{error && <Button variant="outline" onClick={run}>Retry</Button>}<Button asChild variant="outline"><Link to="/workers">Back to workers</Link></Button></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm"><Link to={create ? '/workers' : '/workers/' + id}><ApperIcon name="ArrowLeft" size={16} /> {create ? 'Back to workers' : 'Back to worker statement'}</Link></Button>
      <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">People / Worker profile</p><h1 className="font-heading text-3xl font-semibold">{create ? 'Add worker' : 'Edit ' + worker.Name}</h1><p className="mt-2 text-sm text-muted-foreground">Changes to the default daily wage apply to future attendance only.</p></div>
      <form onSubmit={save} className="space-y-6 border border-border bg-card p-5 md:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Worker name *" id="edit-worker-name"><Input id="edit-worker-name" value={form.Name ?? ''} onChange={(event) => setField('Name', event.target.value)} required placeholder="Full name" className="min-h-10 rounded-sm" /></Field>
          <Field label="Role *" id="edit-worker-role"><select id="edit-worker-role" value={form.role_c ?? ''} onChange={(event) => setField('role_c', event.target.value)} required className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select></Field>
          <Field label="Phone number" id="edit-worker-phone"><Input id="edit-worker-phone" type="tel" autoComplete="tel" value={form.phone_c ?? ''} onChange={(event) => setField('phone_c', event.target.value)} placeholder="Optional phone number" className="min-h-10 rounded-sm" /></Field>
          {form.payType_c !== 'Monthly Salary' && <Field label="Default daily wage (₹) *" id="edit-worker-rate"><Input id="edit-worker-rate" type="number" min="0.01" step="0.01" value={form.dailyRate_c ?? ''} onChange={(event) => setField('dailyRate_c', event.target.value)} required placeholder="0.00" className="min-h-10 rounded-sm" /></Field>}
          <Field label="Pay type *" id="edit-worker-pay-type"><select id="edit-worker-pay-type" value={form.payType_c ?? 'Daily Wage'} onChange={(event) => setField('payType_c', event.target.value)} required className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">{PAY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
          {form.payType_c === 'Monthly Salary' && <Field label="Monthly salary (₹) *" id="edit-worker-salary"><Input id="edit-worker-salary" type="number" min="0.01" step="0.01" value={form.monthlySalary_c ?? ''} onChange={(event) => setField('monthlySalary_c', event.target.value)} required placeholder="0.00" className="min-h-10 rounded-sm" /><p className="mt-1 text-xs text-muted-foreground">Attendance is valued at monthly salary ÷ 30 per day.</p></Field>}
          <Field label="Worker type *" id="edit-worker-type"><select id="edit-worker-type" value={form.workerType_c ?? 'Regular'} onChange={(event) => setField('workerType_c', event.target.value)} required className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option value="Regular">Regular</option><option value="Temporary">Temporary</option></select></Field>
          <Field label="Status *" id="edit-worker-status"><select id="edit-worker-status" value={form.status_c ?? 'Active'} onChange={(event) => setField('status_c', event.target.value)} required className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm"><option value="Active">Active</option><option value="Inactive">Inactive</option></select></Field>
          <Field label="Joining date *" id="edit-worker-joined"><Input id="edit-worker-joined" type="date" value={form.joinedOn_c ?? ''} onChange={(event) => setField('joinedOn_c', event.target.value)} required className="min-h-10 rounded-sm" /></Field>
          <div className="sm:col-span-2"><label htmlFor="edit-worker-notes" className="mb-1.5 block text-sm font-medium">Notes</label><Textarea id="edit-worker-notes" value={form.notes_c ?? ''} onChange={(event) => setField('notes_c', event.target.value)} placeholder="Optional worker notes" rows={3} /></div>
        </div>
        <div className="flex flex-col-reverse justify-between gap-3 border-t border-border pt-5 sm:flex-row"><Button asChild type="button" variant="outline" className="rounded-sm"><Link to={create ? '/workers' : '/workers/' + id}>Cancel</Link></Button><Button type="submit" disabled={saving} className="min-h-10 rounded-sm">{saving ? 'Saving…' : create ? 'Add worker' : 'Save changes'}</Button></div>
      </form>
    </div>
  );
}

function Field({ label, id, children }) {
  return <div><label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>{children}</div>;
}
