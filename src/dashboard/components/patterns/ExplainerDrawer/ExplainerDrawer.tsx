'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
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

export type ExplainerTab = 'features' | 'overview' | 'setup';

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

const REPOSITORY_URL = 'https://github.com/mwarnsley/krypton-security';
const NATIVE_SETUP_COMMAND =
  'git clone https://github.com/mwarnsley/krypton-security.git && cd krypton-security && npm ci && npm run dev:full';

const TABS: readonly ExplainerTabDefinition[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'features', label: 'Core Features' },
  { id: 'setup', label: 'Install & Setup' },
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
      'Switches between observation-only logging and active quarantine while native changes require daemon confirmation.',
    icon: ShieldOff,
    title: 'Audit vs. Enforcement Mode',
  },
  {
    description:
      'Keeps security decisions local and retains at most 10,000 events or 8 MiB in the bounded JSONL ledger.',
    icon: Activity,
    title: 'Offline & Local Telemetry',
  },
  {
    description:
      'On GitHub Pages, Simulate Threat Event adds an explicitly mock alert so visitors can explore the interface without a native daemon.',
    icon: Terminal,
    title: 'Interactive Demo Sandbox',
  },
];

const SETUP_STEPS = [
  ['1. Clone the repository', 'git clone https://github.com/mwarnsley/krypton-security.git'],
  ['2. Enter the project and install dependencies', 'cd krypton-security && npm ci'],
  ['3. Run the native daemon and dashboard', 'npm run dev:full'],
  ['4. Run the mock attack simulation', 'npm run test:sim'],
] as const;

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
            className="grid grid-cols-3 gap-krypton-space-2 border-b border-krypton-border-muted bg-krypton-bg-surface/70 px-krypton-space-5 py-krypton-space-3 sm:px-krypton-space-6"
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
                  <h2 className="text-sm font-bold text-krypton-fg-primary">Platform notes</h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    macOS is the actively supported native runtime. Linux native mode is
                    experimental. Windows uses dashboard-only demonstration mode. Every platform can
                    explore simulated telemetry with <code>npm run dev:dashboard</code>.
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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
