export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { Reports } from '@gitroom/frontend/components/reporting/reports';
export const metadata: Metadata = { title: 'Creative Social - Client reports' };
export default function Page() {
  return <Reports />;
}
