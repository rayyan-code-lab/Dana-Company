import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import ApperIcon from '@/components/ApperIcon';
import { sdk } from '@/services/sdk';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export const route = { path: '/admin', layout: 'owner', access: "profile === 'Admin_c'" };
export const nav = { icon: 'Settings2', label: 'Admin panel', section: 'Administration', profiles: ['Admin_c'], order: 90 };

const modules = [
  ['ShoppingCart', 'Purchase management', 'Purchases, supplier balances, payment history and stock-in links.', '/purchases'],
  ['TrendingUp', 'Sales', 'Record customer sales and review sales totals.', '/sales'],
  ['ReceiptIndianRupee', 'Expenses', 'Log operating expenses and review spending totals.', '/expenses'],
  ['Users', 'Workers', 'Worker details, role and individual daily rate.', '/workers'],
  ['CalendarCheck', 'Attendance', 'Daily presence, hours worked and overtime.', '/attendance'],
  ['WalletCards', 'Payroll', 'Individual gross pay, advances, deductions and net pay.', '/payroll'],
];

const DATA_TABLES = [
  'purchase_payments_c',
  'purchase_audit_c',
  'stock_movements_c',
  'worker_payments_c',
  'borrowing_repayments_c',
  'owner_funding_repayments_c',
  'transactions_c',
  'attendance_c',
  'payroll_c',
  'sales_c',
  'expenses_c',
  'production_c',
  'purchases_c',
  'stock_items_c',
  'borrowings_c',
  'owner_funding_c',
  'lenders_c',
  'workers_c',
];

async function clearTable(table) {
  for (let batch = 0; batch < 10000; batch += 1) {
    const page = await sdk.table(table).select(['Id']).page(1, 100).fetch();
    if (!page.success) throw new Error(page.message);
    const ids = (page.data ?? []).map((row) => row.Id);
    if (!ids.length) return;
    const res = await sdk.table(table).remove(ids);
    if (res.messages.length) throw new Error(res.messages.join('; '));
  }
  throw new Error(`${table}: batch limit reached`);
}

function ClearAllDataAction() {
  const [open, setOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClear = async (event) => {
    event.preventDefault();
    setIsClearing(true);
    let current = null;
    try {
      for (const table of DATA_TABLES) {
        current = table;
        await clearTable(table);
      }
      toast.success('All app data has been cleared');
      setOpen(false);
    } catch (error) {
      toast.error(`Clearing stopped at ${current}`, { description: error.message, duration: 8000 });
      console.error(`clear all data failed at ${current}: ${error.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <section className="border border-destructive/30 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center bg-destructive/10 text-destructive">
          <ApperIcon name="Trash2" size={20} />
        </span>
        <div>
          <h2 className="font-heading text-lg font-semibold">Clear all data</h2>
          <p className="text-sm text-muted-foreground">Permanently deletes every record in the operational tables. Users are kept.</p>
        </div>
      </div>
      <AlertDialog open={open} onOpenChange={(next) => !isClearing && setOpen(next)}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="mt-4">Clear all data</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every sale, purchase, production, payroll, expense, worker, attendance, finance and stock record. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isClearing} onClick={handleClear}>
              {isClearing ? 'Clearing…' : 'Yes, delete everything'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default function AdminPage() {
  const { profile } = useProfile();

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Workspace controls</p>
        <h1 className="font-heading text-3xl font-semibold">Admin panel</h1>
        <p className="mt-2 text-sm text-muted-foreground">Quick access to company records and access policies.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {modules.map(([icon, title, description, to]) => (
          <Link key={to} to={to} className="flex gap-4 border border-border bg-card p-5 shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-muted">
              <ApperIcon name={icon} size={20} />
            </span>
            <span className="flex-1">
              <span className="block font-heading text-lg font-semibold">{title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{description}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Open module <ApperIcon name="ArrowRight" size={13} />
              </span>
            </span>
          </Link>
        ))}
      </div>

      <section className="border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center bg-success-muted text-success">
            <ApperIcon name="ShieldCheck" size={20} />
          </span>
          <div>
            <h2 className="font-heading text-lg font-semibold">Current access profile</h2>
            <p className="text-sm text-muted-foreground">
              {profile === 'Admin_c' ? 'Administrator · full module access' : 'Manager · operations access'}
            </p>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
          Managers can record stock, worker and attendance changes, purchases, supplier payments, sales and expenses.
          Purchase detail changes and cancellation are restricted to administrators in the interface.
          Permanent database connection and server-enforced permissions are still required before entering live records.
        </div>
      </section>
      {profile === 'Admin_c' && <ClearAllDataAction />}
    </div>
  );
}
