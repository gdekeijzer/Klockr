import type { Metadata } from 'next';
import { DeviceDisplay } from './device-display';

export const metadata: Metadata = {
  title: 'Device — KLOCKR',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function DevicePage() {
  return <DeviceDisplay />;
}
