'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  Bell,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FolderLock,
  ShieldCheck,
  ShieldOff,
  Terminal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useState, type KeyboardEvent } from 'react';

import { KryptonButton, KryptonIconButton } from '../../primitives';

export type ExplainerTab = 'faq' | 'features' | 'overview' | 'setup';

export interface ExplainerDrawerProps {
  /** The tab selected whenever the guide first opens. @default "overview" */
  readonly defaultTab?: ExplainerTab;
}

interface ExplainerTabDefinition {
  /** The stable internal identifier used for selection and ARIA relationships. */
  readonly id: ExplainerTab;

  /** The concise operator-facing label rendered in the tab strip. */
  readonly label: string;
}

interface GuideItem {
  /** The Lucide icon that visually distinguishes the item. */
  readonly icon: LucideIcon;

  /** The short scannable name of the item. */
  readonly title: string;

  /** The security-accurate plain-language explanation. */
  readonly description: string;
}

interface FaqItem {
  /** The operator-facing question displayed by the accordion trigger. */
  readonly question: string;

  /** The security-accurate answer revealed when the question is expanded. */
  readonly answer: string;
}

interface ReleasePhase {
  /** The versioned release milestone shown to dashboard visitors. */
  readonly title: string;

  /** The implementation status that prevents future work from appearing available today. */
  readonly status: string;

  /** The concise, security-qualified outcome planned for the release. */
  readonly summary: string;
}

const REPOSITORY_URL = 'https://github.com/mwarnsley/krypton-security';
const NATIVE_SETUP_COMMAND =
  'git clone https://github.com/mwarnsley/krypton-security.git && cd krypton-security && npm ci && cargo check --manifest-path src/core-native/Cargo.toml && npm run build && npm run dev:full';

const TABS: readonly ExplainerTabDefinition[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'features', label: 'Core Features' },
  { id: 'setup', label: 'Install & Setup' },
  { id: 'faq', label: 'FAQ' },
];

const PROTECTION_CYCLE: readonly GuideItem[] = [
  {
    description:
      'Krypton gives protected tools an explicit project workspace and evaluates integrated file actions against that boundary.',
    icon: FolderLock,
    title: '1. Define the Safe Zone',
  },
  {
    description:
      'The protected launcher records the exact identity of each owned child while portable filesystem events remain honestly unattributed.',
    icon: Activity,
    title: '2. Monitor the Process',
  },
  {
    description:
      'Integrated requests for sensitive paths such as ~/.ssh, ~/.aws, or credential files fail closed. Krypton may quarantine only a registered child whose live identity still matches.',
    icon: ShieldCheck,
    title: '3. Block & Quarantine',
  },
];

const CORE_FEATURES: readonly GuideItem[] = [
  {
    description:
      'Keeps actions made through Krypton policy checks and its protected launcher inside the configured workspace.',
    icon: FolderLock,
    title: 'Active Workspace Containment',
  },
  {
    description:
      'Revalidates PID, start time, executable path, and parent PID before signaling a registered child process.',
    icon: ShieldCheck,
    title: 'Verified Process Quarantine',
  },
  {
    description:
      'Reflects live daemon health.mode and requires native confirmation for changes. Unknown mode disables the toggle; unavailable registry counts never become zero. Watcher, IPC, ledger, registry, notification, and queue failures report degraded health. OBSERVED events are not confirmed isolation receipts.',
    icon: ShieldOff,
    title: 'Audit vs. Enforcement Mode',
  },
  {
    description:
      'Keeps security decisions local and retains at most 10,000 events or 8 MiB in the bounded JSONL ledger. Recovery repairs incomplete tails, rejects interior corruption, and preserves monotonic sequences with private atomic compaction.',
    icon: Activity,
    title: 'Offline & Local Telemetry',
  },
  {
    description:
      'Queues a redacted macOS Notification Center banner outside the browser only after authenticated quarantine of a revalidated owned child succeeds. Banners use trusted agent labels and PID, never raw filenames; delivery has a two-second worker deadline and atomic degraded health.',
    icon: Bell,
    title: 'OS-Level Quarantine Alerts',
  },
  {
    description:
      'On GitHub Pages, Simulate Threat Event adds an explicitly mock alert so visitors can explore the interface without a native daemon.',
    icon: Terminal,
    title: 'Interactive Demo Sandbox',
  },
];

const RELEASE_PHASES: readonly ReleasePhase[] = [
  {
    status: 'In progress',
    summary:
      'The macOS daemon, krypton setup, native MCP file tools, live denial telemetry and redacted OS-level alerts are implemented. The npm run test:e2e harness verifies production MCP, durable denial receipts and socket loss in a disposable workspace. The npm run build:mcpb generator creates a local extension archive. CI and tagged draft-release workflows are defined for macOS binaries, MCPB and checksums; hosted execution, owner-managed branch protection, real client UI verification and the 60-second evaluation target remain outstanding. Portable watcher evidence remains observational.',
    title: 'Phase 1 · Local Verification, Containment & Release Hardening (v1.0.0)',
  },
  {
    status: 'Planned',
    summary:
      'The krypton run initial-child supervisor and authenticated termination receipts are implemented. Descendant containment, bounded Safe Auto-Pilot host adapters, and standalone Homebrew or verified shell installation with a sub-30-second time-to-first-containment target remain planned. A separate vulnerable-agent playground is also planned; none of these install paths or companion assets are available today.',
    title: 'Phase 2 · Transparent Developer Experience & Distribution (v1.1)',
  },
  {
    status: 'Planned',
    summary:
      'Package the dashboard in a lightweight Tauri app with tray controls, native alerts, validated path exceptions, agent tags, and sanitized Incident Brief / Kill-Cam exports. Windows shell and simulation only until Phase 4.',
    title: 'Phase 3 · Native Desktop App & Developer Convenience (v1.2–v1.3)',
  },
  {
    status: 'Planned',
    summary:
      'Phase 4 activates Windows native containment through Named Pipes and Job Objects; Linux Landlock, seccomp-bpf, and enterprise fleet systems follow the same fail-closed boundary.',
    title: 'Phase 4 · Enterprise Cross-Platform Containment & Fleet Systems (v2.0)',
  },
];

const SETUP_STEPS = [
  ['1. Clone the repository', 'git clone https://github.com/mwarnsley/krypton-security.git'],
  ['2. Enter the project and install dependencies', 'cd krypton-security && npm ci'],
  ['3. Check native compilation', 'cargo check --manifest-path src/core-native/Cargo.toml'],
  ['4. Verify the Next.js production build (Turbopack)', 'npm run build'],
  ['5. Run the native daemon and dashboard', 'npm run dev:full'],
  ['6. Run the test gates in another terminal', 'npm test -- --run && npm run rust:test'],
  ['7. Run isolated native E2E checks (desktop delivery mocked)', 'npm run test:e2e'],
  ['8. Expose the source-checkout CLI', 'npm link'],
  ['9. Configure detected AI clients, then restart them', 'krypton setup'],
  ['10. Supervise an agent in another terminal', 'krypton run -- claude'],
  ['11. Build an optional local macOS MCP extension', 'npm run build:mcpb'],
] as const;

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: 'How do I verify a Krypton release?',
    answer:
      'Tagged-release automation drafts Intel and Apple Silicon daemon binaries, the MCPB bundle and SHA-256 checksum files after CI succeeds. Download the assets and SHA256SUMS into one directory, then run shasum -a 256 -c SHA256SUMS before use. Artifacts remain unsigned; checksums do not authenticate the publisher. Maintainer review and final publication remain manual. Main branch protection requires owner activation; workflow files alone do not enable it. Hosted workflow execution and live desktop QA still need verification. The MCPB requires a configured checkout and running native daemon.',
  },
  {
    question: 'How do I connect Claude Desktop, Cursor, Claude Code or Cline?',
    answer:
      'Close clients and run npm run setup, or krypton setup after npm link. Setup detects existing client storage on macOS/Linux, atomically backs up existing JSON to .bak, preserves other servers and installs krypton-protected-fs through the supervisor with canonical paths and KRYPTON_PROJECT_ROOT. Invalid JSON, symlinks and conflicting Krypton entries fail per client; identical entries are skipped. Start or restart the updated daemon with npm run dev:full, ensure node is on the GUI client PATH, and restart configured clients. Linux storage detection does not imply supported native Linux enforcement. Alternatively, npm run build:mcpb creates dist/krypton-protected-fs.mcpb for a compatible macOS client. Select the Krypton checkout directory during installation and keep its native daemon running. The unsigned bundle includes JavaScript dependencies, not the daemon or local runtime state; desktop installation still requires manual QA. Its launcher uses the host Node executable. Avoid enabling duplicate Krypton servers. Only krypton_read_file and krypton_write_file are contained; built-in tools are not intercepted.',
  },
  {
    question: 'What happens when a Krypton MCP file tool crosses the boundary?',
    answer:
      'Ajv validates JSON Schema 2020-12 locally. The server sends authenticated mcp_file IPC to Rust, which checks paths and performs descriptor-relative file access. Unsafe requests return isError: true inside result with native receipts, in both Audit-Only and Enforcement modes. Denials queue native JSONL with tool, path and timestamp; queued is not a durable-write acknowledgment. Dashboard evidence is INTERCEPTED without an actor PID or confirmed process isolation. The server remains alive to return the error. Missing or incompatible daemons and unavailable telemetry fail closed. Socket exchanges have a 1500 ms absolute deadline and disconnects deny immediately. Stalled MCP output ends the session after 1500 ms. Tool failures remain inside result.isError; malformed protocol requests use standard JSON-RPC errors. Uncertain write durability requires inspecting the destination before retrying. Frames are bounded to 32 KiB, paths to 1 KiB and UTF-8 content to 2 KiB; parent directories must exist. Basenames starting with .krypton-mcp- and case variants are reserved for native staging. Symlinks, hardlinks and special files are rejected. Same-user host tampering and directory relocation remain outside kernel isolation.',
  },
  {
    answer:
      "Krypton is a lightweight local runtime boundary for developers using AI tools, package scripts, and automated commands. Integrations that use Krypton's policy and protected launcher can keep approved file mutations within the configured workspace; actions outside those integration points are not automatically contained.",
    question: 'What is Krypton in simple terms?',
  },
  {
    answer:
      'No. Antivirus software typically scans files for known or suspicious malware. Krypton makes deterministic path-policy and registered-process decisions. Portable filesystem notifications remain post-event telemetry and do not identify or automatically stop the actor that caused them.',
    question: 'Is Krypton an antivirus program?',
  },
  {
    answer:
      'Krypton is designed for bounded, low-overhead local checks rather than full-disk indexing. Repeated policy membership uses native Set or Map lookups with average O(1) cost, while path normalization remains O(L) in path length. Telemetry persistence is asynchronous and core security loops make no remote calls.',
    question: 'Does Krypton slow down my computer or development workflow?',
  },
  {
    answer:
      'Core security decisions do not send source code, files, or telemetry to cloud services. Native events stay in the bounded local .krypton/telemetry/alerts.jsonl ledger. The dashboard includes an external GitHub link that opens only when selected, and demonstration rows are explicitly mock data.',
    question: 'Does Krypton send my code, files, or telemetry to the cloud?',
  },
  {
    answer:
      'Audit-Only Mode records integrated policy violations without requesting process termination. Enforcement Mode denies integrated out-of-bounds actions and may quarantine only an owned, registered child after its PID, start time, executable path, and parent PID are revalidated. Portable watcher events alone never authorize arbitrary PID isolation.',
    question: 'What is the difference between Audit-Only Mode and Enforcement Mode?',
  },
  {
    answer:
      'Krypton reduces risk without trying to classify natural-language prompts. When a tool integrates with the policy layer or protected launcher, a request such as cat ~/.ssh/id_rsa can be rejected before the action proceeds. The portable filesystem watcher alone is post-event evidence, so Krypton does not claim universal pre-access prevention.',
    question: 'How does Krypton reduce the risk of indirect prompt injection?',
  },
  {
    answer:
      'macOS is the actively supported and tested native runtime. Linux native control currently remains experimental. Windows supports dashboard-only demonstration mode, not native isolation. Phase 3 plans a Windows Tauri shell with simulation and demo behavior only; true Windows containment requires the Phase 4 Named Pipe and Job Object runtime. Linux Landlock and seccomp-bpf adapters are also planned for Phase 4. None of those future controls are available today.',
    question: 'Which operating systems are currently supported?',
  },
  {
    answer:
      'A same-user or administrator-level attacker may still disable or tamper with Krypton; it is not a root security boundary. Krypton reduces local attack surface with a 0700 runtime directory, 0600 socket and capability files, authenticated local commands, peer-user checks, and compound process identity validation. Dashboard audit-mode and termination requests require JSON and matching loopback Host and Origin headers (localhost or 127.0.0.1); daemon capabilities remain server-side. These browser request guards are not caller authentication: keep the dashboard bound to loopback, because non-browser clients can forge headers.',
    question: 'Can host malware disable or manipulate Krypton?',
  },
  {
    answer:
      'Existing targets are canonicalized. Missing or deleted targets resolve through the nearest existing canonical ancestor plus a validated lexical tail. Parent traversal, escaping symlinks, and sibling-prefix confusion fail closed rather than being silently stripped. A documented time-of-check/time-of-use risk remains between validation and the operating-system action.',
    question: 'How does Krypton handle path traversal and symlinks?',
  },
  {
    answer:
      'Use Node.js v20.19.4 (Node 20 LTS baseline), npm 10.x, and Rust 1.97.0 via rustup. Clone the repository, enter krypton-security, run npm ci, then cargo check --manifest-path src/core-native/Cargo.toml and npm run build. Use npm run dev:full to start the macOS native daemon at .krypton/runtime/daemon.sock and Next.js 16 Turbopack dashboard concurrently. Keep port 3000 free and open http://localhost:3000; if occupied, free it or use PORT=3001 npm run dev:full and open http://localhost:3001. After npm link, use krypton run -- <command> [args...] from the checkout or protected workspace. krypton daemon:start starts only the foreground daemon. Run npm run setup or krypton setup after npm link to configure detected MCP clients, then restart them. Desktop MCP hosts use an absolute KRYPTON_PROJECT_ROOT; supervisor diagnostics use stderr. Only the initial child is registered, and SIGKILL attribution requires an authenticated native receipt. Use the console.log(process.cwd()) example in Install & Setup for a benign launch check; direct /etc/passwd reads are not containment tests. Discovery normalizes redundant dot segments only for the exact expected runtime files. Node and Rust resolve version-manager executable symlinks to the same canonical target; resolution failures deny inspection and PID, start time and parent checks remain strict. Restart the updated daemon. Run npm run test:e2e for an isolated native end-to-end check using disposable children, real authenticated IPC and SIGKILL, durable native JSONL including INTERCEPTED MCP denials, fail-closed socket loss, and mocked desktop delivery. It does not update the running dashboard or display an OS banner. For a cross-platform mock dashboard without native isolation, run npm run dev:dashboard.',
    question: 'How do I run the project locally?',
  },
  {
    answer:
      "Krypton operates independently of an AI agent's internal approval settings. Auto, Bypass Permissions, and YOLO modes remove the agent's own prompts, but they do not bypass controls for actions routed through Krypton's policy layer and protected launcher. In Enforcement Mode, an integrated out-of-bounds file request is denied, and Krypton may quarantine only an explicitly registered child after revalidating its PID, start time, executable path, and parent PID; the current Unix native runtime uses SIGKILL. Portable filesystem events remain post-event and unattributed, tools outside Krypton's integration are not automatically contained, and outbound-network enforcement remains planned. These agent modes therefore increase the importance of launching the agent through Krypton rather than providing universal protection by themselves.",
    question: "What happens if I set my AI agent to 'Auto', 'Bypass Permissions', or YOLO mode?",
  },
];

export function ExplainerDrawer(props: ExplainerDrawerProps): React.JSX.Element {
  const { defaultTab = 'overview' } = props;
  const [activeTab, setActiveTab] = useState<ExplainerTab>(defaultTab);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | 'idle'>('idle');

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) {
        setActiveTab(defaultTab);
        setCopyStatus('idle');
      }
    },
    [defaultTab]
  );

  const handleCopySetupCommand = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(NATIVE_SETUP_COMMAND);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }, []);

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentTab: ExplainerTab): void => {
      const currentIndex = TABS.findIndex((tab) => tab.id === currentTab);
      let nextIndex: number | undefined;

      if (event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % TABS.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = TABS.length - 1;
      }

      if (nextIndex === undefined) return;

      const nextTab = TABS[nextIndex];
      if (nextTab === undefined) return;

      event.preventDefault();
      setActiveTab(nextTab.id);
      document.getElementById(`explainer-tab-${nextTab.id}`)?.focus();
    },
    []
  );

  return (
    <Dialog.Root onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <KryptonButton size="sm" startIcon={<BookOpen />} variant="secondary">
          About &amp; Guide
        </KryptonButton>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-krypton-muted-overlay backdrop-blur-sm data-[state=closed]:animate-krypton-overlay-out data-[state=open]:animate-krypton-overlay-in" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-krypton-border-muted bg-krypton-bg-main text-krypton-fg-primary shadow-2xl shadow-krypton-shadow focus:outline-none data-[state=closed]:animate-krypton-drawer-out data-[state=open]:animate-krypton-drawer-in">
          <header className="flex items-start justify-between gap-krypton-space-4 border-b border-krypton-border-muted bg-krypton-bg-surface px-krypton-space-5 py-krypton-space-4 sm:px-krypton-space-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-krypton-heading text-krypton-accent-cyan">
                KRYPTON FIELD GUIDE
              </p>
              <Dialog.Title className="mt-1 text-2xl font-black tracking-tight text-krypton-fg-primary">
                About Krypton
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-krypton-fg-muted">
                A plain-language tour of the boundary, its limits, and the quickest way to try it.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <KryptonIconButton
                aria-label="Close About & Guide"
                icon={<X />}
                size="md"
                variant="link"
              />
            </Dialog.Close>
          </header>

          <nav
            aria-label="About Krypton sections"
            className="grid grid-cols-2 gap-krypton-space-2 border-b border-krypton-border-muted bg-krypton-bg-surface/70 px-krypton-space-5 py-krypton-space-3 sm:grid-cols-4 sm:px-krypton-space-6"
            role="tablist"
          >
            {TABS.map((tab) => {
              const selected = activeTab === tab.id;

              return (
                <button
                  aria-controls={`explainer-panel-${tab.id}`}
                  aria-selected={selected}
                  className={
                    selected
                      ? 'cursor-pointer rounded-krypton-radius-control border border-krypton-accent-cyan bg-krypton-control-active px-krypton-space-2 py-krypton-space-2 text-xs font-bold text-krypton-fg-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-focus-ring'
                      : 'cursor-pointer rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-main px-krypton-space-2 py-krypton-space-2 text-xs font-semibold text-krypton-fg-muted transition-colors hover:bg-krypton-control-hover hover:text-krypton-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-focus-ring'
                  }
                  id={`explainer-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-krypton-space-5 py-krypton-space-5 sm:px-krypton-space-6">
            {activeTab === 'overview' ? (
              <section
                aria-labelledby="explainer-tab-overview"
                className="space-y-krypton-space-6"
                id="explainer-panel-overview"
                role="tabpanel"
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-krypton-heading text-krypton-accent-cyan">
                    THE SHORT VERSION
                  </p>
                  <h2 className="mt-2 text-xl font-bold text-krypton-fg-primary">
                    A safety boundary for tools working inside your project
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-secondary">
                    Modern AI coding agents and smart terminals are powerful, but they can run an
                    unsafe command or reach for a private file by mistake. Krypton gives integrated
                    tools an explicit project boundary, makes local deterministic decisions, and
                    records what its native sensors can actually prove.
                  </p>
                </div>

                <div>
                  <h2 className="text-base font-bold text-krypton-fg-primary">
                    Three steps between a tool and your private files
                  </h2>
                  <div className="mt-3 grid gap-krypton-space-3">
                    {PROTECTION_CYCLE.map((item) => {
                      const Icon = item.icon;

                      return (
                        <article
                          className="rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4"
                          key={item.title}
                        >
                          <div className="flex items-start gap-krypton-space-3">
                            <span
                              aria-hidden="true"
                              className="inline-flex shrink-0 rounded-krypton-radius-control bg-krypton-accent-cyan/10 p-krypton-space-2 text-krypton-accent-cyan"
                            >
                              <Icon className="h-5 w-5" />
                            </span>
                            <div>
                              <h3 className="text-sm font-bold text-krypton-fg-primary">
                                {item.title}
                              </h3>
                              <p className="mt-1 text-sm leading-6 text-krypton-fg-muted">
                                {item.description}
                              </p>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <aside className="rounded-krypton-radius-card border border-krypton-warning-amber/40 bg-krypton-warning-amber/10 p-krypton-space-4">
                  <h2 className="text-base font-bold text-krypton-warning-foreground">
                    What Krypton does not do
                  </h2>
                  <ul className="mt-3 space-y-krypton-space-2 text-sm leading-6 text-krypton-fg-secondary">
                    <li>
                      It is not a background antivirus, virtual machine, or root security boundary.
                    </li>
                    <li>
                      It does not scan personal files or rely on probabilistic prompt filters.
                    </li>
                    <li>
                      Portable watcher events are post-event and unattributed; tools outside the
                      Krypton integration are not automatically contained.
                    </li>
                  </ul>
                  <p className="mt-3 text-sm font-semibold leading-6 text-krypton-warning-foreground">
                    Core security decisions stay local and deterministic, without remote API or
                    model lookups.
                  </p>
                </aside>
              </section>
            ) : null}

            {activeTab === 'features' ? (
              <section
                aria-labelledby="explainer-tab-features"
                id="explainer-panel-features"
                role="tabpanel"
              >
                <p className="text-xs font-bold uppercase tracking-krypton-heading text-krypton-accent-cyan">
                  CAPABILITIES
                </p>
                <h2 className="mt-2 text-xl font-bold text-krypton-fg-primary">
                  Core protection features
                </h2>
                <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                  Each capability stays inside Krypton&apos;s registered-process and evidence
                  boundaries.
                </p>
                <div className="mt-5 grid gap-krypton-space-3">
                  {CORE_FEATURES.map((feature) => {
                    const Icon = feature.icon;

                    return (
                      <article
                        className="flex gap-krypton-space-3 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4"
                        key={feature.title}
                      >
                        <span
                          aria-hidden="true"
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-krypton-radius-control bg-krypton-accent-blue/10 text-krypton-accent-blue"
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-krypton-fg-primary">
                            {feature.title}
                          </h3>
                          <p className="mt-1 text-sm leading-6 text-krypton-fg-muted">
                            {feature.description}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <aside className="mt-6 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <p className="text-xs font-bold uppercase tracking-krypton-heading text-krypton-accent-cyan">
                    RELEASE ROADMAP
                  </p>
                  <h2 className="mt-2 text-base font-bold text-krypton-fg-primary">
                    Four release phases
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    Current capability and future intent stay explicitly separated. Planned controls
                    do not expand what Krypton can enforce today.
                  </p>
                  <ol className="mt-4 space-y-krypton-space-3">
                    {RELEASE_PHASES.map((phase, index) => (
                      <li
                        aria-label={`Krypton roadmap phase ${index + 1}`}
                        className="rounded-krypton-radius-control border border-krypton-border-muted bg-krypton-bg-main p-krypton-space-3"
                        key={phase.title}
                      >
                        <div className="flex flex-col gap-krypton-space-1 sm:flex-row sm:items-start sm:justify-between sm:gap-krypton-space-3">
                          <h3 className="text-sm font-bold text-krypton-fg-primary">
                            {phase.title}
                          </h3>
                          <span className="shrink-0 text-xs font-semibold text-krypton-accent-cyan">
                            {phase.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                          {phase.summary}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 border-t border-krypton-border-muted pt-krypton-space-4">
                    <h3 className="text-sm font-bold text-krypton-fg-primary">Open-core target</h3>
                    <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                      Individual workstation containment remains free and private. Planned paid
                      tiers add power-user recovery and explanation tools or enterprise fleet,
                      governance, identity, and compliance capabilities—not stronger basic local
                      containment.
                    </p>
                  </div>
                </aside>
              </section>
            ) : null}

            {activeTab === 'setup' ? (
              <section
                aria-labelledby="explainer-tab-setup"
                id="explainer-panel-setup"
                role="tabpanel"
              >
                <p className="text-xs font-bold uppercase tracking-krypton-heading text-krypton-accent-cyan">
                  DEVELOPER QUICKSTART
                </p>
                <h2 className="mt-2 text-xl font-bold text-krypton-fg-primary">
                  Install and run Krypton locally
                </h2>
                <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                  Validated on clean macOS Apple Silicon (aarch64): use Node.js v20.19.4 (Node 20
                  LTS baseline), npm 10.x, and Rust 1.97.0 via rustup and cargo. Accept
                  version-manager prompts for .node-version or .nvmrc when available.
                  rust-toolchain.toml pins and syncs the host toolchain during builds:
                  1.97.0-aarch64-apple-darwin on Apple Silicon. macOS native builds also require
                  Apple command-line developer tools.
                </p>
                <ol className="mt-5 space-y-krypton-space-3">
                  {SETUP_STEPS.map(([title, command]) => (
                    <li
                      className="rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4"
                      key={title}
                    >
                      <h3 className="text-sm font-bold text-krypton-fg-primary">{title}</h3>
                      <code className="mt-2 block overflow-x-auto rounded-krypton-radius-control bg-krypton-bg-main p-krypton-space-3 font-mono text-xs leading-5 text-krypton-accent-cyan">
                        {command}
                      </code>
                    </li>
                  ))}
                </ol>

                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">
                    Runtime and port handling
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    <code>npm run dev:full</code> uses concurrently to run the native Rust daemon at
                    <code> .krypton/runtime/daemon.sock</code> and the Next.js 16 Turbopack
                    dashboard at <code>http://localhost:3000</code>. Keep the terminal running;
                    Ctrl+C stops the session, and a failed child stops the other service. Keep port
                    3000 free: an occupied port blocked dashboard startup inside concurrently during
                    macOS QA. Free the port or use <code>PORT=3001 npm run dev:full</code> and open
                    <code> http://localhost:3001</code>. The override changes only the dashboard
                    HTTP port, not the native Unix socket. GitHub Pages remains a static
                    demonstration; run this stack locally for native telemetry.
                  </p>
                </aside>

                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">
                    Supervise a real agent
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    <code>krypton run -- &lt;command&gt; [args...]</code> requires a healthy local
                    daemon. <code>krypton daemon:start</code> starts the foreground Cargo daemon
                    without the dashboard. From the checkout root, targets run in the configured
                    protected workspace; from a protected subdirectory, that directory is preserved.
                    Relative paths resolve there. Desktop MCP hosts can select the checkout with an
                    absolute <code>KRYPTON_PROJECT_ROOT</code> and pass a literal argument array.
                    Stdio is inherited, no shell expansion is performed, and supervisor diagnostics
                    use stderr so MCP stdout remains intact. Close clients and run{' '}
                    <code>npm run setup</code> or <code>krypton setup</code>
                    to configure detected Claude Desktop, Cursor, Claude Code and Cline storage.
                    Existing JSON receives a private atomic .bak backup; other servers remain intact
                    and conflicts fail per client. Restart configured clients and ensure node is
                    available on their PATH. Only the two Krypton MCP file tools gain native path
                    containment; built-in host tools are not intercepted.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    Executable symlinks used by version managers such as fnm, nvm and Homebrew
                    resolve to the same canonical target in Node and Rust. PID, start time and
                    parent remain strict. Resolution failures deny inspection. The daemon pins the
                    inspected target before later revalidation, so a changed live executable cannot
                    inherit registration. Reuse the original registered client identity for
                    isolation, cleanup and receipts, even if the alias disappears. Restart the
                    daemon after updating.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    The supervisor registers only the initial child, forwards SIGINT/SIGTERM, and
                    preserves nonzero exit codes after bounded cleanup. Lifecycle failure upgrades a
                    zero child status to 1. Child execution starts before registration completes;
                    very short commands may exit before supervision is established. Descendant
                    containment and universal filesystem/network blocking remain unavailable. A
                    confirmed enforcement message requires an authenticated complete-identity
                    receipt after SIGKILL; at most 1,024 receipts remain available for 60 seconds.
                    Missing, expired, evicted, or unavailable receipts leave attribution
                    unconfirmed. If registration fails and the OS refuses cleanup, the CLI exits
                    nonzero and reports that the child may still be running.
                  </p>
                </aside>

                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">
                    Verify local supervision
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    Start or restart the updated daemon with <code>krypton daemon:start</code> or
                    <code> npm run dev:full</code>. In another checkout terminal, run
                    <code>{" krypton run -- node -e 'console.log(process.cwd())'"}</code>. Expect
                    the configured protected workspace path. A very short command may exit before
                    registration completes; that limitation appears on stderr.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    <code>{`krypton run -- node -e 'require("fs").readFileSync("/etc/passwd")'`}</code>{' '}
                    is a limitation probe, not a containment test. The read may succeed when OS
                    permissions allow it; arbitrary Node reads are not intercepted and portable
                    watcher events cannot reliably attribute the actor. No automatic quarantine or
                    receipt is promised for this command.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    Run <code>npm run test:e2e</code> for disposable containment verification and
                    expect [PASS] lines. The supervisor captures the child PID and inspects its
                    start time, executable and parent. Rust validates that complete identity at
                    registration and before isolation. Successful native SIGKILL creates an
                    authenticated in-memory receipt; observational violations are separately
                    recorded as unattributed JSONL events. Desktop delivery is mocked in the test.
                    Discovery accepts redundant dot segments only for the exact expected absolute
                    runtime files; relative paths, traversal, redirects and socket symlinks remain
                    rejected. Rust normalizes runtime paths before publishing daemon.json.
                  </p>
                </aside>

                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">Platform notes</h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    macOS is the actively supported native runtime. Linux native mode is
                    experimental. Windows uses dashboard-only demonstration mode. Every platform can
                    explore simulated telemetry with <code>npm run dev:dashboard</code>. The planned
                    Phase 3 Windows Tauri app remains a shell and simulation experience until Phase
                    4 delivers native Named Pipe and Job Object containment. On macOS, a confirmed
                    native quarantine queues a redacted OS-level banner; denied notification
                    permission or a headless session suppresses only the banner, not enforcement.
                  </p>
                </aside>

                <footer className="mt-5 flex flex-col gap-krypton-space-3 border-t border-krypton-border-muted pt-krypton-space-5 sm:flex-row sm:items-center">
                  <KryptonButton asChild endIcon={<ExternalLink />} size="md" variant="primary">
                    <a href={REPOSITORY_URL} rel="noreferrer" target="_blank">
                      View Repository on GitHub
                    </a>
                  </KryptonButton>
                  <KryptonButton
                    onClick={() => {
                      void handleCopySetupCommand();
                    }}
                    size="md"
                    startIcon={copyStatus === 'copied' ? <Check /> : <Copy />}
                    variant="secondary"
                  >
                    Copy native setup command
                  </KryptonButton>
                </footer>
                <p
                  aria-live="polite"
                  className="mt-3 min-h-5 text-xs font-semibold text-krypton-fg-secondary"
                  role="status"
                >
                  {copyStatus === 'copied'
                    ? 'Setup command copied'
                    : copyStatus === 'failed'
                      ? 'Copy failed. Select the command above and copy it manually.'
                      : ''}
                </p>
              </section>
            ) : null}

            {activeTab === 'faq' ? (
              <section aria-labelledby="explainer-tab-faq" id="explainer-panel-faq" role="tabpanel">
                <p className="text-xs font-bold uppercase tracking-krypton-heading text-krypton-accent-cyan">
                  COMMON QUESTIONS
                </p>
                <h2 className="mt-2 text-xl font-bold text-krypton-fg-primary">
                  Frequently asked questions
                </h2>
                <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                  Straight answers based on Krypton&apos;s current implementation and documented
                  security boundary.
                </p>
                <div className="mt-5 space-y-krypton-space-3">
                  {FAQ_ITEMS.map((item) => (
                    <details
                      className="group rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface"
                      key={item.question}
                    >
                      <summary className="cursor-pointer select-none px-krypton-space-4 py-krypton-space-3 text-sm font-bold leading-6 text-krypton-fg-primary transition-colors hover:bg-krypton-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-krypton-focus-ring">
                        {item.question}
                      </summary>
                      <p className="border-t border-krypton-border-muted px-krypton-space-4 py-krypton-space-3 text-sm leading-6 text-krypton-fg-muted">
                        {item.answer}
                      </p>
                    </details>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
