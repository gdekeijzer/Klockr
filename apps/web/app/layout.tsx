import '@fontsource-variable/inter';
import '@fontsource/roboto-mono/500.css';
import '@fontsource/roboto-mono/600.css';
import '@fontsource/roboto-mono/700.css';
import { tokensCss } from '@klockr/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'KLOCKR',
  description: 'Stage timer and show control',
};

export const viewport: Viewport = {
  themeColor: '#0B0B0D',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Design tokens generated from docs/design/tokens.json (repository content only). */}
        <style dangerouslySetInnerHTML={{ __html: tokensCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
