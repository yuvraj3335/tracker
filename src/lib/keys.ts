/**
 * Keyboard mapping, kept as pure functions so the bindings can be tested
 * without a DOM and documented in one place.
 *
 * Two rules the mapping enforces rather than leaving to each handler:
 *
 *  - Nothing fires while the user is typing. Every binding here is a bare
 *    letter, so without this a search box would be unusable — "b" would
 *    bookmark instead of typing a b.
 *  - Nothing fires with a modifier held, so browser and OS shortcuts keep
 *    working. Cmd/Ctrl-K is the single deliberate exception.
 */

export type SheetAction =
  | 'next'
  | 'prev'
  | 'toggle'
  | 'bookmark'
  | 'revisit'
  | 'focusSearch'
  | 'help'
  | 'dismiss';

export type KeyEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

/** True when the event came from somewhere the user is entering text. */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return node.isContentEditable === true;
}

function hasModifier(e: KeyEventLike): boolean {
  return Boolean(e.ctrlKey || e.metaKey || e.altKey);
}

/** Cmd-K / Ctrl-K, the one binding allowed to use a modifier. */
export function isPaletteShortcut(e: KeyEventLike): boolean {
  return (e.metaKey === true || e.ctrlKey === true) && e.key.toLowerCase() === 'k';
}

/**
 * The sheet's bindings.
 *
 * `typing` is passed in rather than read off the event so this stays pure and
 * the caller decides what counts — the search box uses its own Escape handling,
 * for instance.
 */
export function mapSheetKey(e: KeyEventLike, typing: boolean): SheetAction | null {
  // Escape works even while typing: it is how you get back out of the search
  // box, and it is never a character someone meant to enter.
  if (e.key === 'Escape') return 'dismiss';
  if (typing) return null;
  if (hasModifier(e)) return null;

  switch (e.key) {
    case 'j':
    case 'ArrowDown':
      return 'next';
    case 'k':
    case 'ArrowUp':
      return 'prev';
    // Enter ticks; Space is handled natively by the focused checkbox, so
    // claiming it here would double-toggle.
    case 'Enter':
      return 'toggle';
    case 'b':
      return 'bookmark';
    case 'r':
      return 'revisit';
    case '/':
      return 'focusSearch';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/** What the "?" overlay lists. Single source of truth for the bindings. */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['j', '↓'], label: 'Next question' },
  { keys: ['k', '↑'], label: 'Previous question' },
  { keys: ['Enter'], label: 'Tick / untick the focused question' },
  { keys: ['b'], label: 'Bookmark' },
  { keys: ['r'], label: 'Flag for revisit' },
  { keys: ['/'], label: 'Jump to search' },
  { keys: ['⌘K', 'Ctrl K'], label: 'Command palette' },
  { keys: ['?'], label: 'This list' },
  { keys: ['Esc'], label: 'Close / clear' },
];
