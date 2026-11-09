import type { Metadata } from 'next';
import { SpeakerBoard } from './speaker-board';

export const metadata: Metadata = {
  title: 'Speaker Board — KLOCKR',
  // The board credential is in the URL: never leak it via Referer, never index it.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function BoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SpeakerBoard token={token} />;
}
