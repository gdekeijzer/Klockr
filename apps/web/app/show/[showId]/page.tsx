import type { Metadata } from 'next';
import { OperatorView } from './operator-view';

export const metadata: Metadata = {
  title: 'Operator — KLOCKR',
  robots: { index: false, follow: false },
};

export default async function OperatorPage({ params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  return <OperatorView showId={showId} />;
}
