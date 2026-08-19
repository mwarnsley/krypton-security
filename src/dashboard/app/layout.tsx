import type { ReactNode } from 'react';

import { Toaster } from '../components/ui/Toaster';

import './globals.css';

interface RootLayoutProps {
  /** The active dashboard route content rendered inside the document body. */
  readonly children: ReactNode;
}

export default function RootLayout(props: RootLayoutProps): React.JSX.Element {
  const { children } = props;

  return (
    <html lang="en">
      <body className="min-h-screen bg-krypton-bg-main text-krypton-fg-primary antialiased">
        {children}
        <Toaster closeButton limit={3} position="top-right" richColors theme="dark" />
      </body>
    </html>
  );
}
