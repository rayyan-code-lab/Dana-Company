import WageManagement from '@/components/WageManagement';

export const route = { path: '/payroll', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'WalletCards', label: 'Payroll', section: 'Finance', order: 42 };

export default function PayrollPage() {
  return <WageManagement />;
}
