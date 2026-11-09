import type { Metadata } from 'next';
import { RoomView } from './room-view';

export const metadata: Metadata = {
  title: 'Room — KLOCKR',
  robots: { index: false, follow: false },
};

export default async function RoomPage({
  params,
}: {
  params: Promise<{ eventId: string; roomId: string }>;
}) {
  const { eventId, roomId } = await params;
  return <RoomView eventId={eventId} roomId={roomId} />;
}
