import { PurchaseList } from '@/components/PurchaseManagement';

export const route = { path: '/purchases', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'ShoppingCart', label: 'Purchases', section: 'Finance', order: 43 };

export default function PurchasesPage() {
  return <PurchaseList />;
}
