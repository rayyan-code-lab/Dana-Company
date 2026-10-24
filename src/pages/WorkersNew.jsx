import WorkerEditPage from './WorkerEdit';

export const route = { path: '/workers/new', layout: 'owner', access: 'authenticated' };

export default function WorkersNewPage() {
  return <WorkerEditPage create />;
}