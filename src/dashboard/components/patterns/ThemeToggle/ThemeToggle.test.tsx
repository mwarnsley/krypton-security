// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('switches both ways and persists the selected theme', () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('krypton-theme')).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
  expect(document.documentElement.dataset.theme).toBe('light');
});
it('restores a saved choice over the system preference', () => {
  localStorage.setItem('krypton-theme', 'dark');
  render(<ThemeToggle />);
  expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy();
});
it('uses the system preference when a stored choice is invalid', () => {
  localStorage.setItem('krypton-theme', 'invalid');
  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe('light');
});
it('keeps switching available when reading storage fails', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
});
it('announces a persistence failure while applying the choice', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(screen.getByRole('status').textContent).toContain('cannot be saved');
});
