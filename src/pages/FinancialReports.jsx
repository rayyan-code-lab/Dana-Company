import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '@/hooks/useFetch';
import { sdk } from '@/services/sdk';
import { todayLocalDate, getPeriodRange } from '@/services/periods';
import { getProducedStockBalances } from '@/services/productionWorkflow';
import ApperIcon from '@/components/ApperIcon';
import PeriodControls from '@/components/PeriodControls';
import FinancialReportPdfModal from '@/components/FinancialReportPdfModal';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export const route = { path: '/financial-reports', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'FileSpreadsheet', label: 'Financial Reports', section: 'Finance', order: 47 };

const read = async (table, fields) => {
  const rows = [];
  let page = 1;
  let more = true;

  while (more) {
    const response = await sdk.table(table).select(fields).page(page, 100).fetch();
    if (!response.success) throw new Error(response.message || 'Could not load ' + table);
    rows.push(...(response.data ?? []));
    more = Boolean(response.hasMore);
    page += 1;
  }

  return rows;
};

const cash = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

const kg = (value) => `${Number(value ?? 0).toLocaleString('en-IN')} kg`;

function Metric({ label, value, note, icon, color = 'text-primary' }) {
  return (
    <div className="border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className="flex size-9 items-center justify-center rounded-sm bg-primary/10 text-primary">
          <ApperIcon name={icon} size={18} />
        </span>
      </div>
      <p className={`mt-4 font-heading text-2xl font-semibold tabular-nums sm:text-3xl ${color}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export default function FinancialReportsPage() {
  const [periodType, setPeriodType] = useState('month');
  const [anchorDate, setAnchorDate] = useState(todayLocalDate());
  const [reportModalOpen, setReportModalOpen] = useState(false);

  const range = getPeriodRange(periodType, anchorDate);

  // Fetch all financial dimensions
  const salesRecords = useFetch(
    () => read('sales_c', ['Name', 'saleId_c', 'amount_c', 'paidAmount_c', 'balanceDue_c', 'saleDate_c', 'weightKg_c']),
    []
  );
  const expenseRecords = useFetch(
    () => read('expenses_c', ['Name', 'amount_c', 'expenseDate_c']),
    []
  );
  const purchases = useFetch(
    () => read('purchases_c', ['Name', 'totalPurchaseValue_c', 'recordStatus_c', 'purchaseDate_c']),
    []
  );
  const otherIncome = useFetch(
    () => read('transactions_c', ['Name', 'entryType_c', 'amount_c', 'entryDate_c']),
    []
  );
  const wastageRecords = useFetch(
    () => read('wastage_c', ['Name', 'recordType_c', 'date_c', 'category_c', 'weightKg_c', 'revenueAmount_c']),
    []
  );
  const attendanceRecords = useFetch(
    () => read('attendance_c', ['Name', 'attendanceDate_c', 'status_c', 'wagePerDay_c', 'earnedWage_c', 'attendanceUnits_c']),
    []
  );
  const producedStock = useFetch(() => getProducedStockBalances(), []);

  const allReads = [salesRecords, expenseRecords, purchases, otherIncome, wastageRecords, attendanceRecords];
  const busy = allReads.some((item) => item.data === undefined);
  const today = todayLocalDate();

  // Helper date filter
  const isInPeriod = (d) => {
    if (!d) return false;
    return d >= range.start && d <= range.end;
  };

  // Period-specific financials
  const periodFinancials = useMemo(() => {
    const rawSales = salesRecords.data ?? [];
    const rawExpenses = expenseRecords.data ?? [];
    const rawPurchases = purchases.data ?? [];
    const rawTransactions = otherIncome.data ?? [];
    const rawWastage = wastageRecords.data ?? [];
    const rawAttendance = attendanceRecords.data ?? [];

    const periodSales = rawSales.filter((r) => isInPeriod(r.saleDate_c));
    const periodExpenses = rawExpenses.filter((r) => isInPeriod(r.expenseDate_c));
    const periodPurchases = rawPurchases.filter((r) => r.recordStatus_c !== 'Cancelled' && isInPeriod(r.purchaseDate_c));
    const periodWastageSales = rawWastage.filter((r) => r.recordType_c === 'Sold' && isInPeriod(r.date_c));
    const periodAttendance = rawAttendance.filter((r) => isInPeriod(r.attendanceDate_c));
    const periodOtherIncome = rawTransactions.filter((r) => r.entryType_c === 'Other Income' && isInPeriod(r.entryDate_c));

    // Revenue
    const salesTotal = periodSales.reduce((s, r) => s + Number(r.amount_c ?? 0), 0);
    const salesPaidTotal = periodSales.reduce(
      (s, r) => s + (r.paidAmount_c != null ? Number(r.paidAmount_c) : Number(r.amount_c ?? 0)),
      0
    );
    const salesPendingTotal = periodSales.reduce(
      (s, r) =>
        s +
        (r.balanceDue_c != null
          ? Number(r.balanceDue_c)
          : Math.max(0, Number(r.amount_c ?? 0) - Number(r.paidAmount_c ?? r.amount_c ?? 0))),
      0
    );
    const scrapRevenueTotal = periodWastageSales.reduce((s, r) => s + Number(r.revenueAmount_c ?? 0), 0);
    const otherIncomeTotal = periodOtherIncome.reduce((s, r) => s + Number(r.amount_c ?? 0), 0);
    const totalRevenue = salesTotal + scrapRevenueTotal + otherIncomeTotal;

    // Costs
    const purchasesTotal = periodPurchases.reduce((s, r) => s + Number(r.totalPurchaseValue_c ?? 0), 0);
    const expensesTotal = periodExpenses.reduce((s, r) => s + Number(r.amount_c ?? 0), 0);
    const payrollTotal = periodAttendance.reduce((s, r) => {
      if (r.status_c === 'Unmarked') return s;
      return s + (r.earnedWage_c != null ? Number(r.earnedWage_c) : Number(r.wagePerDay_c || 0) * Number(r.attendanceUnits_c || 1));
    }, 0);
    const totalCosts = purchasesTotal + expensesTotal + payrollTotal;

    // Net Profit & Margin
    const netProfit = totalRevenue - totalCosts;
    const netMarginPercent = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    // Physical stock & scrap assets
    let totalScrapGen = 0;
    let totalScrapSold = 0;
    rawWastage.forEach((w) => {
      const wt = Number(w.weightKg_c || 0);
      if (w.recordType_c === 'Sold') totalScrapSold += wt;
      else totalScrapGen += wt;
    });
    const scrapInStorageKg = Math.max(0, totalScrapGen - totalScrapSold);

    const stockOnHandKg = (producedStock.data ?? []).reduce((s, p) => s + Number(p.balance || 0), 0);
    const totalProducedKg = (producedStock.data ?? []).reduce((s, p) => s + Number(p.produced || 0), 0);

    return {
      salesTotal,
      salesPaidTotal,
      salesPendingTotal,
      scrapRevenueTotal,
      otherIncomeTotal,
      totalRevenue,
      purchasesTotal,
      expensesTotal,
      payrollTotal,
      totalCosts,
      netProfit,
      netMarginPercent,
      scrapInStorageKg,
      stockOnHandKg,
      totalProducedKg,
      salesCount: periodSales.length,
      expensesCount: periodExpenses.length,
      purchasesCount: periodPurchases.length,
      payrollEntriesCount: periodAttendance.length,
    };
  }, [salesRecords.data, expenseRecords.data, purchases.data, otherIncome.data, wastageRecords.data, attendanceRecords.data, producedStock.data, range]);

  // Year monthly stats
  const currentYear = Number(today.slice(0, 4));
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
      scrapRevenue: (wastageRecords.data ?? [])
        .filter((row) => row.recordType_c === 'Sold' && inMonth(row.date_c))
        .reduce((sum, row) => sum + Number(row.revenueAmount_c ?? 0), 0),
      expenses: (expenseRecords.data ?? [])
        .filter((row) => inMonth(row.expenseDate_c))
        .reduce((sum, row) => sum + Number(row.amount_c ?? 0), 0),
      payroll: (attendanceRecords.data ?? [])
        .filter((row) => inMonth(row.attendanceDate_c) && row.status_c !== 'Unmarked')
        .reduce((sum, row) => sum + Number(row.earnedWage_c ?? row.wagePerDay_c ?? 0), 0),
    };
  });

  const monthlyTotals = monthlyStats.reduce(
    (totals, month) => ({
      purchases: totals.purchases + month.purchases,
      sales: totals.sales + month.sales,
      income: totals.income + month.income + month.scrapRevenue,
      expenses: totals.expenses + month.expenses,
      payroll: totals.payroll + month.payroll,
    }),
    { purchases: 0, sales: 0, income: 0, expenses: 0, payroll: 0 }
  );

  const isProfitable = periodFinancials.netProfit >= 0;

  // Export CSV handler
  function exportCsv() {
    const lines = [
      ['DANA COMPANY - FINANCIAL REPORT', `Period: ${range.label}`],
      ['Generated On', new Date().toLocaleString('en-IN')],
      [],
      ['REVENUE DIMENSIONS', 'AMOUNT (INR)'],
      ['Commercial Finished Sales', periodFinancials.salesTotal],
      ['Industrial Scrap Monetization', periodFinancials.scrapRevenueTotal],
      ['Other Income', periodFinancials.otherIncomeTotal],
      ['TOTAL REVENUE', periodFinancials.totalRevenue],
      [],
      ['EXPENDITURES & LIABILITIES', 'AMOUNT (INR)'],
      ['Raw Material Purchases', periodFinancials.purchasesTotal],
      ['Factory & Operating Expenses', periodFinancials.expensesTotal],
      ['Worker Labor Payroll', periodFinancials.payrollTotal],
      ['TOTAL OPERATING EXPENDITURES', periodFinancials.totalCosts],
      [],
      ['EXECUTIVE SUMMARY', 'VALUE'],
      ['Net Operating Profit / Loss', periodFinancials.netProfit],
      ['Operating Margin (%)', `${periodFinancials.netMarginPercent.toFixed(2)}%`],
      ['Total Paid by Customers', periodFinancials.salesPaidTotal],
      ['Pending Customer Receivables', periodFinancials.salesPendingTotal],
      [],
      ['MONTHLY TRENDS (' + currentYear + ')', 'SALES & INCOME', 'PURCHASES', 'EXPENSES', 'PAYROLL', 'NET P&L'],
      ...monthlyStats.map((m) => {
        const rev = m.sales + m.income + m.scrapRevenue;
        const cost = m.purchases + m.expenses + m.payroll;
        return [m.name, rev, m.purchases, m.expenses, m.payroll, rev - cost];
      }),
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + lines.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Dana_Company_Financial_Report_${range.label.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-7">
      {/* Top Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Finance / Executive Reports
          </p>
          <h1 className="font-heading text-3xl font-semibold md:text-4xl">Financial Reports &amp; Statement</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete audited financial report across sales, scrap revenue, raw purchases, payroll, operating expenses, and profit/loss.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-sm"
            onClick={exportCsv}
          >
            <ApperIcon name="Download" size={16} />
            Export CSV
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-sm bg-primary text-primary-foreground shadow-sm"
            onClick={() => setReportModalOpen(true)}
          >
            <ApperIcon name="FileSpreadsheet" size={16} />
            Export / Print PDF
          </Button>
        </div>
      </div>

      {/* Period Filter for Financial Reports */}
      <div className="rounded-sm border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reporting Period</p>
            <p className="font-semibold text-sm text-foreground">{range.label}</p>
          </div>
          <PeriodControls
            type={periodType}
            onTypeChange={setPeriodType}
            anchorDate={anchorDate}
            onAnchorDateChange={setAnchorDate}
            showYearly={true}
          />
        </div>
      </div>

      {/* Executive Profit & Loss Card */}
      <section className="overflow-hidden rounded-sm border-2 border-border bg-card shadow-md">
        <div className="border-b border-border bg-muted/40 px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded bg-primary/10 text-primary">
              <ApperIcon name="Scale" size={16} />
            </span>
            <h2 className="font-heading text-lg font-bold">Profit &amp; Loss Statement ({range.label})</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setReportModalOpen(true)}
            className="text-xs text-primary hover:text-primary gap-1"
          >
            <ApperIcon name="Printer" size={14} />
            View / Print Official Statement
          </Button>
        </div>

        <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
          {/* Revenue */}
          <div className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Gross Revenue</p>
            <p className="mt-2 font-heading text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {busy ? <Skeleton className="h-9 w-36" /> : cash(periodFinancials.totalRevenue)}
            </p>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground border-t border-border pt-2.5">
              <div className="flex justify-between">
                <span>Finished Sales:</span>
                <span className="font-medium text-foreground">{cash(periodFinancials.salesTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Scrap Monetization:</span>
                <span className="font-medium text-foreground">{cash(periodFinancials.scrapRevenueTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Other Income:</span>
                <span className="font-medium text-foreground">{cash(periodFinancials.otherIncomeTotal)}</span>
              </div>
            </div>
          </div>

          {/* Costs */}
          <div className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Operating Expenditures</p>
            <p className="mt-2 font-heading text-3xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
              {busy ? <Skeleton className="h-9 w-36" /> : cash(periodFinancials.totalCosts)}
            </p>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground border-t border-border pt-2.5">
              <div className="flex justify-between">
                <span>Raw Material Purchases:</span>
                <span className="font-medium text-foreground">{cash(periodFinancials.purchasesTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Factory Expenses:</span>
                <span className="font-medium text-foreground">{cash(periodFinancials.expensesTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Labor Payroll:</span>
                <span className="font-medium text-foreground">{cash(periodFinancials.payrollTotal)}</span>
              </div>
            </div>
          </div>

          {/* Bottom-Line Net Profit / Loss */}
          <div className={`p-5 ${isProfitable ? 'bg-emerald-500/5' : 'bg-rose-500/5'}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Net Operating {isProfitable ? 'Profit' : 'Loss'}
              </p>
              <span
                className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                  isProfitable ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
                }`}
              >
                {isProfitable ? 'Profitable' : 'Deficit'}
              </span>
            </div>
            <p
              className={`mt-2 font-heading text-3xl font-bold tabular-nums ${
                isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {busy ? <Skeleton className="h-9 w-36" /> : cash(periodFinancials.netProfit)}
            </p>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground border-t border-border pt-2.5">
              <div className="flex justify-between">
                <span>Operating Profit Margin:</span>
                <span className="font-bold text-foreground">
                  {periodFinancials.totalRevenue > 0 ? `${periodFinancials.netMarginPercent.toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Pending Customer Receivables:</span>
                <span className="font-medium text-amber-600 dark:text-amber-400">{cash(periodFinancials.salesPendingTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Grid of Key Financial Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Sales Revenue"
          value={cash(periodFinancials.salesTotal)}
          note={`${periodFinancials.salesCount} sale records · ${cash(periodFinancials.salesPaidTotal)} paid`}
          icon="TrendingUp"
          color="text-emerald-600 dark:text-emerald-400"
        />
        <Metric
          label="Scrap Revenue"
          value={cash(periodFinancials.scrapRevenueTotal)}
          note={`Industrial waste sold · ${kg(periodFinancials.scrapInStorageKg)} scrap in storage`}
          icon="Recycle"
          color="text-emerald-600 dark:text-emerald-400"
        />
        <Metric
          label="Raw Material Purchases"
          value={cash(periodFinancials.purchasesTotal)}
          note={`${periodFinancials.purchasesCount} purchase orders recorded`}
          icon="ShoppingCart"
        />
        <Metric
          label="Payroll & Wages"
          value={cash(periodFinancials.payrollTotal)}
          note={`${periodFinancials.payrollEntriesCount} marked attendance records in period`}
          icon="WalletCards"
        />
      </div>

      {/* Production & Finished Inventory Stock Table */}
      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">In-Hand Production &amp; Stock</p>
            <h2 className="mt-1 font-heading text-xl font-semibold">Finished product on hand</h2>
          </div>
          <span className="text-xs text-muted-foreground">Cumulative produced minus sales, by product</span>
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
                  <th className="px-5 py-3 text-right font-semibold">Available in Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {producedStock.data.map((item) => (
                  <tr key={item.key} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-5 py-3 font-medium">{item.name}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{kg(item.produced)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{kg(item.sold)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right font-bold tabular-nums text-foreground">
                      {kg(item.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Monthly Financial Performance Table */}
      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Monthly financial trends</p>
            <h2 className="mt-1 font-heading text-xl font-semibold">Full financial dimensions by month ({currentYear})</h2>
          </div>
          <span className="text-xs text-muted-foreground">Purchases, sales, scrap revenue, expenses &amp; payroll</span>
        </div>
        {busy ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold">Month</th>
                  <th className="px-5 py-3 text-right font-semibold">Sales &amp; Income</th>
                  <th className="px-5 py-3 text-right font-semibold">Purchases</th>
                  <th className="px-5 py-3 text-right font-semibold">Expenses</th>
                  <th className="px-5 py-3 text-right font-semibold">Payroll</th>
                  <th className="px-5 py-3 text-right font-semibold">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {monthlyStats.map((month) => {
                  const monthRevenue = month.sales + month.income + month.scrapRevenue;
                  const monthCosts = month.purchases + month.expenses + month.payroll;
                  const monthNet = monthRevenue - monthCosts;
                  return (
                    <tr key={month.key} className="hover:bg-muted/40">
                      <td className="whitespace-nowrap px-5 py-3 font-medium">{month.name}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                        {cash(monthRevenue)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{cash(month.purchases)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{cash(month.expenses)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{cash(month.payroll)}</td>
                      <td
                        className={`whitespace-nowrap px-5 py-3 text-right tabular-nums font-bold ${
                          monthNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {cash(monthNet)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold bg-muted/30">
                <tr>
                  <td className="whitespace-nowrap px-5 py-3">Year total ({currentYear})</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-emerald-600 font-bold">
                    {cash(monthlyTotals.sales + monthlyTotals.income)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-bold">{cash(monthlyTotals.purchases)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-bold">{cash(monthlyTotals.expenses)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums font-bold">{cash(monthlyTotals.payroll)}</td>
                  <td
                    className={`whitespace-nowrap px-5 py-3 text-right tabular-nums font-bold ${
                      monthlyTotals.sales + monthlyTotals.income - (monthlyTotals.purchases + monthlyTotals.expenses + monthlyTotals.payroll) >= 0
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {cash(
                      monthlyTotals.sales + monthlyTotals.income - (monthlyTotals.purchases + monthlyTotals.expenses + monthlyTotals.payroll)
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* PDF / Printable Financial Statement Modal */}
      <FinancialReportPdfModal
        open={reportModalOpen}
        onOpenChange={setReportModalOpen}
        periodLabel={range.label}
        financials={periodFinancials}
      />
    </div>
  );
}

