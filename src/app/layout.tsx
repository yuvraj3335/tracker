import { ViewTransition } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';
import { CelebrationLayer } from '@/components/celebration';
import { CharacterProvider } from '@/components/character-provider';
import { CommandPalette } from '@/components/command-palette';
import { UndoToast } from '@/components/undo-toast';
import { currentUser } from '@/lib/tenant';
import { discoverCharacters } from '@/lib/characters.server';

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
  // Filesystem walk, cached for the process. Usually empty — the app ships with
  // no artwork and falls back to the built-in SVG mascots.
  const characters = discoverCharacters();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <CharacterProvider catalog={characters}>
          <Nav username={user?.username ?? null} />
          {/* pb-20 keeps content clear of the mobile bottom bar.

              <ViewTransition> cross-fades route changes through the browser's
              View Transitions API. Next's navigations are React Transitions, so
              this activates on its own with no config. Where the API is missing
              it is a no-op and navigation is exactly as it was. */}
          <main className="mx-auto max-w-5xl px-3 pt-4 pb-20 sm:px-4 sm:pb-10">
            <ViewTransition>{children}</ViewTransition>
          </main>
          {/* Fixed, pointer-events-none: never blocks a tap or shifts the page. */}
          <CelebrationLayer />
          {/* Separate from the celebration because it has to be clickable. */}
          <UndoToast />
          {/* Cmd-K anywhere. Renders nothing until first opened. */}
          <CommandPalette />
        </CharacterProvider>
      </body>
    </html>
  );
}
