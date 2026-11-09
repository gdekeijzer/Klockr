import type { Metadata } from 'next';
import { BoardsView } from './boards-view';

export const metadata: Metadata = {
  title: 'Boards — KLOCKR',
  robots: { index: false, follow: false },
};

export default async function BoardsPage({ params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  return <BoardsView showId={showId} />;
}
