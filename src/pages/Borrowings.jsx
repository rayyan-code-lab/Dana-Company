import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import ApperIcon from '@/components/ApperIcon';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { todayLocalDate } from '@/services/periods';
import { formatInr } from '@/services/purchaseWorkflow';
import { getBorrowings } from '@/services/borrowingWorkflow';

export const route = { path: '/borrowings', layout: 'owner', access: "profile === 'Admin_c'" };
export const nav = { icon: 'Wallet', label: 'Borrowings', section: 'Finance', profiles: ['Admin_c'], order: 43 };

const dateLabel = (value) => value ? formatLocalDate(value, DATE_FORMATS.SHORT) : '—';
const amount = (value) => Number(value ?? 0);
const outstanding = (row) => Math.max(0, amount(row.amountBorrowed_c) - amount(row.amountRepaid_c));
const availableToUse = (row) => row.fundingType_c === 'Received by business'
  ? Math.max(0, amount(row.amountBorrowed_c) - amount(row.amountApplied_c) - amount(row.amountRepaid_c))
  : 0;

function StatusBadge({ status }) {
  const classes = status === 'Fully Repaid'
    ? 'border-success-border bg-success-muted text-success'
    : status === 'Partially Repaid'
      ? 'border-warning-border bg-warning-muted text-warning-foreground'
      : status === 'Reversed'
        ? 'border-destructive/25 bg-destructive/10 text-destructive'
        : 'border-border bg-muted text-muted-foreground';

  return <span className={'inline-flex items-center rounded-sm border px-2 py-1 text-xs font-semibold ' + classes}>{status || 'Outstanding'}</span>;
}

function Metric({ label, value, note, icon }) {
  return (
    <div className="border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-sm bg-primary/10 text-primary"><ApperIcon name={icon} size={17} /></span>
      </div>
      <p className="mt-3 font-heading text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export default function BorrowingsPage() {
  const { data, loading, error, run } = useFetch(getBorrowings, []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState('date-desc');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const rows = data ?? [];

  const activeRows = useMemo(
    () => rows.filter((row) => row.status_c !== 'Reversed'),
    [rows],
  );
  const totalBorrowed = activeRows.reduce((sum, row) => sum + amount(row.amountBorrowed_c), 0);
  const totalOutstanding = activeRows.reduce((sum, row) => sum + outstanding(row), 0);
  const totalRepaid = activeRows.reduce((sum, row) => sum + amount(row.amountRepaid_c), 0);
  const activeCount = activeRows.filter((row) => outstanding(row) > 0.005).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = rows.filter((row) => {
      const relatedPurchase = row.relatedPurchase_c?.Name ?? '';
      const lender = row.lender_c?.Name ?? '';
      const searchable = [row.borrowingRef_c, lender, row.purpose_c, row.notes_c, relatedPurchase].join(' ').toLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      const matchesStatus = statusFilter === 'All' || row.status_c === statusFilter;
      const matchesFrom = !fromDate || String(row.borrowingDate_c) >= fromDate;
      const matchesTo = !toDate || String(row.borrowingDate_c) <= toDate;
      return matchesSearch && matchesStatus && matchesFrom && matchesTo;
    });

    result.sort((a, b) => {
      if (sort === 'amount-desc') return amount(b.amountBorrowed_c) - amount(a.amountBorrowed_c);
      if (sort === 'due-asc') return String(a.dueDate_c || '9999-12-31').localeCompare(String(b.dueDate_c || '9999-12-31'));
      return String(b.borrowingDate_c || '').localeCompare(String(a.borrowingDate_c || ''));
    });
    return result;
  }, [rows, search, statusFilter, fromDate, toDate, sort]);

  useEffect(() => setPage(1), [search, statusFilter, fromDate, toDate, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance / funding</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Borrowings</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Track money borrowed from people, where it went, repayments and the principal still owed.</p>
        </div>
        <Button asChild className="rounded-sm">
          <Link to="/borrowings/new"><ApperIcon name="Plus" size={16} /> Record borrowing</Link>
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total borrowed" value={formatInr(totalBorrowed)} note="Original principal across active records" icon="Wallet" />
        <Metric label="Outstanding principal" value={formatInr(totalOutstanding)} note="Principal remaining to repay" icon="CircleDollarSign" />
        <Metric label="Principal repaid" value={formatInr(totalRepaid)} note="Interest is recorded separately" icon="ArrowDownLeft" />
        <Metric label="Open borrowings" value={String(activeCount)} note="Borrowings with principal outstanding" icon="ListChecks" />
      </div>

      <section className="border border-border bg-card">
        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_190px_160px_160px_180px]">
          <div className="relative">
            <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search borrowings" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lender, reference, purchase…" className="rounded-sm pl-9" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="borrowing-status">Status</label>
            <select id="borrowing-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm">
              {['All', 'Outstanding', 'Partially Repaid', 'Fully Repaid', 'Reversed'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="borrowing-from">Borrowed from</label>
            <Input id="borrowing-from" type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} className="rounded-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="borrowing-to">Borrowed to</label>
            <Input id="borrowing-to" type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} className="rounded-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="borrowing-sort">Sort by</label>
            <select id="borrowing-sort" value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm">
              <option value="date-desc">Newest first</option>
              <option value="due-asc">Due date</option>
              <option value="amount-desc">Largest amount</option>
            </select>
          </div>
        </div>

        {error ? (
          <div className="p-10 text-center">
            <ApperIcon name="CircleAlert" size={28} className="mx-auto text-destructive" />
            <p className="mt-3 font-semibold">Could not load borrowings</p>
            <p className="mt-1 text-sm text-muted-foreground">{String(error)}</p>
            <Button variant="outline" className="mt-4 rounded-sm" onClick={() => run()}>Retry</Button>
          </div>
        ) : loading && data === undefined ? (
          <div className="space-y-3 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : !filtered.length ? (
          <div className="p-12 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-sm bg-muted"><ApperIcon name="Wallet" size={23} /></span>
            <h2 className="mt-3 font-heading text-xl font-semibold">{rows.length ? 'No matching borrowings' : 'No borrowings recorded yet'}</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{rows.length ? 'Try changing the search or filters.' : 'Record money received from a lender or enter a lender-paid supplier bill to begin tracking the liability.'}</p>
            {!rows.length && <Button asChild className="mt-4 rounded-sm"><Link to="/borrowings/new">Record borrowing</Link></Button>}
          </div>
        ) : (
          <>
            <div className={loading ? 'overflow-x-auto opacity-60 transition-opacity' : 'overflow-x-auto'} aria-busy={loading}>
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Lender / reference</th>
                    <th className="px-4 py-3">Date borrowed</th>
                    <th className="px-4 py-3 text-right">Original principal</th>
                    <th className="px-4 py-3 text-right">Repaid</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                    <th className="px-4 py-3">Interest / due date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Available to use</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((row) => (
                    <tr key={row.Id} className={row.status_c === 'Fully Repaid' ? 'bg-success/5' : row.status_c === 'Partially Repaid' ? 'bg-warning/5' : ''}>
                      <td className="px-4 py-3">
                        <Link to={'/borrowings/' + row.Id} className="font-semibold text-primary hover:underline">{row.lender_c?.Name || 'Unknown lender'}</Link>
                        <p className="mt-1 text-xs text-muted-foreground">{row.borrowingRef_c}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{row.fundingType_c === 'Paid directly to supplier' ? 'Direct supplier payment' : row.purpose_c}</p>
                      </td>
                      <td className="px-4 py-3">{dateLabel(row.borrowingDate_c)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatInr(row.amountBorrowed_c)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatInr(row.amountRepaid_c)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatInr(outstanding(row))}</td>
                      <td className="px-4 py-3">
                        <p>{row.interestRate_c > 0 ? String(row.interestRate_c) + '% · ' + (row.interestType_c || 'terms not set') : 'No interest specified'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{row.dueDate_c ? 'Due ' + dateLabel(row.dueDate_c) : 'No due date'}</p>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={row.status_c} /></td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatInr(availableToUse(row))}</td>
                      <td className="px-4 py-3"><Button asChild variant="outline" size="sm" className="rounded-sm"><Link to={'/borrowings/' + row.Id}>View details</Link></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} borrowings</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="rounded-sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
                <span>Page {page} of {pageCount}</span>
                <Button variant="outline" size="sm" className="rounded-sm" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
