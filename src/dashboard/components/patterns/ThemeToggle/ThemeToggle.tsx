'use client';

import { Moon, Sun } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { KryptonIconButton } from '../../primitives';

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'krypton-theme';

/**
 * Observes the document theme and initializes it from a saved or system choice.
 * Storage failures retain a usable session theme; listeners are removed on unmount.
 * @param {() => void} notify - React's external-store change listener.
 * @returns {() => void} Cleanup for the media and DOM observers.
 * @complexity O(1) time and space per subscription or change.
 * @example subscribeTheme(() => console.log('theme changed'));
 */
function subscribeTheme(notify: () => void): () => void {
  const root = document.documentElement;
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let choice: Theme | undefined;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') choice = saved;
  } catch (error: unknown) {
    // The preference is optional; a blocked browser store never disables the UI.
    void error;
    root.dataset.themeStorage = 'unavailable';
  }
  const applySystemTheme = (): void => {
    root.dataset.theme = media?.matches === false ? 'light' : 'dark';
  };
  root.dataset.theme = choice ?? (media?.matches === false ? 'light' : 'dark');
  const handleSystemChange = (): void => {
    // A manual session choice wins even if persistence is unavailable.
    if (root.dataset.themeChoice !== 'manual' && choice === undefined) applySystemTheme();
  };
  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    choice = event.newValue === 'dark' || event.newValue === 'light' ? event.newValue : undefined;
    delete root.dataset.themeChoice;
    if (choice) root.dataset.theme = choice;
    else applySystemTheme();
  };
  const observer = new MutationObserver(notify);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  media?.addEventListener('change', handleSystemChange);
  window.addEventListener('storage', handleStorage);
  notify();
  return () => {
    observer.disconnect();
    media?.removeEventListener('change', handleSystemChange);
    window.removeEventListener('storage', handleStorage);
  };
}

const getTheme = (): Theme =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
const getServerTheme = (): Theme => 'dark';

export function ThemeToggle(): React.JSX.Element {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const [storageFailed, setStorageFailed] = useState(false);
  const switchTheme = useCallback((): void => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.dataset.themeChoice = 'manual';
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      setStorageFailed(false);
    } catch (error: unknown) {
      void error;
      setStorageFailed(true);
    }
  }, [theme]);

  return (
    <div className="shrink-0">
      <KryptonIconButton
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        onClick={switchTheme}
        icon={theme === 'dark' ? <Sun /> : <Moon />}
        size="sm"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      />
      <span role="status" className="sr-only">
        {storageFailed ? 'Theme applied but cannot be saved in this browser.' : ''}
      </span>
    </div>
  );
}
