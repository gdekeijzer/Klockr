import type { Metadata } from 'next';
import { MasterView } from './master-view';

export const metadata: Metadata = {
  title: 'Master — KLOCKR',
  robots: { index: false, follow: false },
};

export default async function MasterPage({ params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  return <MasterView showId={showId} />;
}
