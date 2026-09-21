import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';
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

/** Applies the saved theme before first paint so there is no flash. */
const THEME_SCRIPT = `try{var t=localStorage.getItem('jst-theme');if(t&&t!=='system')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Memoised, so the page's own lookup does not cost a second query.
  const user = await currentUser();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Nav username={user?.username ?? null} />
        {/* pb-20 keeps content clear of the mobile bottom bar */}
        <main className="mx-auto max-w-5xl px-3 pt-4 pb-20 sm:px-4 sm:pb-10">{children}</main>
      </body>
    </html>
  );
}
