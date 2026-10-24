import ProductionManagement from '@/components/ProductionManagement';

export const route = { path: '/production', layout: 'owner', access: 'authenticated' };
export const nav = { icon: 'Factory', label: 'Production', section: 'Operations', order: 43 };

export default function ProductionPage() {
  return <ProductionManagement />;
}