// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExplainerDrawer } from './ExplainerDrawer';

afterEach(cleanup);

describe('ExplainerDrawer', () => {
  it('starts with the guide content closed', () => {
    render(<ExplainerDrawer />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the guide from its labeled trigger', () => {
    render(<ExplainerDrawer />);

    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    expect(screen.getByRole('dialog', { name: 'About Krypton' })).toBeTruthy();
  });

  it('closes the open guide from its close control', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    fireEvent.click(screen.getByRole('button', { name: 'Close About & Guide' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches from the overview to core features', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Core Features' }));

    expect(screen.getByRole('heading', { name: 'Core protection features' })).toBeTruthy();
    expect(screen.queryByText('Three steps between a tool and your private files')).toBeNull();
  });

  it('moves to the next tab with the right arrow key', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });

    expect(screen.getByRole('tab', { name: 'Core Features' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('renders the external repository link in the setup guide', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Install & Setup' }));

    const repositoryLink = screen.getByRole('link', { name: 'View Repository on GitHub' });

    expect(repositoryLink.getAttribute('href')).toBe(
      'https://github.com/mwarnsley/krypton-security'
    );
    expect(repositoryLink.getAttribute('target')).toBe('_blank');
    expect(repositoryLink.getAttribute('rel')).toBe('noreferrer');
  });

  it('confirms when the native setup command is copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Install & Setup' }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy native setup command' }));

    expect(await screen.findByText('Setup command copied')).toBeTruthy();
  });
});
