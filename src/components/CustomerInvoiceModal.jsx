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

export default function CustomerInvoiceModal({ sale, open, onOpenChange }) {
  const printAreaRef = useRef(null);

  if (!sale) return null;

  const total = Number(sale.amount_c ?? 0);
  const paid = Number(sale.paidAmount_c ?? total);
  const pending = Number(sale.balanceDue_c ?? Math.max(0, total - paid));
  const status = sale.paymentStatus_c || (pending <= 0 ? 'Paid' : paid <= 0 ? 'Unpaid' : 'Partially Paid');

  function handlePrint() {
    if (printAreaRef.current) {
      printHtmlContent(printAreaRef.current, `Invoice_${sale.saleId_c || sale.Name}`);
    } else {
      window.print();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border p-4 pb-3 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="font-heading text-lg font-semibold">Customer Invoice</DialogTitle>
              <p className="text-xs text-muted-foreground">Invoice #{sale.saleId_c || sale.Name}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={handlePrint} className="gap-1.5 rounded-sm">
                <ApperIcon name="Printer" size={15} />
                Print / Save PDF
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Printable Invoice Container */}
        <div id="customer-invoice-print-area" ref={printAreaRef} className="bg-white p-6 text-slate-900 sm:p-8">

          {/* Header */}
          <div className="flex flex-col justify-between border-b-2 border-slate-900 pb-5 sm:flex-row sm:items-start">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded bg-slate-900 text-white font-bold text-lg">
                  D
                </div>
                <div>
                  <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900">DANA COMPANY</h1>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-widest">Foundry & Manufacturing Operations</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-600">Industrial Area, Foundry Division</p>
              <p className="text-xs text-slate-600">Tel: +91 98765 43210 · ops@danacompany.in</p>
            </div>
            <div className="mt-4 text-left sm:mt-0 sm:text-right">
              <span className="inline-block rounded bg-slate-100 px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-slate-800">
                TAX INVOICE
              </span>
              <p className="mt-2 text-xs font-semibold text-slate-500">Invoice No.</p>
              <p className="font-mono text-sm font-bold text-slate-900">{sale.saleId_c || sale.Name}</p>
              <p className="mt-1 text-xs text-slate-600">
                Date: <span className="font-semibold">{formatLocalDate(sale.saleDate_c, DATE_FORMATS.SHORT)}</span>
              </p>
            </div>
          </div>

          {/* Billed To */}
          <div className="mt-5 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 border border-slate-200">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Billed To (Customer)</p>
              <p className="mt-1 text-base font-bold text-slate-900">{sale.customerName_c || 'Cash Customer'}</p>
              {sale.customerContact_c && (
                <p className="mt-0.5 text-xs text-slate-600">Contact: {sale.customerContact_c}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Payment Status</p>
              <div className="mt-1 flex justify-end">
                <span
                  className={`inline-flex items-center rounded-sm px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                    status === 'Paid'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : status === 'Partially Paid'
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-rose-100 text-rose-800 border border-rose-300'
                  }`}
                >
                  {status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">Payment Method: <span className="font-semibold text-slate-700">{sale.paymentMethod_c || 'Cash'}</span></p>
            </div>
          </div>

          {/* Items Table */}
          <div className="mt-6 overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4">#</th>
                  <th className="py-2.5 px-4">Description of Goods</th>
                  <th className="py-2.5 px-4 text-right">Quantity (kg)</th>
                  <th className="py-2.5 px-4 text-right">Rate / kg (₹)</th>
                  <th className="py-2.5 px-4 text-right">Total Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                <tr>
                  <td className="py-3 px-4 font-mono text-xs">01</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    {sale.productName_c || 'Cast Metal Product'}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {Number(sale.weightKg_c || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {Number(sale.unitPrice_c || 0).toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-bold tabular-nums text-slate-900">
                    {cash(total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Payment Division Breakdown */}
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">Notes & Terms:</p>
              <p className="mt-1 text-slate-600">{sale.notes_c || 'Goods once sold cannot be returned. All disputes subject to local jurisdiction.'}</p>
            </div>

            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-4">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-800">{cash(total)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-200 pt-2">
                <span>Grand Total</span>
                <span>{cash(total)}</span>
              </div>
              <div className="flex justify-between text-xs font-semibold text-emerald-700">
                <span>Amount Paid</span>
                <span>{cash(paid)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-dashed border-slate-300 pt-2 text-rose-700">
                <span>Balance Pending / Due</span>
                <span>{cash(pending)}</span>
              </div>
            </div>
          </div>

          {/* Signatures */}
          <div className="mt-10 flex items-end justify-between border-t border-slate-200 pt-6">
            <div className="text-center text-xs text-slate-500">
              <div className="h-10"></div>
              <p className="border-t border-slate-300 pt-1 font-medium">Customer Signature</p>
            </div>
            <div className="text-center text-xs text-slate-500">
              <div className="h-10 flex items-center justify-center font-serif italic text-slate-400">DANA COMPANY</div>
              <p className="border-t border-slate-300 pt-1 font-medium">Authorized Signatory</p>
            </div>
          </div>
        </div>

        {/* Modal Footer (Screen only) */}
        <div className="flex justify-end gap-2 border-t border-border p-4 sm:px-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" onClick={handlePrint} className="gap-1.5">
            <ApperIcon name="Printer" size={15} />
            Print / Save PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

