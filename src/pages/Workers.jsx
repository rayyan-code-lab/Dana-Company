import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sdk, contains, eq, or, isNull } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

const FIELDS = ['Name', 'role_c', 'phone_c', 'dailyRate_c', 'status_c', 'joinedOn_c', 'notes_c', 'workerType_c', 'payType_c', 'monthlySalary_c'];

export const route = { path: '/workers', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'Users', label: 'Workers', section: 'People', order: 30 };
const PAGE_SIZE = 25;

const cash = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value ?? 0));

async function loadWorkers(search, status, type, page) {
  let query = sdk.table('workers_c').select(FIELDS);
  if (search.trim()) query = query.where(contains('Name', search.trim()));
  if (status !== 'All') query = query.where(eq('status_c', status));
  query = query.where(or(eq('isArchived_c', false), isNull('isArchived_c')));
  if (type !== 'All') query = query.where(type === 'Regular' ? or(eq('workerType_c', type), isNull('workerType_c'), eq('workerType_c', '')) : eq('workerType_c', type));
  const response = await query.orderBy('Name').page(page, PAGE_SIZE).fetch();
  if (!response.success) throw new Error(response.message || 'Could not load workers.');
  return { rows: response.data, total: response.total, hasMore: response.hasMore };
}

export default function WorkersPage() {
  const { profile } = useProfile();
  const access = getTableAccess(profile, 'workers_c');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, statusFilter, typeFilter]);
  const { data, loading, error, run } = useFetch(() => loadWorkers(search, statusFilter, typeFilter, page), [search, statusFilter, typeFilter, page]);
  const workers = data?.rows ?? [];
  const [archiving, setArchiving] = useState(false);

  async function refresh() {
    try {
      await run();
    } catch (refreshError) {
      toast.error('Could not refresh workers.', { description: refreshError.message ?? String(refreshError) });
    }
  }

  async function archiveWorker(worker) {
    setArchiving(true);
    try {
      const res = await sdk.table('workers_c').update({ Id: worker.Id, isArchived_c: true });
      if (res.messages.length) {
        toast.error(res.messages[0], { description: res.messages.slice(1).join('\n') || undefined, duration: 8000 });
        console.error(`workers_c archive failed: ${res.messages.join('; ')}`);
        return;
      }
      if (!res.data.length) return;
      toast.success(worker.Name + ' was removed from the register.');
      refresh();
    } catch (archiveError) {
      toast.error('Could not remove worker.', { description: archiveError.message ?? String(archiveError) });
      console.error(`workers_c archive failed: ${archiveError.message ?? String(archiveError)}`);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">People / Register</p>
          <h1 className="font-heading text-3xl font-semibold">Workers</h1>
          <p className="mt-2 text-sm text-muted-foreground">Manage worker roles, phone numbers, joining dates, and daily wage rates. Inactive profiles remain available for historical records.</p>
        </div>
        {access.canCreate && <Button asChild className="min-h-10 rounded-sm"><Link to="/workers/new"><ApperIcon name="Plus" size={16} /> Add worker</Link></Button>}
      </header>

      <div className="grid gap-3 sm:grid-cols-[minmax(200px,1fr)_180px_180px]">
        <div className="relative">
          <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search worker name…" className="min-h-10 rounded-sm pl-9" aria-label="Search workers" />
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by worker status" className="min-h-10 rounded-sm border border-input bg-background px-3 text-sm">
          <option value="All">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by worker type" className="min-h-10 rounded-sm border border-input bg-background px-3 text-sm">
          <option value="All">All worker types</option>
          <option value="Regular">Regular</option>
          <option value="Temporary">Temporary</option>
        </select>
      </div>

      <section className="overflow-hidden border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Worker register</h2><span className="text-xs text-muted-foreground">{data?.total ?? 0} workers</span></div>
        {loading && !data ? <div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          : error ? <div className="p-6"><p className="font-medium">Workers could not be loaded.</p><p className="mt-1 text-sm text-muted-foreground">{String(error?.message ?? error)}</p><Button className="mt-3 rounded-sm" variant="outline" onClick={refresh}>Retry</Button></div>
            : workers.length === 0 ? <div className="p-10 text-center"><ApperIcon name="Users" size={28} className="mx-auto text-muted-foreground" /><p className="mt-3 font-semibold">No workers found</p><p className="mt-1 text-sm text-muted-foreground">Add a worker or adjust your filters.</p>{access.canCreate && <Button asChild className="mt-4 rounded-sm"><Link to="/workers/new">Add worker</Link></Button>}</div>
              : <div className="overflow-x-auto" aria-busy={loading}><table className="w-full min-w-[880px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Worker</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Default daily wage</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-border">{workers.map((worker) => (
                <tr key={worker.Id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3"><Link to={'/workers/' + worker.Id} className="font-semibold text-primary hover:underline">{worker.Name}</Link><p className="mt-1 text-xs text-muted-foreground">{worker.phone_c || 'No phone recorded'}</p></td>
                  <td className="px-4 py-3">{worker.role_c || '—'}</td>
                  <td className="px-4 py-3">{worker.workerType_c || 'Regular'}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{worker.payType_c === 'Monthly Salary' ? cash(worker.monthlySalary_c) + ' / month' : cash(worker.dailyRate_c) + ' / day'}</td>
                  <td className="px-4 py-3"><span className={'inline-flex border px-2 py-1 text-xs ' + (worker.status_c === 'Active' ? 'border-success-border bg-success-muted text-success' : 'border-border bg-muted text-muted-foreground')}>{worker.status_c || 'Active'}</span></td>
                  <td className="px-4 py-3 whitespace-nowrap">{worker.joinedOn_c ? formatLocalDate(worker.joinedOn_c, DATE_FORMATS.SHORT) : '—'}</td>
                  <td className="px-4 py-3"><div className="flex gap-2"><Button asChild size="sm" variant="outline" className="rounded-sm"><Link to={'/workers/' + worker.Id}>Statement</Link></Button>{access.canUpdate && <Button asChild size="sm" variant="outline" className="rounded-sm"><Link to={'/workers/' + worker.Id + '/edit'}>Edit</Link></Button>}{access.canDelete && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button size="sm" variant="outline" className="rounded-sm text-destructive"><ApperIcon name="Trash2" size={14} /> Remove</Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Remove {worker.Name}?</AlertDialogTitle><AlertDialogDescription>The worker will be hidden from the register. Their attendance, payments, and wage history are kept.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => archiveWorker(worker)} disabled={archiving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove worker</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}</div></td>
                </tr>
              ))}</tbody></table></div>}
      </section>
      {!error && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Page {page}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading || page === 1} onClick={() => setPage((current) => current - 1)} className="rounded-sm active:scale-[0.98]">Previous</Button><Button variant="outline" disabled={loading || !data?.hasMore} onClick={() => setPage((current) => current + 1)} className="rounded-sm active:scale-[0.98]">Next</Button></div></div>}
      <p className="text-xs text-muted-foreground">Removed workers are hidden from this register, but their attendance, payments, and wage history stay linked.</p>
    </div>
  );
}
