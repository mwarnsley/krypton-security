'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  Bell,
  BookOpen,
  Download,
  ExternalLink,
  FolderLock,
  ShieldCheck,
  ShieldOff,
  Terminal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useState, type KeyboardEvent } from 'react';

import { KryptonButton, KryptonCodeBlock, KryptonIconButton } from '../../primitives';

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
      'The dashboard and Field Guide support light and dark themes with semantic colors, keyboard focus and selectable copyable test blocks. On GitHub Pages, Simulate Threat Event adds an explicitly mock alert. Pages cannot read local native telemetry today; the local-file bridge is planned for Phase 2. The optional source dashboard reads its checkout ledger, not standalone Application Support ledgers automatically.',
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
      'Phase 4 activates Windows native containment through Named Pipes and Job Objects; Linux Landlock and seccomp-bpf follow the same fail-closed boundary.',
    title: 'Phase 4 · Cross-Platform Containment (v2.0)',
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
    question:
      "How does Krypton protect against autonomous AI actions if 'Full Access' is enabled in my client?",
    answer:
      "AI clients such as Claude Desktop or Codex often ask for confirmation before file operations; enabling 'Full Access' can bypass those manual prompts. Krypton checks protected filesystem requests at the protocol level rather than relying on prompt approval. With krypton-protected-fs.mcpb configured on supported macOS installations, only file operations routed through krypton_read_file and krypton_write_file are evaluated by the native Rust boundary supervisor. These tools deterministically deny parent traversal (../), escaping symlinks and paths outside the configured workspace, including /etc or ~/.ssh in the default sandbox, even when the client has full autonomy. Denials queue local telemetry; the connected source dashboard can display its checkout ledger. Standalone bundle events stay in their separate local ledger, and GitHub Pages shows mock data. Direct raw terminal subshells (sh/bash), built-in client tools and arbitrary OS user actions are not automatically intercepted. Runtime protection is strongest when file operations use Krypton's protected MCP tools; installing the bundle does not redirect every client operation or provide universal syscall isolation.",
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
      'The dashboard uses the full viewport width with 16px side padding on small screens and 24px above the small breakpoint. At 1024px, two equal-height cards share the top section: workspace identity, guide/theme utilities and Engine Overview on the left; Watchdog status, active processes and audit/telemetry controls on the right. Both use 24px padding. About Guide sits beside Engine Overview; the theme toggle stays at the top right of the workspace header. The runtime metrics panel shows three columns: supervised MCP child count, centered current alert-list count and right-aligned boundary status. Metrics stack below 640px. The info icon before Intercepted Alerts lists Critical, High, Medium, Low and Info counts from the same loaded list on hover, tap or keyboard focus; Escape dismisses it. The count and caption remain uncluttered. Table severity badges use soft borders matching their text tone. The table uses Target Path and Security Verification; unattributed denials read Blocked (Unattributed). Security Verification shows the event source and recorded evidence; receipts are not cryptographically signed. Audit-only logs violations without halting the supervised AI process; active mode can halt supervised processes trying to escape, while outside-folder file access stays blocked in both modes. Table help icons precede labels, sort arrows follow labels and the right-aligned action buttons expose hover and keyboard focus states. The Actions header uses one unboxed info icon with an icon-led four-section guide to available utilities. Row menus open retained raw JSON, copy available process details, show the current allowed folder or export unsigned Markdown reports. Allowed-folder metadata requires an updated connected native daemon; older daemons and Pages show unavailable, never the attempted target path. Counts above 9,999 use compact notation with exact tooltip and accessible text. The Total policy rejections caption refers to the retained list, which can include observations, not a lifetime rejection total; its version identifies the dashboard release, not an attested daemon version or confirmed quarantine. Degraded/offline states never claim active containment, and Pages metrics remain simulated. Audit controls align left and telemetry aligns right in the footer. Smaller screens stack workspace, runtime, then the full-width activity log. About Guide is always available in development, production and Pages, with no environment or hostname gate; the former public guide marker is no longer used. Static export still shows mock telemetry and guide availability never authorizes native operations. Full signatures are retained with word-boundary wrapping; focus the table viewport to scroll when space is limited. The Sun/Moon button at the top right of the workspace header switches themes; your system preference is used until you choose a mode, and browser storage remembers it when available. Install & Setup provides numbered peer-test cards, copy buttons and a manual selection fallback when clipboard access fails. Protection runs without the dashboard. For a source checkout, run npm run dev:dashboard and open http://localhost:3000 after a protected client connects. The viewer reads .krypton/telemetry/alerts.jsonl, a bounded JSONL ledger retaining at most 10,000 events or 8 MiB through atomic compaction. It is not an unbounded append-only log. Standalone MCPB evidence lives under ~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl and is not automatically loaded by the source viewer. GitHub Pages uses mock data only until the planned Phase 2 local-file bridge ships. A disconnected or degraded daemon fails closed for protected tool calls; a visible dashboard alone never proves protection.',
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

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) {
        setActiveTab(defaultTab);
      }
    },
    [defaultTab]
  );

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
          About Guide
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
              <Dialog.Description className="mt-1 text-sm leading-6 text-krypton-fg-body">
                A plain-language tour of the boundary, its limits, and the quickest way to try it.
                Available in every dashboard environment.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <KryptonIconButton
                aria-label="Close About Guide"
                icon={<X />}
                size="lg"
                variant="secondary"
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
                      : 'cursor-pointer rounded-krypton-radius-control border border-krypton-control-border bg-krypton-bg-main px-krypton-space-2 py-krypton-space-2 text-xs font-semibold text-krypton-fg-body transition-colors hover:bg-krypton-control-hover hover:text-krypton-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krypton-focus-ring'
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
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    Modern AI coding agents and smart terminals are powerful, but they can run an
                    unsafe command or reach for a private file by mistake. Krypton gives integrated
                    tools an explicit project boundary, makes local deterministic decisions, and
                    records what its native sensors can actually prove. Use the workspace header
                    Sun/Moon control for light or dark mode; Install &amp; Setup contains copyable
                    peer-test prompts.
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
                              <p className="mt-1 text-sm leading-6 text-krypton-fg-body">
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
                  <p className="text-sm leading-6 text-krypton-fg-body">
                    Krypton does not replace model alignment; even if an agent is tricked,
                    jailbroken, or runs in full auto-pilot, unauthorized file access through its
                    protected MCP tools fails closed.
                  </p>
                  <p className="text-xs text-krypton-fg-body lg:hidden">
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
                      <tbody className="divide-y divide-krypton-border-muted text-krypton-fg-body">
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
                  <p className="text-sm leading-6 text-krypton-fg-body">
                    This is defense in depth, not universal kernel isolation: arbitrary syscalls and
                    unrelated host tools remain outside this boundary. Audit-Only is the native
                    startup default and suppresses process termination, while unsafe MCP file calls
                    are still denied. Portable watcher events alone never authorize isolation.
                  </p>
                  <p className="text-sm leading-6 text-krypton-fg-body">
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
                  <ul className="mt-3 space-y-krypton-space-2 text-sm leading-6 text-krypton-fg-body">
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
                <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
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
                          <p className="mt-1 text-sm leading-6 text-krypton-fg-body">
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
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
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
                        <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                          {phase.summary}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 border-t border-krypton-border-muted pt-krypton-space-4">
                    <h3 className="text-sm font-bold text-krypton-fg-primary">
                      Developer utilities
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                      Inspect retained event JSON, copy available process details, review the
                      current allowed workspace folder or download an unsigned Markdown report.
                      Unknown process details remain unavailable. Native protection runs locally
                      without the dashboard.
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
                <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                  For source development on macOS, use Node.js v20.19.4 (Node 20 LTS baseline), npm
                  10.x, and Rust 1.97.0 via rustup and cargo. The standalone MCPB does not require
                  these source build tools. Accept version-manager prompts for .node-version or
                  .nvmrc when available. rust-toolchain.toml pins and syncs the host toolchain
                  during builds: 1.97.0-aarch64-apple-darwin on Apple Silicon. macOS native builds
                  also require Apple command-line developer tools.
                </p>
                <article className="my-krypton-space-4 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-5">
                  <h2 className="text-base font-bold text-krypton-fg-primary">
                    Method 1: Zero-terminal double-click (macOS recommended)
                  </h2>
                  <section aria-labelledby="bundle-download-title" className="mt-krypton-space-4">
                    <h3 id="bundle-download-title" className="mb-krypton-space-4 font-semibold">
                      1. Download the security bundle
                    </h3>
                    <div className="mb-krypton-space-4">
                      <KryptonButton asChild startIcon={<Download />} variant="primary">
                        <a
                          href={`${REPOSITORY_URL}/releases/download/v1.0.3/krypton-protected-fs.mcpb`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Download v1.0.3 bundle
                        </a>
                      </KryptonButton>
                    </div>
                    <KryptonCodeBlock label="Bundle filename" code="krypton-protected-fs.mcpb" />
                    <p className="mt-krypton-space-4 text-sm leading-6 text-krypton-fg-body">
                      Targeting release v1.0.3. If using a private checkout or direct file transfer,
                      verify your bundle matches before installation.
                    </p>
                    <p className="mt-krypton-space-2 text-sm leading-6 text-krypton-fg-body">
                      Check the release checksums before opening the file. If the download is
                      unavailable, ask the maintainer for the bundle and matching checksums. This
                      Mac bundle includes Apple Silicon and Intel support; it needs no source
                      checkout or build tools.
                    </p>
                  </section>
                  <section
                    aria-labelledby="bundle-install-title"
                    className="mt-krypton-space-5 border-t border-krypton-border-muted pt-krypton-space-5"
                  >
                    <h3 id="bundle-install-title" className="mb-krypton-space-4 font-semibold">
                      2. Install in Claude Desktop
                    </h3>
                    <ol className="mb-krypton-space-4 list-decimal space-y-krypton-space-3 pl-krypton-space-5 text-sm leading-6 text-krypton-fg-body">
                      <li>Open Claude Desktop and open Settings using Cmd + ,</li>
                      <li>
                        Go to Extensions (or Developer) and drag-and-drop the downloaded .mcpb file
                        into the window. If your version does not support this, choose Advanced
                        settings → Install Extension and select the file.
                      </li>
                      <li>
                        Leave all optional setup fields blank to test default automatic isolation.
                      </li>
                      <li>
                        Restart Claude Desktop (Cmd + Q, then reopen) to activate the security
                        tools.
                      </li>
                    </ol>
                    <KryptonCodeBlock
                      label="Optional workspace root (leave blank)"
                      code="protected_workspace_root"
                    />
                    <KryptonCodeBlock
                      label="Default automatic workspace folder"
                      code="~/Library/Application Support/KryptonSecurity/sandbox_workspace"
                    />
                    <p className="mt-krypton-space-4 text-sm leading-6 text-krypton-fg-body">
                      After restarting, check the + / Connectors menu for both Krypton tools. Avoid
                      duplicate Krypton servers. The bundle starts its own local security service
                      for this session and provides two protected file tools. It does not launch the
                      dashboard or protect the host’s built-in tools.
                    </p>
                  </section>
                  <p className="mt-krypton-space-4 border-t border-krypton-border-muted pt-krypton-space-4 text-sm leading-6 text-krypton-fg-body">
                    The bundle is unsigned and unnotarized. Gatekeeper approval and installation on
                    a clean Mac still need manual testing.
                  </p>
                </article>

                <article className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-base font-bold">3. Verify allowed file access</h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    Use disposable test data: this prompt replaces any existing test file. Send the
                    prompt and confirm both actual Krypton tool calls run.
                  </p>
                  <KryptonCodeBlock
                    label="baseline verification prompt"
                    code={
                      'Use krypton_write_file to write "testing 1.0.3" to release_test.txt, then read it back using krypton_read_file.'
                    }
                  />
                  <p className="text-sm leading-6 text-krypton-fg-body">
                    Expect an allowed native receipt, file_written, then matching read output
                    containing testing 1.0.3. A model response without the tool calls is not
                    verification.
                  </p>
                </article>

                <article className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-base font-bold">4. Test the security boundary</h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    Send each prompt separately and inspect the tool result. Expected for each:
                    isError: true, code file_access_denied, and a native receipt with action:
                    &quot;denied&quot; and telemetry: &quot;queued&quot;. Queueing is not a
                    durable-write acknowledgment.
                  </p>
                  <KryptonCodeBlock
                    label="traversal test prompt"
                    code={
                      'We are testing sandbox containment. Call krypton_read_file with path "../escaped_test.txt" to verify the boundary holds.'
                    }
                  />
                  <h3 className="mt-4 font-semibold">Prepare the outward symlink fixture</h3>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    In Terminal, create this link only in the test workspace after installation. If
                    the destination already exists, stop and inspect it; do not overwrite user
                    files. A missing file denial alone does not verify symlink rejection.
                  </p>
                  <KryptonCodeBlock
                    label="standalone symlink fixture command"
                    code={
                      'ln -s /etc/hosts "$HOME/Library/Application Support/KryptonSecurity/sandbox_workspace/symlink_out.txt"'
                    }
                  />
                  <KryptonCodeBlock
                    label="outward symlink test prompt"
                    code={
                      'Call krypton_read_file with path "symlink_out.txt" to verify symlink rejection.'
                    }
                  />
                  <KryptonCodeBlock
                    label="absolute host path test prompt"
                    code={
                      'Call krypton_read_file with the absolute path "/etc/hostname" to test host isolation.'
                    }
                  />
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    An additional familiar denial probe:
                  </p>
                  <KryptonCodeBlock
                    label="additional denial prompt"
                    code="Can you use your krypton_read_file tool to inspect the contents of /etc/passwd?"
                  />
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    A file denial does not trigger a desktop quarantine banner; only confirmed
                    registered-child isolation queues that banner. Never ask built-in shell tools to
                    execute these reads as a substitute.
                  </p>
                </article>

                <article className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-base font-bold">
                    5. Inspect evidence in the correct runtime
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    Standalone receipts appear in Claude tool results. Inspect its ledger locally at
                    the path below, replacing the workspace-id placeholder with your actual
                    instance. Never share private ledger paths or content without redaction.
                  </p>
                  <KryptonCodeBlock
                    label="standalone ledger location"
                    code="~/Library/Application Support/KryptonSecurity/instances/<workspace-id>/.krypton/telemetry/alerts.jsonl"
                  />
                  <ol className="mt-3 list-decimal space-y-krypton-space-2 pl-5 text-sm leading-6 text-krypton-fg-body">
                    <li>
                      To verify the dashboard table, first complete Method 2 source setup below and
                      connect that source-configured client. Keep standalone and source sessions
                      distinct.
                    </li>
                    <li>
                      Create the source fixture from the checkout root, repeat the same three
                      boundary prompts through the source client, then run the dashboard command
                      below.
                    </li>
                    <li>
                      Open the local dashboard, confirm the Native telemetry indicator, and inspect
                      the Intercepted security alerts table for the three high-severity INTERCEPTED
                      denials, matching paths, tool names, and timestamps. These do not prove
                      process quarantine.
                    </li>
                  </ol>
                  <KryptonCodeBlock
                    label="source symlink fixture command"
                    code="ln -s /etc/hosts sandbox_workspace/symlink_out.txt"
                  />
                  <KryptonCodeBlock label="start local dashboard" code="npm run dev" />
                  <KryptonCodeBlock label="local dashboard URL" code="http://localhost:3000" />
                  <p className="text-sm leading-6 text-krypton-fg-body">
                    The local viewer reads its checkout ledger, not the standalone Application
                    Support ledger automatically. GitHub Pages uses mock data only and cannot record
                    these native tests. Unavailable or degraded native telemetry is not a passing
                    containment test. In a row menu, inspect JSON, copy process details, view the
                    allowed folder and download an unsigned report. Restart an updated native daemon
                    for current folder metadata; older daemons and Pages show unavailable.
                  </p>
                </article>

                <article className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <h2 className="text-base font-bold">6. Check both themes and keyboard access</h2>
                  <ol className="mt-2 list-decimal space-y-krypton-space-2 pl-5 text-sm leading-6 text-krypton-fg-body">
                    <li>
                      Use the Sun/Moon button at the top right of the workspace header to select
                      light and dark modes. The initial choice follows your system preference; saved
                      choices override it when browser storage is available.
                    </li>
                    <li>
                      In each theme, inspect all four guide tabs, table headings, badges, copy
                      buttons, and notifications. Tab through controls, use arrow keys in the tab
                      strip, and Escape to close the drawer. Confirm focus returns to About Guide.
                    </li>
                    <li>
                      Test at 200% zoom and narrow width; copy each prompt. If clipboard access is
                      blocked, select the text and copy it manually.
                    </li>
                    <li>
                      In Chrome DevTools → Lighthouse, run Accessibility for each theme (target
                      95+). Inspect the open drawer too, and review contrast, keyboard operation,
                      and screen-reader names manually. A Lighthouse score alone does not establish
                      WCAG compliance.
                    </li>
                  </ol>
                </article>

                <details className="mt-5 rounded-krypton-radius-card border border-krypton-control-border bg-krypton-bg-surface p-krypton-space-4">
                  <summary className="cursor-pointer font-semibold">
                    Universal stdio MCP clients
                  </summary>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    After installing source dependencies and the native release binary, configure an
                    absolute Node executable with this argument sequence. Native support remains
                    macOS arm64/x64; live client UI checks remain manual QA.
                  </p>
                  <KryptonCodeBlock
                    label="stdio launch arguments"
                    code="/absolute/path/krypton-security/src/cli.cjs run"
                  />
                  <KryptonCodeBlock
                    label="optional protected workspace environment variable"
                    code="KRYPTON_PROTECTED_WORKSPACE_ROOT"
                  />
                  <p className="text-sm leading-6 text-krypton-fg-body">
                    Set the environment variable to an existing absolute directory or omit it for
                    the private sandbox. Invalid selections fail closed. Bare run owns and stops its
                    daemon; concurrent sessions attach without owning it. Registry npx installation
                    is unverified.
                  </p>
                  <KryptonCodeBlock label="local npm link alias" code="krypton-mcp run" />
                </details>
                <h2 className="mt-5 text-sm font-bold text-krypton-fg-primary">
                  Method 2: Terminal / source setup
                </h2>
                <div className="mt-2 text-sm leading-6 text-krypton-fg-body">
                  Complete these three steps with the pinned prerequisites. The setup script does
                  not install Node, Rust, dependencies, or the native binary. No development
                  terminal is required for protection. For terminal setup, use{' '}
                  <KryptonCodeBlock label="terminal setup command" code={'npm run setup'} /> instead
                  of double-clicking the script.
                </div>
                <ol className="mt-5 space-y-krypton-space-3">
                  {SETUP_STEPS.map(([title, command]) => (
                    <li
                      className="rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4"
                      key={title}
                    >
                      <h3 className="text-sm font-bold text-krypton-fg-primary">{title}</h3>
                      <KryptonCodeBlock label={title} code={command} />
                    </li>
                  ))}
                </ol>

                <details className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <summary className="cursor-pointer font-semibold text-krypton-fg-primary">
                    Runtime and port handling
                  </summary>
                  <div className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    Run{' '}
                    <KryptonCodeBlock label="dashboard command" code={'npm run dev:dashboard'} />{' '}
                    optionally and open
                    <KryptonCodeBlock
                      label="dashboard address"
                      code={'http://localhost:3000'}
                    />{' '}
                    for source telemetry. If occupied, use
                    <KryptonCodeBlock
                      label="alternate dashboard port command"
                      code={'npm run dev:dashboard -- -p 3001'}
                    />{' '}
                    and open
                    <KryptonCodeBlock
                      label="alternate dashboard address"
                      code={'http://localhost:3001'}
                    />
                    . The override changes only the dashboard HTTP port, not the native Unix socket.
                    The viewer does not start the daemon or automatically load standalone
                    Application Support ledgers. GitHub Pages stays mock until the planned Phase 2
                    local-file bridge ships.
                  </div>
                </details>

                <details className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <summary className="cursor-pointer font-semibold text-krypton-fg-primary">
                    Supervise a real agent
                  </summary>
                  <div className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    <KryptonCodeBlock
                      label="supervisor syntax"
                      code={'krypton run -- <command> [args...]'}
                    />{' '}
                    reuses a healthy local daemon or starts the compiled binary when unavailable.
                    Readiness must succeed within three seconds after host spawn; the initial 1500
                    ms IPC probe and filesystem preparation are separate. Authentication or
                    degraded-health failures deny startup without replacing the existing daemon. The
                    detached source daemon remains running after MCP disconnect, owned by a detached
                    Node host; each client retains its registration/unregister lifecycle. A refused
                    or disconnected registration gets one authenticated refresh and exact-identity
                    retry. Only the lock-holding native starter removes refused orphan sockets; live
                    endpoints remain intact. Shutdown cancels recovery and child exit triggers
                    unregister. Combined native stdout/stderr goes to private
                    <KryptonCodeBlock label="source daemon log" code={'.krypton/logs/daemon.log'} />
                    , capped at 64 KiB then discarded and atomically replaced per startup attempt
                    without mixing existing host output. The visible log may describe a losing
                    concurrent starter; the telemetry ledger is unaffected. Native output can
                    contain private paths; redact before sharing.{' '}
                    <KryptonCodeBlock
                      label="foreground daemon command"
                      code={'krypton daemon:start'}
                    />{' '}
                    starts the foreground Cargo daemon without the dashboard. From the checkout
                    root, targets run in the configured protected workspace; from a protected
                    subdirectory, that directory is preserved. Relative paths resolve there. Desktop
                    MCP hosts can select the checkout with an absolute{' '}
                    <KryptonCodeBlock
                      label="source project environment variable"
                      code={'KRYPTON_PROJECT_ROOT'}
                    />{' '}
                    and pass a literal argument array. Stdio is inherited, no shell expansion is
                    performed, and supervisor diagnostics use stderr so MCP stdout remains intact.
                    Close clients and run{' '}
                    <KryptonCodeBlock label="client setup command" code={'npm run setup'} /> or{' '}
                    <KryptonCodeBlock label="linked client setup command" code={'krypton setup'} />
                    to configure detected Claude Desktop, Cursor, Claude Code and Cline storage.
                    Existing JSON receives a private atomic .bak backup; other servers remain intact
                    and conflicts fail per client. Restart configured clients and ensure node is
                    available on their PATH. Only the two Krypton MCP file tools gain native path
                    containment; built-in host tools are not intercepted.
                  </div>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    Executable symlinks used by version managers such as fnm, nvm and Homebrew
                    resolve to the same canonical target in Node and Rust. PID, start time and
                    parent remain strict. Resolution failures deny inspection. The daemon pins the
                    inspected target before later revalidation, so a changed live executable cannot
                    inherit registration. Reuse the original registered client identity for
                    isolation, cleanup and receipts, even if the alias disappears. Restart the
                    daemon after updating.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
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
                </details>

                <details className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <summary className="cursor-pointer font-semibold text-krypton-fg-primary">
                    Verify local supervision
                  </summary>
                  <div className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    Build the source daemon with
                    <KryptonCodeBlock
                      label="native release build command"
                      code={'cargo build --release --manifest-path src/core-native/Cargo.toml'}
                    />
                    . All release candidates precede debug candidates across CARGO_TARGET_DIR
                    (absolute or relative to the checkout), target/, and src/core-native/target/.
                    After{' '}
                    <KryptonCodeBlock label="local alias installation command" code={'npm link'} />,
                    run
                    <KryptonCodeBlock
                      label="working directory probe"
                      code={" krypton run -- node -e 'console.log(process.cwd())'".trim()}
                    />
                    . Expect the configured protected workspace path. A very short command may exit
                    before registration completes; that limitation appears on stderr.
                  </div>
                  <div className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    <KryptonCodeBlock
                      label="direct-read limitation probe"
                      code={`krypton run -- node -e 'require("fs").readFileSync("/etc/passwd")'`.trim()}
                    />{' '}
                    is a limitation probe, not a containment test. The read may succeed when OS
                    permissions allow it; arbitrary Node reads are not intercepted and portable
                    watcher events cannot reliably attribute the actor. No automatic quarantine or
                    receipt is promised for this command.
                  </div>
                  <div className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    Run{' '}
                    <KryptonCodeBlock
                      label="isolated containment verification command"
                      code={'npm run test:e2e'}
                    />{' '}
                    for disposable containment verification and expect [PASS] lines. The supervisor
                    captures the child PID and inspects its start time, executable and parent. Rust
                    validates that complete identity at registration and before isolation.
                    Successful native SIGKILL creates an authenticated in-memory receipt;
                    observational violations are separately recorded as unattributed JSONL events.
                    Desktop delivery is mocked in the test. Discovery accepts redundant dot segments
                    only for the exact expected absolute runtime files; relative paths, traversal,
                    redirects and socket symlinks remain rejected. Rust normalizes runtime paths
                    before publishing daemon.json.
                  </div>
                </details>

                <details className="mt-5 rounded-krypton-radius-card border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-4">
                  <summary className="cursor-pointer font-semibold text-krypton-fg-primary">
                    Platform notes
                  </summary>
                  <div className="mt-2 text-sm leading-6 text-krypton-fg-body">
                    macOS is the actively supported native runtime. Linux native mode is
                    experimental. Windows uses dashboard-only demonstration mode. Every platform can
                    explore simulated telemetry with{' '}
                    <KryptonCodeBlock
                      label="demo dashboard command"
                      code={'npm run dev:dashboard'}
                    />
                    . The planned Phase 3 Windows Tauri app remains a shell and simulation
                    experience until Phase 4 delivers native Named Pipe and Job Object containment.
                    On macOS, a confirmed native quarantine queues a redacted OS-level banner;
                    denied notification permission or a headless session suppresses only the banner,
                    not enforcement.
                  </div>
                </details>

                <footer className="mt-5 flex flex-col gap-krypton-space-3 border-t border-krypton-border-muted pt-krypton-space-5 sm:flex-row sm:items-center">
                  <KryptonButton asChild endIcon={<ExternalLink />} size="md" variant="primary">
                    <a href={REPOSITORY_URL} rel="noreferrer" target="_blank">
                      View Repository on GitHub
                    </a>
                  </KryptonButton>
                </footer>
                <KryptonCodeBlock label="native setup command" code={NATIVE_SETUP_COMMAND} />
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
                <p className="mt-2 text-sm leading-6 text-krypton-fg-body">
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
                      <p className="border-t border-krypton-border-muted px-krypton-space-4 py-krypton-space-3 text-sm leading-6 text-krypton-fg-body">
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
