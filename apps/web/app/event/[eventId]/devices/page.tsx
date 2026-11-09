import type { Metadata } from 'next';
import { EventDevices } from './event-devices';

export const metadata: Metadata = {
  title: 'Devices & Boards — KLOCKR',
  robots: { index: false, follow: false },
};

export default async function EventDevicesPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <EventDevices eventId={eventId} />;
}
