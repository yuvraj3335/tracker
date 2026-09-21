import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';
import { CelebrationLayer } from '@/components/celebration';
import { currentUser } from '@/lib/tenant';

export const metadata: Metadata = {
  title: 'Job Switch Tracker',
  description:
    'DSA and interview-prep tracker backed by your own Notion, with a derived daily tracker and activity heatmap.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9f9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0d' },
  ],
};

/**
 * Applies the saved mode AND skin before first paint, so there is no flash of
 * the wrong palette. Wrapped in try/catch because localStorage throws in a
 * private window — in which case the defaults simply apply.
 */
const APPEARANCE_SCRIPT = `try{var d=document.documentElement,m=localStorage.getItem('jst-theme'),s=localStorage.getItem('jst-skin');if(m&&m!=='system')d.setAttribute('data-theme',m);if(s&&s!=='studio')d.setAttribute('data-skin',s)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Memoised, so the page's own lookup does not cost a second query.
  const user = await currentUser();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Nav username={user?.username ?? null} />
        {/* pb-20 keeps content clear of the mobile bottom bar */}
        <main className="mx-auto max-w-5xl px-3 pt-4 pb-20 sm:px-4 sm:pb-10">{children}</main>
        {/* Fixed, pointer-events-none: never blocks a tap or shifts the page. */}
        <CelebrationLayer />
      </body>
    </html>
  );
}
