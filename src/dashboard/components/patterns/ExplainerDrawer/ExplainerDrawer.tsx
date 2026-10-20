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
import Link from 'next/link';
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
  'git clone https://github.com/mwarnsley/krypton-security.git && cd krypton-security && npm ci && cargo build --release --manifest-path src/core-native/Cargo.toml && npm run setup';

const TABS: readonly ExplainerTabDefinition[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'features', label: 'Core Features' },
  { id: 'setup', label: 'Install & Setup' },
  { id: 'faq', label: 'FAQ' },
];

const SECURITY_LAYERS = [
  [
    'Claude / Codex / Gemini Safety',
    'Application and prompt layer: model alignment and safety filters.',
    'The model and filters correctly recognize unsafe intent and untrusted instructions.',
    'Reduces harmful requests, but jailbreaks, indirect injections and obfuscated payloads can evade these defenses.',
  ],
  [
    "Client 'YOLO' / Bypass Modes",
    'Approval settings that skip some or all human confirmation prompts; exact behavior depends on the client.',
    'The user delegates decisions to the agent and its configured tools.',
    'Removes human review; skipping prompts is not itself sandboxing. Clients may provide separate sandbox controls.',
  ],
  [
    'Krypton Security Core',
    'Native Rust path enforcement for protected MCP file tools, with an authenticated local watchdog and OS process signals.',
    'No trust in prompt intent: deterministic local policy and revalidated process identity.',
    'Denies out-of-workspace MCP reads/writes in both modes. Enforcement Mode can terminate only owned, registered children after live identity checks, independently of client approval settings.',
  ],
] as const;

const PROTECTION_CYCLE: readonly GuideItem[] = [
  {
    description:
      'Krypton gives protected tools an explicit project workspace and evaluates integrated file actions against that boundary. Claude Desktop, Claude Code, Cursor, Codex CLI and standard stdio hosts can use the two MCP file tools on supported macOS installations.',
    icon: FolderLock,
    title: '1. Define the Safe Zone',
  },
  {
    description:
      'The Node supervisor owns child registration and lifecycle. Source clients reuse a healthy daemon across restarts and can refresh one dropped registration handshake after exact identity revalidation. The MCP server validates JSON-RPC and sends its two file tools to Rust for native path checks and file access. Portable filesystem events remain unattributed and never authorize signals.',
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
      'Bare node src/cli.cjs run serves standard stdio MCP from a prepared macOS source installation without bundle extraction; run -- <command> retains child supervision. The two Krypton MCP file tools use native path checks and descriptor-relative access inside the workspace. The supervisor registers the initial child; a lost registration acknowledgement may repeat only that exact revalidated identity. Tool writes are never replayed. Arbitrary child syscalls, host tools, and descendants are not sandboxed.',
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
      'Both modes deny unsafe MCP reads and writes; Audit-Only suppresses process termination. Reflects live daemon health.mode and requires native confirmation for changes. Unknown mode disables the toggle; unavailable registry counts never become zero. Watcher, IPC, ledger, registry, notification, and queue failures report degraded health. OBSERVED events are not confirmed isolation receipts.',
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
      'On GitHub Pages, Simulate Threat Event adds an explicitly mock alert. Pages cannot read local native telemetry today; the local-file bridge is planned for Phase 2. The optional source dashboard reads its checkout ledger, not standalone Application Support ledgers automatically.',
    icon: Terminal,
    title: 'Interactive Demo Sandbox',
  },
];

const RELEASE_PHASES: readonly ReleasePhase[] = [
  {
    status: 'Completed & shipped',
    summary:
      'The macOS daemon, krypton setup, native MCP file tools, live denial telemetry and redacted OS-level alerts are implemented. The source-mode npm run test:e2e harness verifies production MCP, durable denial receipts and socket loss in a disposable workspace. The standalone MCPB packages arm64 and x64 daemons, supervises the selected daemon and has a bounded isolated npm run test:mcpb harness. v1.0.2 is shipped with dual-architecture supervision, ancestry validation and protected PR gates. The 60-second evaluation target remains unmeasured; clean-machine and Gatekeeper checks remain ongoing release QA. Portable watcher evidence remains observational.',
    title: 'Phase 1 · Local Verification, Containment & Release Hardening (v1.0.2)',
  },
  {
    status: 'Planned',
    summary:
      'The krypton run initial-child supervisor and authenticated termination receipts are implemented. Descendant containment, bounded Safe Auto-Pilot host adapters, and standalone Homebrew or verified shell installation with a sub-30-second time-to-first-containment target remain planned. A local-file telemetry bridge for the mock-only Pages dashboard and a separate vulnerable-agent playground are also planned; none of these install paths or companion assets are available today.',
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
  [
    '1. Clone and prepare the checkout',
    'git clone https://github.com/mwarnsley/krypton-security.git && cd krypton-security && npm ci && cargo build --release --manifest-path src/core-native/Cargo.toml',
  ],
  ['2. Close clients and double-click the setup script', 'scripts/Install-Mac.command'],
  [
    '3. Restart Claude Desktop and use the protected tools',
    'krypton_read_file / krypton_write_file',
  ],
] as const;

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: 'How do I verify a Krypton release?',
    answer:
      'Tagged-release automation runs the reusable Phase 1 verification job, builds arm64 and x86_64 daemon artifacts, assembles one MCPB from those downloaded bytes, byte-compares both embedded binaries, and runs packaged E2E on matching macOS arm64 and x86_64 hosts before drafting a release. Download the three primary assets and SHA256SUMS into one directory, then run shasum -a 256 -c SHA256SUMS before use. Artifacts remain unsigned and unnotarized; checksums do not authenticate the publisher, and Gatekeeper behavior needs manual verification. Maintainer review, manual clean-machine Claude Desktop QA, signing/notarization and final publication remain release gates. Main branch protection requires owner activation; workflow files alone do not enable it. v1.0.2 is published; future releases must pass the same verification and owner review.',
  },
  {
    question: 'How do I connect Claude Desktop, Cursor, Claude Code or Cline?',
    answer:
      'Download krypton-protected-fs.mcpb from https://github.com/mwarnsley/krypton-security/releases, then double-click it on macOS to open Claude Desktop and confirm installation. If file association is unavailable, use Settings > Extensions > Advanced settings > Install Extension. protected_workspace_root is optional; select an existing directory to protect, or leave it blank to create and protect ~/Library/Application Support/KryptonSecurity/sandbox_workspace. The launcher selects the bundled arm64 or x64 daemon, installs a verified private copy, and starts, supervises and stops that exact child with the MCP session. This route needs no repository checkout or Rust toolchain. Standalone telemetry remains local at ~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl. The MCPB does not include or launch the Next.js dashboard. Claude Code, Cursor, Codex CLI and other stdio hosts can instead launch node /absolute/path/krypton-security/src/cli.cjs run after npm ci and cargo build --release --manifest-path src/core-native/Cargo.toml. Set KRYPTON_PROTECTED_WORKSPACE_ROOT to an existing absolute directory, or omit it for the private default sandbox. Bare run owns and stops its daemon; run -- <command> keeps the existing supervisor behavior. npm link exposes krypton-mcp run locally; registry npx installation is not verified. Live client UI compatibility remains manual QA. Only krypton_read_file and krypton_write_file are contained; built-in Claude tools remain outside this boundary. The bundle is unsigned and unnotarized, and manual clean-machine Claude Desktop QA remains a release gate. Source users can instead double-click scripts/Install-Mac.command in a prepared checkout, run npm run setup, or krypton setup after npm link; that checkout flow keeps KRYPTON_PROJECT_ROOT, auto-starts the compiled daemon when unavailable, reuses a healthy existing daemon, and can configure Claude Desktop, Cursor, Claude Code or Cline. Install-Windows.cmd reports unsupported native setup without modifying settings; Windows remains demonstration-only. Avoid enabling duplicate Krypton servers.',
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
      'Core security decisions do not send source code, files, or telemetry to cloud services. Checkout native events stay in the bounded local .krypton/telemetry/alerts.jsonl ledger. Standalone MCPB events stay beneath ~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl. The dashboard includes an external GitHub link that opens only when selected, and demonstration rows are explicitly mock data.',
    question: 'Does Krypton send my code, files, or telemetry to the cloud?',
  },
  {
    answer:
      'Both modes deny unsafe MCP reads and writes. The native daemon initially starts in audit_only; the local dashboard reflects authenticated live mode. Audit-Only Mode records policy violations without requesting process termination; it does not allow out-of-bounds file access. Enforcement Mode may quarantine only an owned, registered child after its PID, start time, executable path, and parent PID are revalidated. Portable watcher events alone never authorize arbitrary PID isolation.',
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
      'Use Node.js v20.19.4 (Node 20 LTS baseline), npm 10.x, and Rust 1.97.0 via rustup. Clone the repository, enter krypton-security, run npm ci and cargo build --release --manifest-path src/core-native/Cargo.toml. Close clients, double-click scripts/Install-Mac.command (or run npm run setup), then restart Claude Desktop and use the protected tools. The source launcher automatically starts a missing daemon or reuses a healthy one; the detached daemon survives client disconnect. No npm run dev:full terminal is required for protection. Optionally run npm run dev:dashboard and open http://localhost:3000; if occupied, use npm run dev:dashboard -- -p 3001 and open http://localhost:3001. After npm link, use krypton run -- <command> [args...] from the checkout or protected workspace. krypton daemon:start starts only the foreground daemon. Run npm run setup or krypton setup after npm link to configure detected MCP clients, then restart them. Desktop MCP hosts use an absolute KRYPTON_PROJECT_ROOT; supervisor diagnostics use stderr. Only the initial child is registered, and SIGKILL attribution requires an authenticated native receipt. Use the console.log(process.cwd()) example in Install & Setup for a benign launch check; direct /etc/passwd reads are not containment tests. Discovery normalizes redundant dot segments only for the exact expected runtime files. Node and Rust resolve version-manager executable symlinks to the same canonical target; resolution failures deny inspection and PID, start time and parent checks remain strict. Restart the updated daemon. Run npm run test:e2e for an isolated native end-to-end check using disposable children, real authenticated IPC and SIGKILL, durable native JSONL including INTERCEPTED MCP denials, fail-closed socket loss, and mocked desktop delivery. It does not update the running dashboard or display an OS banner. For a cross-platform mock dashboard without native isolation, run npm run dev:dashboard.',
    question: 'How do I run the project locally?',
  },
  {
    answer:
      "Krypton operates independently of an AI agent's internal approval settings. Auto, Bypass Permissions, and YOLO modes remove the agent's own prompts, but they do not bypass controls for actions routed through Krypton's policy layer and protected launcher. In Enforcement Mode, an integrated out-of-bounds file request is denied, and Krypton may quarantine only an explicitly registered child after revalidating its PID, start time, executable path, and parent PID; the current Unix native runtime uses SIGKILL. Portable filesystem events remain post-event and unattributed, tools outside Krypton's integration are not automatically contained, and outbound-network enforcement remains planned. These agent modes therefore increase the importance of launching the agent through Krypton rather than providing universal protection by themselves.",
    question: "What happens if I set my AI agent to 'Auto', 'Bypass Permissions', or YOLO mode?",
  },
  {
    question: 'Tools not showing up in Claude Desktop',
    answer:
      'Fully quit with Cmd + Q on macOS and reopen Claude Desktop. Open the chat tools / + menu and Connectors to check krypton_read_file and krypton_write_file. For an MCPB install, review Settings > Extensions and its configuration/logs. For source setup only, validate JSON syntax in ~/Library/Application Support/Claude/claude_desktop_config.json, check mcpServers and absolute script paths, and ensure node is on the client PATH. Use Developer settings to open MCP logs (macOS logs are under ~/Library/Logs/Claude). Close the client before edits, keep its backup, and never share capabilities or complete settings/log files. Organization extension policies may require administrator approval.',
  },
  {
    question: 'Extension asks for a required Krypton checkout directory',
    answer:
      'That prompt does not match the current standalone manifest. Cancel it, remove the obsolete Krypton extension entry in Claude Desktop Settings > Extensions, and install the freshly downloaded or rebuilt krypton-protected-fs.mcpb. Avoid older downloads with the same filename. Fully quit with Cmd + Q and reopen Claude. The current bundle has zero required setup fields, starts its own native daemon, and does not require a checkout, krypton.config.json, or npm run dev:full. Leave the optional protected_workspace_root blank for the private Application Support sandbox. Replacing the extension does not require deleting your workspace or evidence ledger; repeat the write-success and read-denial checks afterward.',
  },
  {
    question: 'Claude Desktop reports Request timed out for the Krypton extension',
    answer:
      "Claude Desktop's built-in Node.js loads the extension through a host wrapper. When the optional protected_workspace_root is blank, Desktop passes the unexpanded ${user_config.protected_workspace_root} reference; current bundles treat exactly that reference as blank and use the private Application Support sandbox, while any other template still fails closed. A startup failure ends the host-loaded process, so Claude reports a disconnect instead of waiting for a timeout. The redacted [KRYPTON] category appears as a [UtilityProcess stderr] line in ~/Library/Logs/Claude/main.log, not in the per-server MCP log. If the host exits before async cleanup finishes, an exit-time fallback sends SIGKILL only to that session's exact owned daemon. Older bundles could leave one behind: fully quit Claude with Cmd + Q, check pgrep -fl 'krypton-core-native --standalone-config', stop a leftover process from an earlier install, install the freshly rebuilt krypton-protected-fs.mcpb, and reopen Claude. Live Claude Desktop UI behavior remains manual QA.",
  },
  {
    question: 'Claude Desktop launches the Krypton extension several times at once',
    answer:
      "Claude Desktop can start one extension several times in the same second: a short-lived probe, the main connection and the Cowork and Code pool. They share one protected workspace and one private runtime. The first launch to take the native instance lock owns the daemon. Each other launch sees its own daemon exit on that lock, reaps only that exact child, and attaches to the owner through the private daemon.json discovery record and capability after healthy readiness. The discovered PID is compared and never signaled, and all sessions share one telemetry ledger. Attached sessions probe once per second. When the owner exits, tool calls fail closed with unavailable until one session owns a fresh daemon, usually within about a second, and the others re-attach. Gap calls are not retried, and recovery makes at most two attempts per owner loss before failing with native_owner_lost. A daemon that rejects the capability while discovery stays unchanged fails closed with native_unauthorized. First launches after an install or upgrade publish private files without replacing a sibling's copy and accept it only with identical bytes. Categories appear as [UtilityProcess stderr] [KRYPTON] lines in ~/Library/Logs/Claude/main.log. Live Claude Desktop UI behavior remains manual QA.",
  },
  {
    question: 'Gatekeeper / Unsigned Binary Notice on macOS',
    answer:
      'Krypton release binaries are unsigned and unnotarized. After verifying the release source and checksums, attempt opening the file; if macOS blocks a trusted download, review System Settings > Privacy & Security > Open Anyway when offered. Managed Macs may require IT approval. Do not globally disable Gatekeeper or strip quarantine recursively. Approval does not prove containment; repeat the live tool test after installation.',
  },
  {
    question: 'Native Daemon Connection Timeout',
    answer:
      'A missing socket, disconnect, authentication error or 1500 ms absolute IPC deadline denies the pending operation; there is no permissive fallback. In source mode, the launcher auto-starts the compiled daemon and requires authenticated healthy readiness within three seconds after host spawn; the initial 1500 ms IPC probe and filesystem preparation are separate. If the binary is missing, run cargo build --release --manifest-path src/core-native/Cargo.toml, then reconnect. A refused/disconnected registration refreshes authenticated health and discovery once, revalidates the same child, and retries registration; stale identities and tool writes are not retried. Native startup.lock arbitration alone can remove a refused orphan socket. SIGINT/SIGTERM/beforeExit cancel recovery and request child shutdown; unregister follows child exit while the shared listener stays available for new sessions. Authentication errors, timeouts and degraded health fail closed without replacing the existing daemon. After rebuilding, restart the known source daemon once to load updated registration behavior. Inspect private .krypton/logs/daemon.log output (64 KiB maximum, reset per startup attempt; it can contain private paths, so redact before sharing) and .krypton/runtime/ permissions without printing capability or daemon.json contents. Each attempt atomically replaces the log while existing hosts retain private file handles. The visible log may describe a losing concurrent starter; the separate telemetry ledger is unaffected. Standalone MCPB supervises its own daemon using a short temporary runtime directory and stores evidence at ~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl. Restart the MCP session and inspect redacted client logs. Never delete a live socket or startup.lock, and inspect the destination before retrying a timed-out write. The Pages dashboard cannot inspect local sockets or display native workstation evidence.',
  },
  {
    question: 'How do I view native telemetry, and is the dashboard required?',
    answer:
      'Protection runs without the dashboard. For a source checkout, run npm run dev:dashboard and open http://localhost:3000 after a protected client connects. The viewer reads .krypton/telemetry/alerts.jsonl, a bounded JSONL ledger retaining at most 10,000 events or 8 MiB through atomic compaction. It is not an unbounded append-only log. Standalone MCPB evidence lives under ~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl and is not automatically loaded by the source viewer. GitHub Pages uses mock data only until the planned Phase 2 local-file bridge ships. A disconnected or degraded daemon fails closed for protected tool calls; a visible dashboard alone never proves protection.',
  },
  {
    question: 'Permissions Denied on Protected Workspace',
    answer:
      'Choose an existing directory owned by your user in protected_workspace_root, or leave it blank to create ~/Library/Application Support/KryptonSecurity/sandbox_workspace. Invalid nonblank paths do not silently fall back. Check directory permissions and macOS privacy controls; do not run as root or grant broad disk access to bypass a denial. /etc/passwd is outside the default workspace and should be denied. A file denial produces a receipt and queues INTERCEPTED evidence; it does not trigger a desktop quarantine banner.',
  },
  {
    question: 'Can I install the native runtime on Windows?',
    answer:
      'No. Install-Windows.cmd invokes the shared setup engine when Node is available and exits nonzero without editing client settings. Windows is dashboard demonstration-only until the native runtime ships. Claude Desktop configuration normally lives at %APPDATA%/Claude/claude_desktop_config.json (fallback: %USERPROFILE%/AppData/Roaming/Claude/claude_desktop_config.json), and Cursor uses %USERPROFILE%/.cursor/mcp.json; those locations are not enabled installation targets. The MCPB manifest intentionally supports darwin only.',
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
        <KryptonButton size="md" startIcon={<BookOpen />} variant="secondary">
          About &amp; Guide
        </KryptonButton>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-krypton-muted-overlay backdrop-blur-sm data-[state=closed]:animate-krypton-overlay-out data-[state=open]:animate-krypton-overlay-in" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-krypton-border-muted bg-krypton-bg-main text-krypton-fg-primary shadow-2xl shadow-krypton-shadow focus:outline-none lg:max-w-5xl data-[state=closed]:animate-krypton-drawer-out data-[state=open]:animate-krypton-drawer-in">
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
            aria-label="Documentation"
            className="flex gap-krypton-space-4 border-b border-krypton-border-muted px-krypton-space-5 py-krypton-space-3 text-sm text-krypton-accent-cyan"
          >
            <Link href="/docs/">Documentation index</Link>
            <Link href="/docs/testing-guide/">End-user testing guide</Link>
          </nav>

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

                <section
                  aria-labelledby="security-model-heading"
                  className="space-y-krypton-space-4"
                >
                  <h2
                    id="security-model-heading"
                    className="text-lg font-bold text-krypton-fg-primary"
                  >
                    The Security Model: Prompt Alignment vs. Kernel Containment
                  </h2>
                  <p className="text-sm leading-6 text-krypton-fg-secondary">
                    Krypton does not replace model alignment; even if an agent is tricked,
                    jailbroken, or runs in full auto-pilot, unauthorized file access through its
                    protected MCP tools fails closed.
                  </p>
                  <p className="text-xs text-krypton-fg-muted lg:hidden">
                    Scroll horizontally to compare all four columns. Keyboard: focus the table area
                    and use the arrow keys.
                  </p>
                  <div
                    role="region"
                    aria-label="Security model comparison, scroll horizontally for all columns"
                    tabIndex={0}
                    className="overflow-x-auto rounded-krypton-radius-card border border-krypton-border-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-focus-ring"
                  >
                    <table
                      aria-labelledby="security-model-heading"
                      className="w-full min-w-krypton-comparison border-collapse text-left text-sm leading-6"
                    >
                      <thead className="bg-krypton-bg-surface text-krypton-fg-primary">
                        <tr>
                          {[
                            'Security Layer',
                            'Scope & Mechanism',
                            'Trust Assumption',
                            'Failure Mode Addressed',
                          ].map((heading) => (
                            <th
                              key={heading}
                              scope="col"
                              className="px-krypton-space-4 py-krypton-space-3 align-top"
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-krypton-border-muted text-krypton-fg-secondary">
                        {SECURITY_LAYERS.map(([layer, ...details]) => (
                          <tr key={layer}>
                            <th
                              scope="row"
                              className="px-krypton-space-4 py-krypton-space-3 align-top font-semibold text-krypton-fg-primary"
                            >
                              {layer}
                            </th>
                            {details.map((detail) => (
                              <td
                                key={detail}
                                className="px-krypton-space-4 py-krypton-space-3 align-top"
                              >
                                {detail}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-sm leading-6 text-krypton-fg-muted">
                    This is defense in depth, not universal kernel isolation: arbitrary syscalls and
                    unrelated host tools remain outside this boundary. Audit-Only is the native
                    startup default and suppresses process termination, while unsafe MCP file calls
                    are still denied. Portable watcher events alone never authorize isolation.
                  </p>
                  <p className="text-sm leading-6 text-krypton-fg-muted">
                    Further reading:{' '}
                    <a
                      className="text-krypton-accent-cyan underline"
                      href="https://www.anthropic.com/news/prompt-injection-defenses"
                      target="_blank"
                      rel="noreferrer"
                    >
                      prompt-injection defenses
                    </a>
                    {' and '}
                    <a
                      className="text-krypton-accent-cyan underline"
                      href="https://geminicli.com/docs/cli/sandbox/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      client sandbox controls
                    </a>
                    .
                  </p>
                </section>

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
                    model lookups. The macOS MCPB is the standalone installation route; Windows
                    remains demonstration-only. GitHub Pages cannot connect to your local daemon;
                    its local-file telemetry bridge is planned for Phase 2. Protection does not
                    require the optional dashboard.
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
                  For source development on macOS, use Node.js v20.19.4 (Node 20 LTS baseline), npm
                  10.x, and Rust 1.97.0 via rustup and cargo. The standalone MCPB does not require
                  these source build tools. Accept version-manager prompts for .node-version or
                  .nvmrc when available. rust-toolchain.toml pins and syncs the host toolchain
                  during builds: 1.97.0-aarch64-apple-darwin on Apple Silicon. macOS native builds
                  also require Apple command-line developer tools.
                </p>
                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">
                    Method 1: Zero-terminal double-click (macOS recommended)
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    Download <code>krypton-protected-fs.mcpb</code> from GitHub Releases.
                    Double-click it to open Claude Desktop and confirm installation. If that does
                    not open the installer, use Settings &gt; Extensions &gt; Advanced settings &gt;
                    Install Extension. There are zero required setup fields. The optional{}
                    <code>protected_workspace_root</code> selects an existing protected directory. A
                    blank value creates{' '}
                    <code>~/Library/Application Support/KryptonSecurity/sandbox_workspace</code>.
                    The standalone macOS bundle selects its arm64 or x64 daemon and supervises that
                    exact child for the MCP session, so this install does not need a repository
                    checkout or Rust toolchain. It contains only the two Krypton MCP file tools and
                    does not launch the Next.js dashboard. The artifacts are unsigned and
                    unnotarized; Gatekeeper behavior and clean-machine Claude Desktop installation
                    remain manual release checks.
                  </p>
                </aside>
                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">
                    Universal stdio MCP clients
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    After npm ci and the release native build above, configure Claude Desktop,
                    Claude Code, Cursor, Codex CLI or any stdio host to run an absolute Node path
                    with <code>/absolute/path/krypton-security/src/cli.cjs run</code>. No MCPB
                    extraction is needed. Set <code>KRYPTON_PROTECTED_WORKSPACE_ROOT</code> to an
                    existing absolute directory, or leave it blank for the private Application
                    Support sandbox. Invalid selections fail closed. Bare run starts and stops its
                    own daemon; concurrent sessions for one workspace share it, and the others
                    attach without owning it. The local npm link alias is{' '}
                    <code>krypton-mcp run</code>; registry npx installation is not verified. Native
                    support remains macOS arm64/x64. Live client UI checks remain manual QA.
                  </p>
                </aside>
                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">
                    Source-checkout double-click launchers
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    After installing Node, Rust, source dependencies and the release native binary,
                    close your clients and double-click
                    <code> scripts/Install-Mac.command</code>. It configures detected Claude
                    Desktop, Cursor, Claude Code and Cline using the shared backup-and-merge engine,
                    then attempts a bounded macOS completion notification. Review the console
                    results; a notification is not proof of active containment. Restart clients to
                    auto-start the compiled daemon. The script does not install prerequisites. It
                    opens Terminal and requires Node on PATH; the MCPB above is the zero-terminal
                    route. Keep scripts inside the checkout. <code>Install-Windows.cmd</code> exits
                    with an unsupported-platform notice and leaves settings untouched. It does not
                    install Windows containment.
                  </p>
                </aside>
                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">
                    Live verification after setup
                  </h2>
                  <ol className="mt-2 space-y-krypton-space-2 text-sm leading-6 text-krypton-fg-muted">
                    <li>1. Fully quit Claude Desktop with Cmd + Q, then reopen it.</li>
                    <li>
                      2. Open the tools / + menu and Connectors; verify krypton_read_file and
                      krypton_write_file are registered.
                    </li>
                    <li>
                      3. In a fresh protected test workspace, send these prompts separately and
                      confirm each actual Krypton tool runs:
                    </li>
                  </ol>
                  <code className="mt-2 block overflow-x-auto rounded-krypton-radius-control bg-krypton-bg-main p-krypton-space-3 font-mono text-xs leading-5 text-krypton-accent-cyan">
                    Use krypton_write_file to write notes.txt inside the workspace with content
                    &apos;Hello Krypton&apos;.
                  </code>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    Expect file_written and notes.txt containing Hello Krypton. This replaces an
                    existing notes.txt; use a fresh test workspace. Then check containment:
                  </p>
                  <code className="mt-2 block overflow-x-auto rounded-krypton-radius-control bg-krypton-bg-main p-krypton-space-3 font-mono text-xs leading-5 text-krypton-accent-cyan">
                    Can you use your krypton_read_file tool to inspect the contents of /etc/passwd?
                  </code>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    4. Expect file_access_denied, isError: true, a native denial receipt and queued
                    INTERCEPTED ledger evidence, not file contents. A refusal by the model without a
                    tool call does not verify containment. A file denial does not trigger a desktop
                    quarantine banner; banners accompany confirmed registered-child isolation.
                    GitHub Pages shows simulated data only. Use the local source dashboard for its
                    source ledger; the standalone bundle has a separate Application Support ledger.
                  </p>
                </aside>
                <h2 className="mt-5 text-sm font-bold text-krypton-fg-primary">
                  Method 2: Terminal / source setup
                </h2>
                <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                  Complete these three steps with the pinned prerequisites. The setup script does
                  not install Node, Rust, dependencies, or the native binary. No development
                  terminal is required for protection. For terminal setup, use{' '}
                  <code>npm run setup</code> instead of double-clicking the script.
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
                    Run <code>npm run dev:dashboard</code> optionally and open
                    <code> http://localhost:3000</code> for source telemetry. If occupied, use
                    <code> npm run dev:dashboard -- -p 3001</code> and open
                    <code> http://localhost:3001</code>. The override changes only the dashboard
                    HTTP port, not the native Unix socket. The viewer does not start the daemon or
                    automatically load standalone Application Support ledgers. GitHub Pages stays
                    mock until the planned Phase 2 local-file bridge ships.
                  </p>
                </aside>

                <aside className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-sm font-bold text-krypton-fg-primary">
                    Supervise a real agent
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-muted">
                    <code>krypton run -- &lt;command&gt; [args...]</code> reuses a healthy local
                    daemon or starts the compiled binary when unavailable. Readiness must succeed
                    within three seconds after host spawn; the initial 1500 ms IPC probe and
                    filesystem preparation are separate. Authentication or degraded-health failures
                    deny startup without replacing the existing daemon. The detached source daemon
                    remains running after MCP disconnect, owned by a detached Node host; each client
                    retains its registration/unregister lifecycle. A refused or disconnected
                    registration gets one authenticated refresh and exact-identity retry. Only the
                    lock-holding native starter removes refused orphan sockets; live endpoints
                    remain intact. Shutdown cancels recovery and child exit triggers unregister.
                    Combined native stdout/stderr goes to private
                    <code> .krypton/logs/daemon.log</code>, capped at 64 KiB then discarded and
                    atomically replaced per startup attempt without mixing existing host output. The
                    visible log may describe a losing concurrent starter; the telemetry ledger is
                    unaffected. Native output can contain private paths; redact before sharing.{' '}
                    <code>krypton daemon:start</code> starts the foreground Cargo daemon without the
                    dashboard. From the checkout root, targets run in the configured protected
                    workspace; from a protected subdirectory, that directory is preserved. Relative
                    paths resolve there. Desktop MCP hosts can select the checkout with an absolute{' '}
                    <code>KRYPTON_PROJECT_ROOT</code> and pass a literal argument array. Stdio is
                    inherited, no shell expansion is performed, and supervisor diagnostics use
                    stderr so MCP stdout remains intact. Close clients and run{' '}
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
                    Build the source daemon with
                    <code> cargo build --release --manifest-path src/core-native/Cargo.toml</code>.
                    All release candidates precede debug candidates across CARGO_TARGET_DIR
                    (absolute or relative to the checkout), target/, and src/core-native/target/.
                    After <code>npm link</code>, run
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
