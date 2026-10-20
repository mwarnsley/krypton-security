// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExplainerDrawer } from './ExplainerDrawer';

afterEach(cleanup);

describe('ExplainerDrawer', () => {
  it('compares alignment, approval settings and scoped native containment', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    const matrix = screen.getByRole('table', {
      name: 'The Security Model: Prompt Alignment vs. Kernel Containment',
    });
    expect(within(matrix).getAllByRole('columnheader')).toHaveLength(4);
    expect(
      within(matrix)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent)
    ).toEqual([
      'Claude / Codex / Gemini Safety',
      "Client 'YOLO' / Bypass Modes",
      'Krypton Security Core',
    ]);
    expect(matrix.textContent).toContain('owned, registered children');
  });

  it('does not present the comparison as universal kernel isolation', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    expect(screen.getByText(/Krypton does not replace model alignment/).textContent).toContain(
      'through its protected MCP tools fails closed'
    );
    expect(screen.getByText(/This is defense in depth/).textContent).toContain(
      'Audit-Only is the native startup default'
    );
    expect(screen.getByText(/This is defense in depth/).textContent).toContain(
      'arbitrary syscalls and unrelated host tools remain outside this boundary'
    );
  });

  it('shows double-click setup with accurate denial verification', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    expect(
      screen.getByRole('heading', {
        name: 'Method 1: Zero-terminal double-click (macOS recommended)',
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Can you use your krypton_read_file tool to inspect the contents of /etc/passwd?'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(/A file denial does not trigger a desktop quarantine banner/)
    ).toBeTruthy();
  });
  it('offers three source setup steps and automatic daemon startup', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    expect(
      screen.getByRole('heading', { name: '3. Restart Claude Desktop and use the protected tools' })
    ).toBeTruthy();
    expect(screen.getByRole('tabpanel').textContent).toContain(
      'No development terminal is required for protection'
    );
    expect(screen.getByText(/The detached source daemon remains running/)).toBeTruthy();
  });

  it('documents bounded cold-start failure and missing-binary recovery', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByText('Native Daemon Connection Timeout'));
    const answer = screen.getByText(/A missing socket, disconnect/).textContent;
    expect(answer).toContain('within three seconds after host spawn');
    expect(answer).toContain('cargo build --release --manifest-path src/core-native/Cargo.toml');
    expect(answer).toContain(
      'Authentication errors, timeouts and degraded health fail closed without replacing'
    );
  });

  it('separates readiness timing from preparation and protects private logs', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByText('Native Daemon Connection Timeout'));
    const answer = screen.getByText(/A missing socket, disconnect/).textContent;
    expect(answer).toContain(
      'the initial 1500 ms IPC probe and filesystem preparation are separate'
    );
    expect(answer).toContain('64 KiB maximum, reset per startup attempt');
    expect(answer).toContain('private paths, so redact before sharing');
  });

  it('keeps unsafe MCP operations denied in audit mode', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(
      screen.getByText('What is the difference between Audit-Only Mode and Enforcement Mode?')
    );
    expect(screen.getByText(/Both modes deny unsafe MCP reads and writes/).textContent).toContain(
      'it does not allow out-of-bounds file access'
    );
  });

  it('distinguishes the optional source viewer from standalone ledgers and Pages', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(
      screen.getByText('How do I view native telemetry, and is the dashboard required?')
    );
    const answer = screen.getByText(/Protection runs without the dashboard/).textContent;
    expect(answer).toContain('npm run dev:dashboard');
    expect(answer).toContain('not automatically loaded by the source viewer');
    expect(answer).toContain('mock data only until the planned Phase 2 local-file bridge ships');
  });

  it('explains recovery when native setup is unavailable', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByText('Native Daemon Connection Timeout'));
    expect(screen.getByText(/Never delete a live socket/)).toBeTruthy();
    expect(screen.getByText(/The Pages dashboard cannot inspect local sockets/)).toBeTruthy();
  });
  it('separates checksum integrity from signing and owner-managed release gates', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByText('How do I verify a Krypton release?'));
    const answer = screen.getByText(/Tagged-release automation runs/);
    expect(answer.textContent).toContain('shasum -a 256 -c SHA256SUMS');
    expect(answer.textContent).toContain('checksums do not authenticate the publisher');
    expect(answer.textContent).toContain('Main branch protection requires owner activation');
    expect(answer.textContent).toContain('arm64 and x86_64');
    expect(answer.textContent).toContain('packaged E2E');
    expect(answer.textContent).toContain('unsigned and unnotarized');
  });
  it('explains standalone Claude Desktop installation and its containment boundary', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(
      screen.getByText('How do I connect Claude Desktop, Cursor, Claude Code or Cline?')
    );
    const answer = screen.getByText(/Download krypton-protected-fs.mcpb/);
    expect(answer.textContent).toContain('https://github.com/mwarnsley/krypton-security/releases');
    expect(answer.textContent).toContain('protected_workspace_root');
    expect(answer.textContent).toContain(
      '~/Library/Application Support/KryptonSecurity/sandbox_workspace'
    );
    expect(answer.textContent).toContain('bundled arm64 or x64 daemon');
    expect(answer.textContent).toContain('starts, supervises and stops');
    expect(answer.textContent).toContain('no repository checkout or Rust toolchain');
    expect(answer.textContent).toContain('krypton_read_file and krypton_write_file');
    expect(answer.textContent).toContain('built-in Claude tools remain outside');
    expect(answer.textContent).toContain('.krypton/telemetry/alerts.jsonl');
    expect(answer.textContent).toContain('does not include or launch the Next.js dashboard');
    expect(answer.textContent).toContain('manual clean-machine Claude Desktop QA');
  });
  it('explains bounded IPC failure and uncertain write recovery', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(
      screen.getByText('What happens when a Krypton MCP file tool crosses the boundary?')
    );
    expect(screen.getByText(/Socket exchanges have a 1500 ms absolute deadline/)).toBeTruthy();
    expect(
      screen.getByText(/Uncertain write durability requires inspecting the destination/)
    ).toBeTruthy();
  });
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

  it('marks Phase 1 shipped while retaining implemented alerts', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Core Features' }));

    const phase = screen.getByRole('listitem', { name: 'Krypton roadmap phase 1' });

    expect(phase.textContent).toContain('Completed & shipped');
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
    expect(screen.getByText(/real authenticated IPC and SIGKILL/).textContent).toContain(
      'npm run test:e2e'
    );
    expect(screen.getByText(/real authenticated IPC and SIGKILL/).textContent).toContain(
      'fail-closed socket loss'
    );
    expect(
      screen.getByText(/does not update the running dashboard or display an OS banner/)
    ).toBeTruthy();
  });

  it('renders the onboarding, MCP boundary and existing FAQ questions in order', () => {
    const { container } = render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }));

    const questions = [...container.ownerDocument.querySelectorAll('details > summary')].map(
      (summary) => summary.textContent?.trim()
    );

    expect(questions).toEqual([
      'How do I verify a Krypton release?',
      'How do I connect Claude Desktop, Cursor, Claude Code or Cline?',
      'What happens when a Krypton MCP file tool crosses the boundary?',
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
      'Tools not showing up in Claude Desktop',
      'Extension asks for a required Krypton checkout directory',
      'Claude Desktop reports Request timed out for the Krypton extension',
      'Claude Desktop launches the Krypton extension several times at once',
      'Gatekeeper / Unsigned Binary Notice on macOS',
      'Native Daemon Connection Timeout',
      'How do I view native telemetry, and is the dashboard required?',
      'Permissions Denied on Protected Workspace',
      'Can I install the native runtime on Windows?',
    ]);
  });

  it('explains the unexpanded Desktop workspace reference in the timeout FAQ', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }));
    fireEvent.click(
      screen.getByText('Claude Desktop reports Request timed out for the Krypton extension')
    );
    expect(
      screen.getByText(/treat exactly that reference as blank and use the private Application/)
    ).toBeTruthy();
  });

  it('explains that concurrent Desktop launches attach without signaling the owner', () => {
    render(<ExplainerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByRole('tab', { name: 'FAQ' }));
    fireEvent.click(
      screen.getByText('Claude Desktop launches the Krypton extension several times at once')
    );
    expect(screen.getByText(/The discovered PID is compared and never signaled/)).toBeTruthy();
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

  it('documents optional dashboard port recovery without changing native IPC', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));

    expect(screen.getByText('npm run dev:dashboard -- -p 3001')).toBeTruthy();
    expect(screen.getByText(/The override changes only the dashboard/).textContent).toContain(
      'not the native Unix socket'
    );
  });

  it('keeps the local-run FAQ aligned with the port override', () => {
    render(<ExplainerDrawer defaultTab="faq" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    fireEvent.click(screen.getByText('How do I run the project locally?'));

    expect(screen.getByText(/Use Node.js v20.19.4/).textContent).toContain(
      'npm run dev:dashboard -- -p 3001'
    );
  });

  it('documents executable symlink identity without weakening generation checks', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    expect(screen.getByText(/Executable symlinks used by version managers/).textContent).toContain(
      'PID, start time and parent remain strict'
    );
    expect(screen.getByText(/Executable symlinks used by version managers/).textContent).toContain(
      'Resolution failures deny inspection'
    );
  });

  it('documents the supervisor and evidence limits in setup', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    expect(screen.getByText('krypton run -- <command> [args...]')).toBeTruthy();
    expect(screen.getByText('KRYPTON_PROJECT_ROOT')).toBeTruthy();
    expect(screen.getByText(/at most 1,024 receipts remain available/)).toBeTruthy();
  });

  it('keeps Phase 2 distribution planned while identifying the existing supervisor', () => {
    render(<ExplainerDrawer defaultTab="features" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    const phase = screen.getByRole('listitem', { name: 'Krypton roadmap phase 2' });
    expect(phase.textContent).toContain('Planned');
    expect(phase.textContent).toContain('initial-child supervisor');
    expect(phase.textContent).toContain('remain planned');
  });

  it('separates benign local verification from direct-read containment limitations', () => {
    render(<ExplainerDrawer defaultTab="setup" />);
    fireEvent.click(screen.getByRole('button', { name: 'About & Guide' }));
    expect(screen.getByText("krypton run -- node -e 'console.log(process.cwd())'")).toBeTruthy();
    expect(screen.getByText(/is a limitation probe, not a containment test/)).toBeTruthy();
    expect(screen.getByText(/Successful native SIGKILL creates an/)).toBeTruthy();
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
      'git clone https://github.com/mwarnsley/krypton-security.git && cd krypton-security && npm ci && cargo build --release --manifest-path src/core-native/Cargo.toml && npm run setup'
    );
  });
});
