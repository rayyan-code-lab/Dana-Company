import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { sdk, lte } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { todayLocalDate, getPeriodRange } from '@/services/periods';
import { calculateWorkerWageSummary, cash, sameWorker } from '@/services/wageCalculations';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import PeriodControls from '@/components/PeriodControls';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const WORKER_FIELDS = ['Id', 'Name', 'role_c', 'phone_c', 'dailyRate_c', 'status_c', 'joinedOn_c', 'notes_c', 'workerType_c', 'payType_c', 'monthlySalary_c', 'shift_c', 'shiftTiming_c', 'isArchived_c'];
const ATTENDANCE_FIELDS = ['Id', 'Name', 'worker_c', 'attendanceDate_c', 'status_c', 'wagePerDay_c', 'attendanceUnits_c', 'earnedWage_c', 'attendanceKey_c', 'shift_c', 'notes_c', 'overtimeHours_c'];
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
  const navigate = useNavigate();
  const { profile } = useProfile();
  const access = getTableAccess(profile, 'workers_c');
  const attendanceAccess = getTableAccess(profile, 'attendance_c');
  const paymentAccess = getTableAccess(profile, 'worker_payments_c');
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

  async function handleDeleteAttendance(row) {
    if (!attendanceAccess.canDelete) {
      toast.error('You do not have permission to delete attendance records.');
      return;
    }
    const dateLabel = formatLocalDate(row.attendanceDate_c, DATE_FORMATS.SHORT);
    const wage = cash(row.earnedWage_c ?? 0);
    if (!window.confirm(`Delete the shift on ${dateLabel}? This will remove the ${wage} earned wage from the ledger.`)) {
      return;
    }
    try {
      const res = await sdk.table('attendance_c').remove(row.Id);
      if (res.success) {
        toast.success(`Shift record on ${dateLabel} deleted.`);
        await run();
      } else {
        toast.error('Could not delete shift record.');
      }
    } catch (err) {
      toast.error('Could not delete shift record.', { description: err.message ?? String(err) });
    }
  }

  async function handleDeletePayment(record) {
    if (!paymentAccess.canDelete) {
      toast.error('You do not have permission to delete payment records.');
      return;
    }
    const dateLabel = formatLocalDate(record.paymentDate_c, DATE_FORMATS.SHORT);
    const amount = cash(record.amount_c ?? 0);
    if (!window.confirm(`Delete this ${record.transactionType_c} of ${amount} on ${dateLabel}?`)) {
      return;
    }
    try {
      const res = await sdk.table('worker_payments_c').remove(record.Id);
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

  async function handlePurgeWorkerAndRecords() {
    if (!access.canDelete) {
      toast.error('You do not have permission to delete workers.');
      return;
    }
    if (!window.confirm(`Permanently delete ${worker.Name} and ALL associated shifts, wages, and payments? This will completely erase them from the system.`)) {
      return;
    }
    try {
      const attIds = (attendance || []).map((r) => r.Id).filter(Boolean);
      const payIds = (payments || []).map((r) => r.Id).filter(Boolean);
      if (attIds.length) await sdk.table('attendance_c').remove(attIds);
      if (payIds.length) await sdk.table('worker_payments_c').remove(payIds);
      await sdk.table('workers_c').remove(worker.Id);
      toast.success(`${worker.Name} and all records permanently purged.`);
      navigate('/workers');
    } catch (err) {
      toast.error('Could not purge worker records.', { description: err.message ?? String(err) });
    }
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-sm"><Link to="/workers"><ApperIcon name="ArrowLeft" size={16} /> Back to workers</Link></Button>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">People / Wage statement</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-3xl font-semibold">{worker.Name}</h1>
            {worker.isArchived_c && (
              <span className="inline-flex rounded-sm border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                Removed from register
              </span>
            )}
            <span className={'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-semibold ' + (worker.shift_c === 'Night Shift' ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400')}>
              <ApperIcon name={worker.shift_c === 'Night Shift' ? 'Moon' : 'Sun'} size={13} />
              {worker.shift_c || 'Day Shift'} · {worker.shiftTiming_c || (worker.shift_c === 'Night Shift' ? '09:00 PM - 09:00 AM' : '09:00 AM - 09:00 PM')}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{worker.role_c || 'Worker'} · {worker.workerType_c || 'Regular'} · {worker.status_c || 'Active'} · {worker.payType_c === 'Monthly Salary' ? 'Monthly salary ' + cash(worker.monthlySalary_c) : 'Default rate ' + cash(worker.dailyRate_c) + '/day'}</p>
        </div>
        {access.canUpdate && <Button asChild variant="outline" className="rounded-sm"><Link to={'/workers/' + id + '/edit'}><ApperIcon name="Pencil" size={15} /> Edit worker</Link></Button>}
      </header>

      {worker.isArchived_c && (
        <section className="flex flex-col gap-3 rounded-sm border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between text-sm">
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">Worker removed from register</p>
            <p className="mt-0.5 text-xs text-amber-800/90 dark:text-amber-300">
              This worker is archived. To remove mistaken entries, delete individual shifts below or purge all remaining records.
            </p>
          </div>
          {access.canDelete && (
            <Button
              size="sm"
              variant="destructive"
              className="rounded-sm whitespace-nowrap"
              onClick={handlePurgeWorkerAndRecords}
            >
              <ApperIcon name="Trash2" size={14} className="mr-1.5" />
              Purge worker & all records
            </Button>
          )}
        </section>
      )}

      <PeriodControls type={periodType} onTypeChange={setPeriodType} anchorDate={anchorDate} onAnchorDateChange={setAnchorDate} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          label="Total shifts"
          value={summary.totalShifts.toLocaleString('en-IN')}
          note={summary.dayShifts + ' day · ' + summary.nightShifts + ' night' + (summary.overtimeHours > 0 ? ' · ' + summary.overtimeHours + ' OT hrs' : '')}
        />
        <Metric
          label="Opening balance"
          value={summary.openingBalance > 0 ? cash(summary.openingBalance) + ' due' : summary.openingBalance < 0 ? cash(Math.abs(summary.openingBalance)) + ' credit' : cash(0)}
          note={summary.openingBalance !== 0 ? 'Prior balance before ' + range.label : 'No prior dues before ' + range.label}
        />
        <Metric
          label="Earned in period"
          value={cash(summary.earned)}
          note={range.label + ' (' + summary.totalShifts + ' shift' + (summary.totalShifts === 1 ? '' : 's') + ')'}
        />
        <Metric
          label="Wage payments"
          value={cash(summary.periodPaid)}
          note={'Disbursed in ' + range.label}
        />
        <Metric
          label="Advances taken"
          value={cash(summary.periodAdvances)}
          note={'Advances in ' + range.label}
        />
        <Metric
          label={summary.closingBalance < 0 ? 'Advance / credit balance' : 'Closing balance'}
          value={cash(Math.abs(summary.closingBalance)) + (summary.closingBalance > 0 ? ' due' : summary.closingBalance < 0 ? ' credit' : '')}
          note={summary.openingBalance !== 0
            ? cash(summary.periodNet) + ' this period · ' + cash(summary.openingBalance) + ' prior'
            : 'Earned minus disbursements'}
        />
      </div>

      <section className="overflow-hidden border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Attendance and earned wages</h2></div>
        {attendanceRows.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No saved attendance in {range.label}.</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[750px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">OT (Hrs)</th><th className="px-4 py-3 text-right">Wage snapshot</th><th className="px-4 py-3 text-right">Units</th><th className="px-4 py-3 text-right">Earned</th><th className="px-4 py-3">Notes</th>{attendanceAccess.canDelete && <th className="px-4 py-3 text-right">Action</th>}</tr></thead><tbody className="divide-y divide-border">{attendanceRows.map((row) => (
            <tr key={row.Id}>
              <td className="px-4 py-3">{formatLocalDate(row.attendanceDate_c, DATE_FORMATS.SHORT)}</td>
              <td className="px-4 py-3">{row.status_c === 'Present' ? 'Full day' : row.status_c}</td>
              <td className="px-4 py-3 text-right tabular-nums">{Number(row.overtimeHours_c) > 0 ? <span className="inline-flex items-center rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">+{Number(row.overtimeHours_c)} hrs</span> : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-4 py-3 text-right tabular-nums">{cash(row.wagePerDay_c ?? worker.dailyRate_c)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{Number(row.attendanceUnits_c ?? (row.status_c === 'Present' ? 1 : row.status_c === 'Half Day' ? 0.5 : 0)).toLocaleString('en-IN')}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{cash(row.earnedWage_c ?? 0)}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.notes_c || '—'}</td>
              {attendanceAccess.canDelete && (
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDeleteAttendance(row)}
                  >
                    <ApperIcon name="Trash2" size={13} className="mr-1" />
                    Delete shift
                  </Button>
                </td>
              )}
            </tr>
          ))}</tbody></table></div>
        )}
      </section>

      <section className="overflow-hidden border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Payments and advances</h2></div>
        {paymentRows.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No separate wage transactions in {range.label}.</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Reference / notes</th><th className="px-4 py-3 text-right">Amount</th>{paymentAccess.canDelete && <th className="px-4 py-3 text-right">Action</th>}</tr></thead><tbody className="divide-y divide-border">{paymentRows.map((row) => (
            <tr key={row.Id}>
              <td className="px-4 py-3">{formatLocalDate(row.paymentDate_c, DATE_FORMATS.SHORT)}</td>
              <td className="px-4 py-3">{row.transactionType_c}</td>
              <td className="px-4 py-3">{row.paymentMethod_c}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.reference_c || row.notes_c || '—'}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">{cash(row.amount_c)}</td>
              {paymentAccess.canDelete && (
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDeletePayment(row)}
                  >
                    <ApperIcon name="Trash2" size={13} className="mr-1" />
                    Delete
                  </Button>
                </td>
              )}
            </tr>
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
