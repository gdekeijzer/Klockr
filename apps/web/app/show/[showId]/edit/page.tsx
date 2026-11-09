import type { Metadata } from 'next';
import { QueueEditor } from './queue-editor';

export const metadata: Metadata = {
  title: 'Queue editor — KLOCKR',
  robots: { index: false, follow: false },
};

export default async function QueueEditorPage({ params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  return <QueueEditor showId={showId} />;
}
