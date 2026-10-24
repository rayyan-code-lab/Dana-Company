import { Navigate } from 'react-router-dom';

export const route = { path: '/payroll/new', layout: 'owner', access: 'authenticated' };

export default function PayrollNewPage() {
  return <Navigate to="/payroll" replace />;
}
