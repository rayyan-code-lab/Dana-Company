import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { sdk, lte } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { todayLocalDate, getPeriodRange } from '@/services/periods';
import { calculateWorkerWageSummary, cash, sameWorker } from '@/services/wageCalculations';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import ApperIcon from '@/components/ApperIcon';
import PeriodControls from '@/components/PeriodControls';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const WORKER_FIELDS = ['Name', 'role_c', 'phone_c', 'dailyRate_c', 'status_c', 'joinedOn_c', 'notes_c', 'workerType_c', 'payType_c', 'monthlySalary_c'];
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

async function loadWorkerStatement(id, throughDate) {
  const workerResponse = await sdk.table('workers_c').select(WORKER_FIELDS).get(id);
  if (!workerResponse.success || !workerResponse.data) throw new Error(workerResponse.message || 'Worker not found.');
  const [attendance, payments, legacyPayroll] = await Promise.all([
    fetchAll('attendance_c', ATTENDANCE_FIELDS, lte('attendanceDate_c', throughDate)),
    fetchAll('worker_payments_c', PAYMENT_FIELDS, lte('paymentDate_c', throughDate)),
    fetchAll('payroll_c', PAYROLL_FIELDS),
  ]);
  const worker = workerResponse.data;
  return {
    worker,
    attendance: attendance.filter((row) => sameWorker(row, worker)),
    payments: payments.filter((row) => sameWorker(row, worker)),
    legacyPayroll: legacyPayroll.filter((row) => sameWorker(row, worker)),
  };
}

export const route = { path: '/workers/:id', layout: 'owner', access: 'authenticated' };

export default function WorkerDetailPage() {
  const { id } = useParams();
  const { profile } = useProfile();
  const access = getTableAccess(profile, 'workers_c');
  const [periodType, setPeriodType] = useState('month');
  const [anchorDate, setAnchorDate] = useState(todayLocalDate());
  const range = getPeriodRange(periodType, anchorDate);
  const { data, loading, error, run } = useFetch(() => loadWorkerStatement(id, range.end), [id, range.end]);

  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (error || !data) return <div className="space-y-3"><h1 className="font-heading text-2xl font-semibold">Worker statement unavailable</h1><p className="text-sm text-muted-foreground">{String(error?.message ?? error ?? 'This worker was not found.')}</p><Button onClick={() => run()} variant="outline">Retry</Button><Button asChild variant="ghost"><Link to="/workers">Back to workers</Link></Button></div>;

  const { worker, attendance, payments, legacyPayroll } = data;
  const summary = calculateWorkerWageSummary({ worker, attendance, payments, legacyPayroll, range });
  const attendanceRows = summary.periodAttendance.slice().sort((a, b) => String(b.attendanceDate_c).localeCompare(String(a.attendanceDate_c)));
  const paymentRows = summary.periodPayments.slice().sort((a, b) => String(b.paymentDate_c).localeCompare(String(a.paymentDate_c)));
  const legacyRows = summary.legacyRows;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm"><Link to="/workers"><ApperIcon name="ArrowLeft" size={16} /> Back to workers</Link></Button>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">People / Wage statement</p><h1 className="font-heading text-3xl font-semibold">{worker.Name}</h1><p className="mt-2 text-sm text-muted-foreground">{worker.role_c || 'Worker'} · {worker.workerType_c || 'Regular'} · {worker.status_c || 'Active'} · {worker.payType_c === 'Monthly Salary' ? 'Monthly salary ' + cash(worker.monthlySalary_c) : 'Default rate ' + cash(worker.dailyRate_c) + '/day'}</p></div>
        {access.canUpdate && <Button asChild variant="outline" className="rounded-sm"><Link to={'/workers/' + id + '/edit'}><ApperIcon name="Pencil" size={15} /> Edit worker</Link></Button>}
      </header>

      <PeriodControls type={periodType} onTypeChange={setPeriodType} anchorDate={anchorDate} onAnchorDateChange={setAnchorDate} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Counted units" value={summary.attendanceUnits.toLocaleString('en-IN')} note={summary.fullDays + ' full · ' + summary.halfDays + ' half'} />
        <Metric label="Total earned" value={cash(summary.cumulativeEarned)} note="All attendance through period end" />
        <Metric label="Earned in period" value={cash(summary.earned)} note={range.label} />
        <Metric label="Total advances given" value={cash(summary.cumulativeAdvances)} note={cash(summary.periodAdvances) + ' in selected period'} />
        <Metric label="Wage payments" value={cash(summary.periodPaid)} note="Transactions in selected period" />
        <Metric label={summary.closingBalance < 0 ? 'Advance / credit balance' : 'Pending balance'} value={cash(Math.abs(summary.closingBalance))} note="Earned minus paid and advances, through period end" />
      </div>

      <section className="overflow-hidden border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Attendance and earned wages</h2></div>
        {attendanceRows.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No saved attendance in {range.label}.</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Wage snapshot</th><th className="px-4 py-3 text-right">Units</th><th className="px-4 py-3 text-right">Earned</th><th className="px-4 py-3">Notes</th></tr></thead><tbody className="divide-y divide-border">{attendanceRows.map((row) => (
            <tr key={row.Id}><td className="px-4 py-3">{formatLocalDate(row.attendanceDate_c, DATE_FORMATS.SHORT)}</td><td className="px-4 py-3">{row.status_c === 'Present' ? 'Full day' : row.status_c}</td><td className="px-4 py-3 text-right tabular-nums">{cash(row.wagePerDay_c ?? worker.dailyRate_c)}</td><td className="px-4 py-3 text-right tabular-nums">{Number(row.attendanceUnits_c ?? (row.status_c === 'Present' ? 1 : row.status_c === 'Half Day' ? 0.5 : 0)).toLocaleString('en-IN')}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{cash(row.earnedWage_c ?? 0)}</td><td className="px-4 py-3 text-muted-foreground">{row.notes_c || '—'}</td></tr>
          ))}</tbody></table></div>
        )}
      </section>

      <section className="overflow-hidden border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Payments and advances</h2></div>
        {paymentRows.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No separate wage transactions in {range.label}.</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Reference / notes</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-border">{paymentRows.map((row) => (
            <tr key={row.Id}><td className="px-4 py-3">{formatLocalDate(row.paymentDate_c, DATE_FORMATS.SHORT)}</td><td className="px-4 py-3">{row.transactionType_c}</td><td className="px-4 py-3">{row.paymentMethod_c}</td><td className="px-4 py-3 text-muted-foreground">{row.reference_c || row.notes_c || '—'}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{cash(row.amount_c)}</td></tr>
          ))}</tbody></table></div>
        )}
      </section>

      <section className="overflow-hidden border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Existing payroll records</h2><p className="mt-1 text-xs text-muted-foreground">Original payroll entries remain available as historical records.</p></div>
        {legacyRows.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No legacy payroll records overlap {range.label}.</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Pay period</th><th className="px-4 py-3 text-right">Gross</th><th className="px-4 py-3 text-right">Advance</th><th className="px-4 py-3 text-right">Net</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-border">{legacyRows.map((row) => (
            <tr key={row.Id}><td className="px-4 py-3">{row.payPeriod_c}</td><td className="px-4 py-3 text-right tabular-nums">{cash(row.grossPay_c)}</td><td className="px-4 py-3 text-right tabular-nums">{cash(row.advance_c)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{cash(row.netPay_c)}</td><td className="px-4 py-3">{row.status_c}</td></tr>
          ))}</tbody></table></div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">Editing the worker’s current rate never changes the daily wage snapshot of saved attendance entries.</p>
    </div>
  );
}

function Metric({ label, value, note }) {
  return <section className="border border-border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 font-heading text-xl font-semibold tabular-nums">{value}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</section>;
}
