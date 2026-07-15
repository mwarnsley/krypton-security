import type { ReactNode } from 'react';

import { Toaster } from '../components/ui/Toaster';

import './globals.css';

interface RootLayoutProps {
  /** The active dashboard route content rendered inside the document body. */
  readonly children: ReactNode;
}

/**
 * Provides the semantic HTML document shell for every AegisAgent dashboard route.
 *
 * @param {RootLayoutProps} props - The nested route content to render within the document body.
 * @returns {React.JSX.Element} The dashboard root document containing the active route.
 * @example
 * <RootLayout>
 *   <DashboardPage />
 * </RootLayout>
 * // => renders the dashboard page inside the root HTML document
 */
export default function RootLayout(props: RootLayoutProps): React.JSX.Element {
  const { children } = props;

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
        <Toaster closeButton limit={3} position="top-right" richColors theme="dark" />
      </body>
    </html>
  );
}
