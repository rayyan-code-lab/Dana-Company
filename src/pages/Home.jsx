import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { todayLocalDate, getPeriodRange } from '@/services/periods';
import { getProducedStockBalances } from '@/services/productionWorkflow';
import ApperIcon from '@/components/ApperIcon';
import PeriodControls from '@/components/PeriodControls';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export const route = { path: '/', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'LayoutDashboard', label: 'Dashboard', section: 'Overview', order: 1 };

const read = async (table, fields) => {
  const rows = [];
  let page = 1;
  let more = true;

  while (more) {
    const response = await sdk.table(table).select(fields).page(page, 100).fetch();
    if (!response.success) throw new Error(response.message || 'Could not load overview');
    rows.push(...(response.data ?? []));
    more = Boolean(response.hasMore);
    page += 1;
  }

  return rows;
};

const inr = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(Number(value ?? 0));

const kg = (value) => `${Number(value ?? 0).toLocaleString('en-IN')} kg`;

function lookupId(value) {
  return String(value?.Id ?? value ?? '');
}

function toLocalDateLabel(value) {
  if (!value) return '—';
  const parts = String(value).split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, 12).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function Metric({ label, value, note, icon }) {
  return (
    <div className="border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className="flex size-9 items-center justify-center rounded-sm bg-primary/10 text-primary">
          <ApperIcon name={icon} size={18} />
        </span>
      </div>
      <p className="mt-4 font-heading text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export default function Home() {
  const salesRecords = useFetch(() => read('sales_c', ['Name', 'saleId_c', 'amount_c', 'saleDate_c']), []);
  const expenseRecords = useFetch(() => read('expenses_c', ['Name', 'amount_c', 'expenseDate_c']), []);
  const purchases = useFetch(() => read('purchases_c', [
    'Name',
    'totalPurchaseValue_c',
    'recordStatus_c',
    'purchaseDate_c',
  ]), []);
  const otherIncome = useFetch(() => read('transactions_c', ['Name', 'entryType_c', 'amount_c', 'entryDate_c']), []);
  const producedStock = useFetch(() => getProducedStockBalances(), []);
  const workers = useFetch(() => read('workers_c', ['Name', 'status_c', 'role_c', 'shift_c']), []);
  const attendance = useFetch(() => read('attendance_c', ['Name', 'worker_c', 'attendanceDate_c', 'status_c', 'wagePerDay_c', 'earnedWage_c']), []);

  const allReads = [salesRecords, expenseRecords, purchases, otherIncome, workers, attendance];
  const busy = allReads.some((item) => item.data === undefined);
  const [periodType, setPeriodType] = useState('month');
  const [anchorDate, setAnchorDate] = useState(todayLocalDate());
  const range = getPeriodRange(periodType, anchorDate);
  const today = todayLocalDate();

  const isInPeriod = (d) => {
    if (!d) return false;
    return d >= range.start && d <= range.end;
  };

  const periodPurchases = (purchases.data ?? [])
    .filter((row) => row.recordStatus_c !== 'Cancelled' && isInPeriod(row.purchaseDate_c));
  const purchasesTotal = periodPurchases.reduce((sum, row) => sum + Number(row.totalPurchaseValue_c ?? 0), 0);

  const periodSales = (salesRecords.data ?? []).filter((row) => isInPeriod(row.saleDate_c));
  const salesTotal = periodSales.reduce((sum, row) => sum + Number(row.amount_c ?? 0), 0);

  const periodOtherIncome = (otherIncome.data ?? [])
    .filter((row) => row.entryType_c === 'Other Income' && isInPeriod(row.entryDate_c));
  const incomeTotal = periodOtherIncome.reduce((sum, row) => sum + Number(row.amount_c ?? 0), 0);
  const salesAndIncome = salesTotal + incomeTotal;

  const periodExpenses = (expenseRecords.data ?? []).filter((row) => isInPeriod(row.expenseDate_c));
  const expensesTotal = periodExpenses.reduce((sum, row) => sum + Number(row.amount_c ?? 0), 0);

  const periodLegacyPurchase = (otherIncome.data ?? [])
    .filter((row) => row.entryType_c === 'Purchase' && isInPeriod(row.entryDate_c));
  const legacyPurchaseTotal = periodLegacyPurchase.reduce((sum, row) => sum + Number(row.amount_c ?? 0), 0);
  const spending = expensesTotal + purchasesTotal + legacyPurchaseTotal;

  // Attendance target date: anchorDate if viewing 'day', else today
  const attendanceTargetDate = periodType === 'day' ? anchorDate : today;
  const dayAttendance = (attendance.data ?? []).filter((row) => row.attendanceDate_c === attendanceTargetDate);
  const activeWorkers = (workers.data ?? []).filter((worker) => worker.status_c === 'Active');
  const activeWorkerCount = activeWorkers.length;

  const presentWorkerIds = new Set(
    dayAttendance
      .filter((row) => row.status_c === 'Present' || row.status_c === 'Full Day')
      .map((row) => lookupId(row.worker_c))
  );
  const presentCount = presentWorkerIds.size;
  const totalShiftsPresent = dayAttendance.filter((row) => row.status_c === 'Present' || row.status_c === 'Full Day').length;

  const leaveWorkerIds = new Set(dayAttendance.filter((row) => row.status_c === 'Leave').map((row) => lookupId(row.worker_c)));
  const leaveCount = leaveWorkerIds.size;

  const absentWorkerIds = new Set(dayAttendance.filter((row) => row.status_c === 'Absent').map((row) => lookupId(row.worker_c)));
  const absentCount = absentWorkerIds.size;

  const unmarkedCount = Math.max(0, activeWorkerCount - presentCount - leaveCount - absentCount);

  const currentYear = Number(anchorDate.slice(0, 4));
  const monthlyStats = Array.from({ length: 12 }, (_, index) => {
    const monthKey = `${currentYear}-${String(index + 1).padStart(2, '0')}`;
    const inMonth = (value) => String(value ?? '').startsWith(monthKey);
    const lastDay = new Date(currentYear, index + 1, 0).getDate();
    return {
      key: monthKey,
      name: new Date(currentYear, index, 1, 12).toLocaleDateString('en-IN', { month: 'long' }),
      lastDay,
      purchases: (purchases.data ?? [])
        .filter((row) => row.recordStatus_c !== 'Cancelled' && inMonth(row.purchaseDate_c))
        .reduce((sum, row) => sum + Number(row.totalPurchaseValue_c ?? 0), 0),
      sales: (salesRecords.data ?? [])
        .filter((row) => inMonth(row.saleDate_c))
        .reduce((sum, row) => sum + Number(row.amount_c ?? 0), 0),
      income: (otherIncome.data ?? [])
        .filter((row) => row.entryType_c === 'Other Income' && inMonth(row.entryDate_c))
        .reduce((sum, row) => sum + Number(row.amount_c ?? 0), 0),
    };
  });
  const monthlyTotals = monthlyStats.reduce(
    (totals, month) => ({
      purchases: totals.purchases + month.purchases,
      sales: totals.sales + month.sales,
      income: totals.income + month.income,
    }),
    { purchases: 0, sales: 0, income: 0 },
  );

  const actions = [
    ['UserRoundPlus', 'Add worker', 'Worker details, roles and daily rates', '/workers/new'],
    ['CalendarCheck', 'Mark attendance', 'Daily attendance, shifts and timings', '/attendance'],
    ['TrendingUp', 'Record sale', 'Quantity, rate and customer invoice', '/sales/new'],
    ['ReceiptIndianRupee', 'Log expense', 'Amount, payment method and receipt evidence', '/expenses/new'],
    ['FileSpreadsheet', 'Financial Reports', 'Detailed profit & loss, yearly trends & statement export', '/financial-reports'],
  ];

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Company overview · {new Date(today + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
          <h1 className="font-heading text-3xl font-semibold md:text-4xl">Company dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your raw material, production, people and company money in one operations workspace.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-sm">
            <Link to="/expenses/new">Log expense</Link>
          </Button>
          <Button asChild className="rounded-sm">
            <Link to="/sales/new"><ApperIcon name="Plus" size={16} /> Record sale</Link>
          </Button>
        </div>
      </div>

      {/* Period Selection (Yearly, Monthly, Weekly, Daily) */}
      <div className="border border-border bg-card p-4 shadow-sm">
        <PeriodControls
          type={periodType}
          anchor={anchorDate}
          onTypeChange={setPeriodType}
          onAnchorChange={setAnchorDate}
          showYearly={true}
        />
      </div>

      {busy ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Left Column: Total Purchases + Section below it for Workers Present */}
          <div className="space-y-4">
            <Metric
              label="Total purchases"
              value={inr(purchasesTotal)}
              note={`Purchases in ${range.label}`}
              icon="ShoppingCart"
            />

            {/* Section below Total Purchases showing workers present */}
            <section className="border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Daily workforce attendance</p>
                  <h2 className="mt-1 font-heading text-lg font-semibold">
                    Workers present {attendanceTargetDate === today ? 'today' : `(${toLocalDateLabel(attendanceTargetDate)})`}
                  </h2>
                </div>
                <span className="flex size-9 items-center justify-center rounded-sm bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <ApperIcon name="Users" size={18} />
                </span>
              </div>

              <div className="mt-4 flex items-baseline gap-2">
                <p className="font-heading text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {presentCount}
                </p>
                <span className="text-sm font-medium text-muted-foreground">
                  / {activeWorkerCount} active workers
                  {totalShiftsPresent > presentCount && ` (${totalShiftsPresent} shifts)`}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3 text-xs">
                <span className="inline-flex items-center rounded-sm bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                  <ApperIcon name="Check" size={12} className="mr-1" /> {presentCount} Present
                </span>
                <span className="inline-flex items-center rounded-sm bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
                  <ApperIcon name="Calendar" size={12} className="mr-1" /> {leaveCount} Leave
                </span>
                <span className="inline-flex items-center rounded-sm bg-rose-500/10 px-2 py-0.5 font-medium text-rose-600 dark:text-rose-400">
                  <ApperIcon name="X" size={12} className="mr-1" /> {absentCount} Absent
                </span>
                {unmarkedCount > 0 && (
                  <span className="inline-flex items-center rounded-sm bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                    {unmarkedCount} Unmarked
                  </span>
                )}
              </div>

              <div className="mt-4 border-t border-border pt-3 flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Date: {toLocalDateLabel(attendanceTargetDate)}</span>
                <Button asChild size="sm" variant="ghost" className="h-7 text-xs font-semibold text-primary p-0 hover:bg-transparent">
                  <Link to="/attendance">
                    Open daybook <ApperIcon name="ArrowRight" size={12} className="ml-1" />
                  </Link>
                </Button>
              </div>
            </section>
          </div>

          {/* Right Column: Sales & Income + Quick Entry */}
          <div className="space-y-4">
            <Metric
              label="Sales & income"
              value={inr(salesAndIncome)}
              note={`Sales & other income in ${range.label}`}
              icon="TrendingUp"
            />

            <section className="border border-border bg-card p-5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-highlight">Quick operations</p>
              <h2 className="mt-1 font-heading text-lg font-semibold">Fast data entry</h2>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <Button asChild variant="outline" size="sm" className="w-full rounded-sm justify-start">
                  <Link to="/attendance"><ApperIcon name="CalendarCheck" size={14} className="mr-1.5" /> Daybook</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="w-full rounded-sm justify-start">
                  <Link to="/sales/new"><ApperIcon name="TrendingUp" size={14} className="mr-1.5" /> Record sale</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="w-full rounded-sm justify-start">
                  <Link to="/expenses/new"><ApperIcon name="ReceiptIndianRupee" size={14} className="mr-1.5" /> Log expense</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="w-full rounded-sm justify-start">
                  <Link to="/financial-reports"><ApperIcon name="FileSpreadsheet" size={14} className="mr-1.5" /> P&amp;L Report</Link>
                </Button>
              </div>
              <div className="mt-4 border-t border-border pt-3 flex justify-between items-center text-xs text-muted-foreground">
                <span>Recorded flow overview</span>
                <Link to="/financial-reports" className="font-semibold text-primary hover:underline inline-flex items-center gap-1">
                  Financial reports <ApperIcon name="ArrowRight" size={12} />
                </Link>
              </div>
            </section>
          </div>
        </div>
      )}

      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">In-Hand Production/Stock</p>
            <h2 className="mt-2 font-heading text-xl font-semibold">Finished product on hand</h2>
          </div>
          <span className="text-xs text-muted-foreground">Produced minus sold, by product</span>
        </div>
        {producedStock.data === undefined && !producedStock.error ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : producedStock.error ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Could not load produced stock.</p>
        ) : !producedStock.data?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No produced stock yet. Recorded production appears here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold">Product</th>
                  <th className="px-5 py-3 text-right font-semibold">Produced</th>
                  <th className="px-5 py-3 text-right font-semibold">Sold</th>
                  <th className="px-5 py-3 text-right font-semibold">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {producedStock.data.map((item) => (
                  <tr key={item.key} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-5 py-3">{item.name}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{kg(item.produced)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{kg(item.sold)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums">{kg(item.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border border-border bg-card p-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-highlight">Finance snapshot</p>
        <h2 className="mt-2 font-heading text-xl font-semibold">Recorded money flow ({range.label})</h2>
        <div className="mt-6 space-y-5">
          <FinanceBar label="Sales & other income" value={salesAndIncome} max={salesAndIncome + spending} />
          <FinanceBar label="Expenses & purchases (including legacy)" value={spending} max={salesAndIncome + spending} />
          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">Difference on recorded entries ({range.label})</p>
            <p className="mt-1 font-heading text-2xl font-semibold">{inr(salesAndIncome - spending)}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button asChild variant="outline" className="w-full rounded-sm"><Link to="/sales">View sales</Link></Button>
          <Button asChild variant="outline" className="w-full rounded-sm"><Link to="/expenses">View expenses</Link></Button>
          <Button asChild variant="outline" className="w-full rounded-sm"><Link to="/purchases">View purchases</Link></Button>
          <Button asChild variant="outline" className="w-full rounded-sm"><Link to="/payroll">View wages</Link></Button>
          <Button asChild className="col-span-2 w-full rounded-sm bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20">
            <Link to="/financial-reports">
              <ApperIcon name="FileSpreadsheet" size={15} className="mr-1.5" />
              View Comprehensive Financial Reports &amp; P&amp;L
            </Link>
          </Button>
        </div>
      </section>

      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Monthly statistics</p>
            <h2 className="mt-2 font-heading text-xl font-semibold">Purchases, sales and income by month</h2>
          </div>
          <span className="text-xs text-muted-foreground">{currentYear} · 1st to last day of each month</span>
        </div>
        {busy ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold">Month</th>
                  <th className="px-5 py-3 font-semibold">Period</th>
                  <th className="px-5 py-3 text-right font-semibold">Purchases</th>
                  <th className="px-5 py-3 text-right font-semibold">Sales</th>
                  <th className="px-5 py-3 text-right font-semibold">Income</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {monthlyStats.map((month) => (
                  <tr key={month.key} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-5 py-3 font-medium">{month.name}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground tabular-nums">1 – {month.lastDay}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{inr(month.purchases)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{inr(month.sales)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{inr(month.income)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-semibold">
                <tr>
                  <td className="whitespace-nowrap px-5 py-3" colSpan={2}>Year total</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{inr(monthlyTotals.purchases)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{inr(monthlyTotals.sales)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{inr(monthlyTotals.income)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-heading text-xl font-semibold">Daily operations</h2>
          <p className="mt-1 text-xs text-muted-foreground">Jump straight into common jobs.</p>
        </div>
        <div className="grid md:grid-cols-2">
          {actions.map(([icon, title, description, to]) => (
            <Link key={to} to={to} className="group flex gap-4 border-b border-border p-5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:odd:border-r">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted">
                <ApperIcon name={icon} size={19} />
              </span>
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">Open <ApperIcon name="ArrowRight" size={13} /></span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function FinanceBar({ label, value, max }) {
  const width = max > 0 ? Math.min(100, value / max * 100) : 0;
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <b>{inr(value)}</b>
      </div>
      <div className="mt-2 h-2 bg-muted">
        <div className="h-2 bg-primary" style={{ width: width + '%' }} />
      </div>
    </div>
  );
}
