// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://dashboard.example.com/"}

import { act, cleanup, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import DashboardPage from './DashboardPage';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each(['development', 'test', 'production'])(
  'includes guide and theme utilities inside the hero in %s',
  (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    const document = new DOMParser().parseFromString(
      renderToString(<DashboardPage />),
      'text/html'
    );
    const hero = document.querySelector('h1')?.closest('section');
    const utilities = hero?.querySelector('nav[aria-label="Dashboard utilities"]');
    expect(utilities?.textContent).not.toContain('About Guide');
    expect(utilities?.querySelector('button[aria-label="Switch to light mode"]')).not.toBeNull();
    expect(utilities?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Switch to light mode'
    );
    const overview = hero?.querySelector('section[aria-labelledby="firewall-overview-title"]');
    expect(overview?.querySelector('button[aria-label="Switch to light mode"]')).toBeNull();
    expect(overview?.querySelector('button')?.textContent).toBe('About Guide');
    expect(hero?.textContent).toContain('Active Workspace Protection');
    expect(hero?.textContent).not.toContain('Audit-Only Mode');
    const runtime = document.querySelector('section[aria-label="System status"]');
    expect(runtime?.textContent).toContain('Audit-Only Mode');
    expect(runtime?.textContent).toContain('Telemetry stream:');
    expect(runtime?.textContent).toContain('Mode unavailable');
    expect(runtime?.querySelector('button[role="switch"]')?.hasAttribute('disabled')).toBe(true);
    expect(runtime?.textContent).not.toContain('Guide');
    expect(
      document.querySelector('section[aria-label="Workspace summary"]')?.children
    ).toHaveLength(2);
  }
);

it('keeps hero, overview, watchdog, and activity log in reading order', () => {
  const document = new DOMParser().parseFromString(renderToString(<DashboardPage />), 'text/html');
  expect(
    [...document.querySelectorAll('main h1, main h2')].map((heading) => heading.textContent)
  ).toEqual([
    'Krypton Security Command',
    'Active Workspace Protection',
    'Watchdog status',
    'Intercepted security alerts',
  ]);
});

it('hydrates the production guide on an ordinary host without a mismatch', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const container = document.createElement('div');
  container.innerHTML = renderToString(<DashboardPage />);
  document.body.append(container);
  const onRecoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <DashboardPage />, { onRecoverableError });
    });
    expect(screen.getByRole('button', { name: 'About Guide' })).toBeTruthy();
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
