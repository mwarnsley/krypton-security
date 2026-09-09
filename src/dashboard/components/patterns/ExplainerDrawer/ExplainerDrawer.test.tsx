// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExplainerDrawer } from './ExplainerDrawer';

afterEach(cleanup);

describe('ExplainerDrawer', () => {
  it('explains live mode and observational status boundaries', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Core Features' }));
    expect(screen.getByText(/Unknown mode disables the toggle/)).toBeTruthy();
    expect(screen.getByText(/OBSERVED events are not confirmed isolation receipts/)).toBeTruthy();
  });
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

  it('shows the four release phases with current work identified', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Core Features' }));

    expect(screen.getByRole('heading', { name: 'Four release phases' })).toBeTruthy();
    expect(screen.getAllByRole('listitem', { name: /Krypton roadmap phase/ })).toHaveLength(4);
  });

  it('marks Phase 1 complete with OS-level quarantine alerts implemented', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Core Features' }));

    const phase = screen.getByRole('listitem', { name: 'Krypton roadmap phase 1' });

    expect(phase.textContent).toContain('Completed');
    expect(phase.textContent).toContain('redacted OS-level alerts');
  });

  it('describes the authenticated OS-level quarantine alert boundary', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Core Features' }));

    expect(screen.getByRole('heading', { name: 'OS-Level Quarantine Alerts' })).toBeTruthy();
    expect(screen.getByText(/only after authenticated quarantine/)).toBeTruthy();
  });

  it('distinguishes the Phase 3 Windows demo from Phase 4 native containment', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Core Features' }));

    expect(screen.getByRole('listitem', { name: 'Krypton roadmap phase 3' }).textContent).toContain(
      'Windows shell and simulation only until Phase 4'
    );
    expect(screen.getByRole('listitem', { name: 'Krypton roadmap phase 4' }).textContent).toContain(
      'activates Windows native containment'
    );
  });

  it('labels distribution, incident exports, and the playground as planned work', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Core Features' }));

    expect(screen.getByRole('listitem', { name: 'Krypton roadmap phase 2' }).textContent).toContain(
      'none of these install paths or companion assets are available today'
    );
    expect(screen.getByRole('listitem', { name: 'Krypton roadmap phase 3' }).textContent).toContain(
      'Incident Brief / Kill-Cam exports'
    );
  });

  it('moves to the next tab with the right arrow key', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });

    expect(screen.getByRole('tab', { name: 'Core Features' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('opens the FAQ tab and renders its guide heading', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }));

    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeTruthy();
  });

  it('distinguishes the isolated native test from live dashboard and OS delivery', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }));
    fireEvent.click(screen.getByText('How do I run the project locally?'));
    expect(screen.getByText(/real authenticated IPC and SIGKILL/)).toBeTruthy();
    expect(
      screen.getByText(/does not update the running dashboard or display an OS banner/)
    ).toBeTruthy();
  });

  it('renders all eleven FAQ questions in order', () => {
    const { container } = render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }));

    const questions = [...container.ownerDocument.querySelectorAll('details > summary')].map(
      (summary) => summary.textContent?.trim()
    );

    expect(questions).toEqual([
      'What is Krypton in simple terms?',
      'Is Krypton an antivirus program?',
      'Does Krypton slow down my computer or development workflow?',
      'Does Krypton send my code, files, or telemetry to the cloud?',
      'What is the difference between Audit-Only Mode and Enforcement Mode?',
      'How does Krypton reduce the risk of indirect prompt injection?',
      'Which operating systems are currently supported?',
      'Can host malware disable or manipulate Krypton?',
      'How does Krypton handle path traversal and symlinks?',
      'How do I run the project locally?',
      "What happens if I set my AI agent to 'Auto', 'Bypass Permissions', or YOLO mode?",
    ]);
  });

  it('explains the loopback HTTP boundary without claiming caller authentication', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }));
    fireEvent.click(screen.getByText('Can host malware disable or manipulate Krypton?'));
    expect(
      screen.getByText(/These browser request guards are not caller authentication/)
    ).toBeTruthy();
  });

  it('opens the agent bypass FAQ with the current containment boundary', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }));

    const question = screen.getByText(
      "What happens if I set my AI agent to 'Auto', 'Bypass Permissions', or YOLO mode?"
    );
    fireEvent.click(question);

    expect(question.closest('details')?.hasAttribute('open')).toBe(true);
    expect(screen.getByText(/outbound-network enforcement remains planned/)).toBeTruthy();
  });

  it('moves from setup to FAQ with the right arrow key', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Install & Setup' }), {
      key: 'ArrowRight',
    });

    expect(screen.getByRole('tab', { name: 'FAQ' }).getAttribute('aria-selected')).toBe('true');
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

  it('documents the validated native toolchains in setup', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    expect(screen.getByRole('tabpanel').textContent).toContain('Node.js v20.19.4');
    expect(screen.getByRole('tabpanel').textContent).toContain('npm 10.x');
    expect(screen.getByRole('tabpanel').textContent).toContain('1.97.0-aarch64-apple-darwin');
  });

  it('documents full-stack port recovery without changing native IPC', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    expect(screen.getByText('PORT=3001 npm run dev:full')).toBeTruthy();
    expect(screen.getByText(/The override changes only the dashboard/).textContent).toContain(
      'not the native Unix socket'
    );
  });

  it('keeps the local-run FAQ aligned with the port override', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByText('How do I run the project locally?'));

    expect(screen.getByText(/Use Node.js v20.19.4/).textContent).toContain(
      'PORT=3001 npm run dev:full'
    );
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
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'git clone https://github.com/mwarnsley/krypton-security.git && cd krypton-security && npm ci && cargo check --manifest-path src/core-native/Cargo.toml && npm run build && npm run dev:full'
    );
  });
});
