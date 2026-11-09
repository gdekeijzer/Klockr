import type { Metadata } from 'next';
import { NewEvent } from './new-event';

export const metadata: Metadata = { title: 'Plan an Event — KLOCKR' };

export default function NewEventPage() {
  return <NewEvent />;
}
