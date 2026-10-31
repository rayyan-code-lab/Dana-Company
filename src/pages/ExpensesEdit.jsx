import { SimpleFinanceForm } from '@/components/SimpleFinanceModule';

export const route = { path: '/expenses/:id/edit', layout: 'owner', access: 'authenticated' };

export default function ExpensesEditPage() {
  return <SimpleFinanceForm kind="expenses" mode="edit" />;
}

