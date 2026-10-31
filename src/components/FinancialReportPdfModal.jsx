import React, { useRef } from 'react';
import { formatLocalDate, DATE_FORMATS } from '@/utils/date';
import { printHtmlContent } from '@/utils/printDocument';
import ApperIcon from '@/components/ApperIcon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const cash = (val) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(val ?? 0));

const kg = (val) =>
  Number(val ?? 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  }) + ' kg';

export default function FinancialReportPdfModal({
  open,
  onOpenChange,
  periodLabel,
  financials,
}) {
  const printAreaRef = useRef(null);

  if (!financials) return null;

  const {
    salesTotal = 0,
    salesPaidTotal = 0,
    salesPendingTotal = 0,
    scrapRevenueTotal = 0,
    otherIncomeTotal = 0,
    totalRevenue = 0,
    purchasesTotal = 0,
    expensesTotal = 0,
    payrollTotal = 0,
    totalCosts = 0,
    netProfit = 0,
    netMarginPercent = 0,
    totalProducedKg = 0,
    stockOnHandKg = 0,
    scrapInStorageKg = 0,
    salesCount = 0,
    expensesCount = 0,
    purchasesCount = 0,
    payrollEntriesCount = 0,
  } = financials;

  function handlePrint() {
    if (printAreaRef.current) {
      printHtmlContent(printAreaRef.current, `Financial_Report_${periodLabel.replace(/\s+/g, '_')}`);
    } else {
      window.print();
    }
  }

  function handleExportCsv() {
    const rows = [
      ['DANA COMPANY - FINANCIAL REPORT', periodLabel],
      ['Generated On', new Date().toLocaleString('en-IN')],
      [],
      ['REVENUE DIMENSION', 'AMOUNT (INR)'],
      ['Product Sales Revenue', salesTotal],
      ['Scrap / Wastage Revenue', scrapRevenueTotal],
      ['Other Income', otherIncomeTotal],
      ['TOTAL GROSS REVENUE', totalRevenue],
      [],
      ['COST DIMENSION', 'AMOUNT (INR)'],
      ['Raw Material Purchases', purchasesTotal],
      ['Factory & General Expenses', expensesTotal],
      ['Labor & Staff Payroll Wages', payrollTotal],
      ['TOTAL OPERATING EXPENDITURES', totalCosts],
      [],
      ['PROFIT & LOSS', 'AMOUNT (INR)'],
      ['NET OPERATING PROFIT / (LOSS)', netProfit],
      ['Operating Margin (%)', `${netMarginPercent.toFixed(2)}%`],
      [],
      ['RECEIVABLES & CASH FLOW', 'AMOUNT (INR)'],
      ['Sales Amount Collected (Paid)', salesPaidTotal],
      ['Sales Pending Receivables (Due)', salesPendingTotal],
      [],
      ['PRODUCTION & ASSETS', 'QUANTITY (KG)'],
      ['Total Castings Produced', totalProducedKg],
      ['Finished Stock on Hand', stockOnHandKg],
      ['Unsold Scrap in Storage', scrapInStorageKg],
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Dana_Company_Financial_Report_${periodLabel.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const isProfitable = netProfit >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border p-4 pb-3 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <DialogTitle className="font-heading text-lg font-semibold">
                Financial Report & Statement of Profit / Loss
              </DialogTitle>
              <p className="text-xs text-muted-foreground">Reporting Period: {periodLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleExportCsv} className="gap-1.5 rounded-sm">
                <ApperIcon name="Download" size={14} />
                Export CSV
              </Button>
              <Button type="button" size="sm" onClick={handlePrint} className="gap-1.5 rounded-sm bg-primary text-primary-foreground">
                <ApperIcon name="Printer" size={14} />
                Export as PDF / Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Printable Statement Container */}
        <div id="financial-statement-print-area" ref={printAreaRef} className="bg-white p-6 text-slate-900 sm:p-8">

          {/* Statement Header */}
          <div className="flex flex-col justify-between border-b-2 border-slate-900 pb-5 sm:flex-row sm:items-start">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex size-10 items-center justify-center rounded bg-slate-900 font-bold text-white text-xl">
                  D
                </div>
                <div>
                  <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900">DANA COMPANY</h1>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                    Foundry Operations & Financial Management
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-600">Industrial Area, Foundry Division · ops@danacompany.in</p>
            </div>

            <div className="mt-4 text-left sm:mt-0 sm:text-right">
              <span className="inline-block rounded bg-slate-100 px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-slate-800">
                FINANCIAL STATEMENT & P&amp;L
              </span>
              <p className="mt-2 text-xs font-semibold text-slate-500">Statement Period</p>
              <p className="font-semibold text-sm text-slate-900">{periodLabel}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Generated: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Executive Summary Card */}
          <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Executive Summary</h2>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-600">Total Gross Revenue</p>
                <p className="mt-1 font-heading text-xl font-bold text-emerald-700 tabular-nums">
                  {cash(totalRevenue)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-600">Total Operating Costs</p>
                <p className="mt-1 font-heading text-xl font-bold text-slate-800 tabular-nums">
                  {cash(totalCosts)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-600">Net Operating {isProfitable ? 'Profit' : 'Loss'}</p>
                <p
                  className={`mt-1 font-heading text-xl font-bold tabular-nums ${
                    isProfitable ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {cash(netProfit)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-600">Operating Margin</p>
                <p
                  className={`mt-1 font-heading text-xl font-bold tabular-nums ${
                    isProfitable ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {totalRevenue > 0 ? `${netMarginPercent.toFixed(1)}%` : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* Breakdown Section: Revenue & Expenditures Table */}
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {/* Revenue Side */}
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="bg-emerald-50 px-4 py-2.5 border-b border-slate-200">
                <h3 className="font-bold text-xs uppercase tracking-wider text-emerald-900">
                  1. Revenue &amp; Income
                </h3>
              </div>
              <table className="w-full text-xs text-left">
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700 font-medium">Finished Product Sales ({salesCount} records)</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{cash(salesTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700 font-medium">Scrap &amp; Wastage Monetization</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{cash(scrapRevenueTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700 font-medium">Other Operating Income</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{cash(otherIncomeTotal)}</td>
                  </tr>
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td className="py-2.5 px-4 font-bold text-slate-900">Total Gross Revenue</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-emerald-700">{cash(totalRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Expenditure Side */}
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800">
                  2. Costs &amp; Expenditures
                </h3>
              </div>
              <table className="w-full text-xs text-left">
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700 font-medium">Raw Material Purchases ({purchasesCount} orders)</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{cash(purchasesTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700 font-medium">Operating &amp; Workshop Expenses ({expensesCount} entries)</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{cash(expensesTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700 font-medium">Labor &amp; Worker Payroll ({payrollEntriesCount} shifts)</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{cash(payrollTotal)}</td>
                  </tr>
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td className="py-2.5 px-4 font-bold text-slate-900">Total Operating Costs</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-slate-900">{cash(totalCosts)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Cash Flow & Physical Asset Metrics */}
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {/* Sales Cash Flow & Receivables */}
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                  3. Receivables &amp; Collections
                </h3>
              </div>
              <table className="w-full text-xs text-left">
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700">Customer Payments Collected</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-emerald-700">{cash(salesPaidTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700">Pending Customer Receivables (Balance Due)</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-amber-700">{cash(salesPendingTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Production & Scrap Stock */}
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                  4. Production &amp; Scrap Inventory
                </h3>
              </div>
              <table className="w-full text-xs text-left">
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700">Finished Product on Hand (Stock)</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{kg(stockOnHandKg)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-slate-700">Unsold Industrial Scrap in Storage</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">{kg(scrapInStorageKg)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Profit / Loss Verification Stamp */}
          <div className="mt-6 rounded-md border-2 border-slate-900 p-4 bg-slate-50/50">
            <div className="flex flex-col justify-between sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Net Operating Bottom-Line
                </p>
                <p className="text-xs text-slate-500">Total Gross Revenue minus Total Operating Expenditures</p>
              </div>
              <div className="mt-2 text-left sm:mt-0 sm:text-right">
                <p
                  className={`font-heading text-2xl font-bold tabular-nums ${
                    isProfitable ? 'text-emerald-800' : 'text-rose-800'
                  }`}
                >
                  {cash(netProfit)}
                </p>
                <p className="text-xs font-semibold text-slate-700">
                  Status: {isProfitable ? 'NET PROFITABLE' : 'NET OPERATING LOSS'}
                </p>
              </div>
            </div>
          </div>

          {/* Signature & Endorsement */}
          <div className="mt-10 flex items-end justify-between border-t border-slate-200 pt-6">
            <div className="text-center text-xs text-slate-500">
              <div className="h-10"></div>
              <p className="border-t border-slate-300 pt-1 font-medium">Prepared by (Operations / Admin)</p>
            </div>
            <div className="text-center text-xs text-slate-500">
              <div className="h-10 flex items-center justify-center font-serif italic text-slate-400">DANA COMPANY</div>
              <p className="border-t border-slate-300 pt-1 font-medium">Authorized Signatory / Managing Partner</p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 border-t border-border p-4 sm:px-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" onClick={handlePrint} className="gap-1.5">
            <ApperIcon name="Printer" size={15} />
            Export as PDF / Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

