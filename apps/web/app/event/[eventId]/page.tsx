import type { Metadata } from 'next';
import { EventDashboard } from './event-dashboard';

export const metadata: Metadata = {
  title: 'Event Dashboard — KLOCKR',
  robots: { index: false, follow: false },
};

export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventDashboard eventId={eventId} />;
}
