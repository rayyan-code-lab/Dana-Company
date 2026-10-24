import { SimpleFinanceForm } from '@/components/SimpleFinanceModule';

export const route = { path: '/sales/:id/edit', layout: 'owner', access: 'authenticated' };

export default function SalesEditPage() {
  return <SimpleFinanceForm kind="sales" mode="edit" />;
}