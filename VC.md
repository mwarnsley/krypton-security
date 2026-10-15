# Krypton Strategic Defenses Playbook

## PART 1: THE COMMERCIAL TRACK (Generalist VCs & Managing Partners)

**Focus:** Business impact, market friction, and human behavioral bottlenecks.

### The market problem: the Shadow AI epidemic

AI agents are entering companies through the path of least resistance. A
developer installs a coding agent to ship faster. A support team connects an
assistant to customer tickets. An operations team gives a local model access to
invoices, spreadsheets, and internal tools. Each adoption decision can be
rational in isolation, yet the aggregate result is a fleet of autonomous
runtimes that security teams did not provision, inventory, or constrain.

That is the Shadow AI epidemic: valuable software spreads faster than the
enterprise controls required to govern it. The underlying behavior is unlikely
to disappear because the productivity advantage is real. Developers are
rewarded for velocity, while security teams are accountable for access,
containment, and auditability. A blanket ban forces those incentives into
conflict. It either slows delivery or pushes adoption underground, where the
company has even less visibility.

Indirect prompt injection turns this organizational gap into a security gap.
An agent can ingest an ordinary customer email, support ticket, issue comment,
invoice, or open-source file containing hostile instructions. The employee does
not need to click a malicious link or knowingly run malware. The approved
workflow itself delivers the payload to an agent that can act with local
authority.

Krypton's commercial proposition is not “use less AI.” It is “keep the velocity
while containing the blast radius.” Krypton provides deterministic local policy
and protected-launcher seams around integrated agent activity so companies can
delegate a narrower workspace and process boundary. Portable watcher telemetry
does not independently enforce that boundary.

### Commercial counter-arguments

#### Objection: “Why not just pass an HR policy?”

**Defense:** Policy can define acceptable behavior, but it cannot enforce a
filesystem boundary. It does not stop an approved agent from accidentally
reading a poisoned ticket, nor does it stop an unsanctioned agent already
running on an employee's machine. Training and policy remain useful governance
tools; they are not runtime controls. Applications that explicitly consult
Krypton's policy before acting can convert a written least-privilege expectation
into a local decision without asking employees to give up the tools that make
them faster.

#### Objection: “Why not just look at the logs tomorrow morning?”

**Defense:** Tomorrow morning is after the first unauthorized read, file
modification, credential access, or data transfer. Retrospective logs can help
explain an incident, but they cannot reverse it. Some harmful actions are
entirely local, and outbound activity can resemble ordinary approved HTTPS
traffic. An integrated caller can ask Krypton's policy layer before acting, and
the protected launcher can isolate an exact registered child identity. Portable
filesystem watching remains post-event evidence and does not provide universal
pre-access denial.

---

### Q: What stops the major foundational model labs (OpenAI, Google, Anthropic) from building this platform containment layer directly into their models and rendering Krypton obsolete?

**A: The Neutral Third-Party Advantage & The Conflict of Interest Buffer**

1. **Independent Referee Position:** Enterprise customers, corporate CISOs, and
   defense contractors do not want to trust a foundational model provider to
   grade their own homework. Krypton functions as an objective, model-agnostic
   firewall. We sit completely outside the model ecosystem, providing a
   decentralized, third-party audit trail that remains consistent whether the
   enterprise is running GPT-5, Gemini, or a local open-source Llama instance.
2. **The Liability Buffer:** Providing built-in, low-level system execution
   containment exposes massive model providers to severe structural liability
   if an autonomous agent manages a breakout and destroys an enterprise
   production database. Model labs intentionally prefer to offload the
   high-risk runtime isolation plumbing to specialized middleware layers like
   Krypton, allowing them to focus engineering velocity on core cognitive
   intelligence rather than system-level sandboxing.
3. **Enterprise Agility & Deployment Friction:** Corporate compliance reviews,
   legal check-offs, and product roadmap alignments slow down big tech
   deployment schedules significantly. Krypton captures the developer ecosystem
   directly at the runtime package layer (`npm`, and eventually compiled Go/Rust
   daemons), establishing an open-source security benchmark and integrating
   seamlessly into enterprise build pipelines before legacy providers can clear
   internal corporate committees.

### Commercial outcome

Krypton reduces the false choice between developer velocity and corporate
restriction. Security gains a concrete containment layer; technical teams keep
their local AI workflows; and leadership gains an auditable control that acts
before a preventable agent mistake becomes downtime, disclosure, or regulatory
exposure.

## PART 2: THE SYSTEMS TRACK (Technical VCs, Deep-Tech Partners, & CISOs)

**Focus:** Under-the-hood architecture, algorithmic constraints, and low-level
security implications.

### 1. The Obfuscation Loophole

**Question:** How do we stop injections if the attacker uses novel phrasing,
another language, Unicode tricks, invisible text, or an encoding the model has
never seen?

**Answer:** Krypton does not make content classification the security boundary.
Trying to enumerate every toxic phrase creates a probabilistic filter that can
always be challenged by a new representation. Instead, Krypton evaluates the
deterministic system action at the operating-system execution boundary. The
prompt may be novel; the resulting request is still concrete: open this path,
launch this process, or leave this sandbox.

The enforcement decision therefore ignores the probabilistic text string and
asks whether the resolved operation is inside the authority assigned to the
agent. Explicit policy calls can deny an unsafe path, while the protected
launcher can isolate an exact registered child generation. Portable watcher
events provide post-event evidence only and do not identify or quarantine an
actor by themselves.

Pre-action denial applies only when an application explicitly asks Krypton's
policy layer before performing an action. The portable filesystem watcher cannot
block arbitrary operating-system access before it occurs; OS-specific permission
and endpoint-security adapters remain future work.

### 2. The Performance Bottleneck

**Question:** How does a Node.js runtime monitor heavy agent activity without
placing noticeable latency in the execution path?

**Answer:** The hot policy tables use native primitive `Set` and `Map`
membership, which provides average-case O(1) lookup for blocked targets and
tracked process identities.
The design avoids nested scans, structural matrices, synchronous network calls,
and model inference inside the enforcement loop. Security events flow through
asynchronous, non-blocking telemetry streams so disk logging does not stall the
main event loop.

The precise complexity claim matters: a blocked-target lookup is O(1) on
average, while path normalization and inspection remain O(L) in the length of
the path. Operating systems bound path length, and Krypton keeps the work per
segment constant. This produces a small, deterministic local cost instead of
the variable latency of a remote classifier or a second model call.

### 3. The Software's Attack Surface

**Question:** What stops an attacker from turning Krypton into a Denial of
Service primitive that kills vital workstation processes?

**Answer:** The production boundary follows strict least privilege at two
layers. At the application layer, the protected launcher registers only child
processes it explicitly spawns and the daemon stores PID, start time,
executable, and parent identity in a native `HashMap`. A quarantine request must
match that exact live generation; unknown, stale, zero, mismatched, or otherwise
unowned identities fail closed and are never signaled.

At the operating-system layer, the daemon currently runs as the invoking user.
Dedicated service identities and stronger process sandboxing remain roadmap
work. The compound registry restricts application behavior, but a same-user or
root attacker can still bypass local controls.

Together, these controls constrain native `SIGKILL` use to Krypton's explicitly
owned agent children and prevent cross-process escalation. The kill mechanism
remains decisive inside the sandbox while being unavailable as a general
machine-wide termination primitive.

### Systems position

Krypton is intentionally local, deterministic, and enforcement-oriented. It
does not need to understand every injection payload, and it does not wait for
network evidence after execution. Its defensible layer is the narrow boundary
between untrusted agent context and privileged system action: constant-cost
policy lookups, bounded path evaluation, non-blocking evidence capture, and
least-privilege process ownership.

## PART 3: INVESTMENT DILIGENCE (Platform Risk & Category Leadership)

### Q: Which engineering blindspot does Krypton address that application security reviews routinely miss?

**A:** Most reviews inspect the model prompt, the application code, or the
network perimeter as separate systems. The dangerous gap is the authority
transfer between them: untrusted context becomes a concrete local filesystem or
process action under a developer's identity. A workflow can pass code review,
use an approved model, and call an approved tool while still allowing a poisoned
document to steer that tool outside its intended workspace.

Krypton makes that transfer point explicit in integrations that call its policy
or protected-launcher seam. It resolves paths, validates exact registered
process generations, and records enforcement results. Portable filesystem
notifications are post-event telemetry and are never described as pre-access
denial or reliable process attribution.

### Q: How does Krypton de-risk execution vectors without becoming another high-latency policy service?

**A:** The enforcement path is deliberately local and deterministic. Canonical
path evaluation is bounded by path length, blocked-target and PID ownership
checks use constant-time average hash-map membership, and telemetry persistence
is decoupled through bounded asynchronous queues. There is no remote model call,
cloud round trip, or open-ended signature scan inside the decision loop.

For explicitly integrated actions, this architecture gives buyers a measurable
failure boundary: an operation is inside the delegated workspace and process
authority, or it is denied. When required policy state is unavailable or
canonicalization is indeterminate, that integration fails closed. Krypton
therefore reduces both security risk and operational variance without treating
post-event watcher telemetry as universal enforcement; its control-plane latency
is governed by local system work rather than an external service's availability
or inference tail latency.

### Q: How is the native local-control channel authenticated and bounded?

**A:** Each workspace receives a private Unix-domain socket, endpoint record,
and per-daemon capability. Requests use bounded, versioned JSON Lines with a
request ID and narrow command union. The daemon checks the peer user where the
platform exposes credentials, validates the capability in constant time, and
re-reads the full PID/start-time/executable/parent identity before isolation.
Four workers consume a bounded connection queue, and every read/write has a
timeout and size limit.

### Q: How is Krypton strategically differentiated from reactive, signature-based enterprise security products?

**A:** Signature products are valuable when an artifact or behavior has already
been classified, distributed, and observed. Indirect prompt injection weakens
that model because the attacker can continuously vary language, encoding,
document format, and delivery channel while still inducing the same forbidden
system action. Krypton controls the invariant outcome: whether the agent may
cross its workspace or process boundary.

That makes Krypton complementary to EDR, SIEM, DLP, and model-layer guardrails,
but earlier in the causal chain. Those systems can enrich detection and
investigation; Krypton's explicit policy and protected-launcher seams can deny
an unauthorized local action without a content signature. The platform
opportunity is a model-agnostic runtime
policy and evidence layer that enterprises can apply consistently across hosted
models, local models, coding agents, and future autonomous tooling.

### Q: How does the architecture support proactive platform-risk management as the company scales?

**A:** Krypton separates policy evaluation, process ownership, enforcement,
telemetry, and operator visibility into testable seams. That separation enables
platform teams to strengthen one control without rewriting the entire runtime:
replace the flat-file ledger with an integrity-protected database, isolate the
native daemon under a dedicated OS identity, add signed policy bundles, or bind
IPC authorization to operating-system credentials.

The product roadmap therefore compounds around control depth rather than alert
volume. Each deployment can start with a narrow workspace boundary and expand
into granular per-agent rules, durable evidence, fleet policy distribution, and
centralized security operations integration. This is proactive risk management:
define delegated authority before adoption accelerates, enforce it locally, and
retain evidence that leadership can audit.

## PART 4: THE COMMERCIAL ENGINE & EXIT ARCHITECTURE

### The "Land-and-Expand" Open-Core Funnel

The shipped v1.0.2 Community release gives solo engineers a free local entry
point: install the standalone `.mcpb` in Claude Desktop and evaluate Krypton's
contained file tools. Cursor users enter through the existing MCP source setup
integration; native `.mcpb` installation in Cursor is not assumed. The native
watchdog, local JSONL ledger, and separately run Next.js viewer make local
containment and evidence accessible without a subscription.

The commercial hypothesis is bottom-up adoption: engineers demonstrate useful
local protection, teams accumulate independent deployments, and internal SecOps
and CISOs seek fleet-wide visibility and policy governance. The planned Fleet
tier turns that demand into organizational contracts without withholding local
protection. Free installations do not automatically upload workstation telemetry;
fleet enrollment and external evidence forwarding require explicit configuration.

### Subscription Packaging & Unit Economics

Paid tiers are proposed packaging, not capabilities shipped in v1.0.2.

| Package                           | Target price                                                  | Buyer and value                                                                                                                                                                                                                                   |
| :-------------------------------- | :------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Developer Pro**                 | $29/user/month                                                | Solo developers, freelancers, and small boutique agencies needing multi-agent local profiles and tracking, APFS rollback safety, desktop/webhook notifications (Slack/Discord), and cloud-synced dynamic threat feeds.                            |
| **Enterprise Governance / Fleet** | $49–$99/seat/month; annual contracts with a $15,000 ARR floor | Engineering organizations needing centralized policy distribution, a fleet console, locally authorized remote kill-switch orchestration, OpenTelemetry streaming and SIEM forwarding (Splunk/Datadog), and tamper-evident audit evidence exports. |

The Pro launch target sits within the roadmap's $19–$29 monthly pricing range.
Annual Enterprise contract value is the greater of $15,000 or contracted seats
multiplied by the monthly seat price and 12. Pro generates $348 annualized
revenue per continuously subscribed user before churn, discounts, and costs.
Neither price nor contract value establishes profitability: validate acquisition
cost, retention, support effort, cloud ingestion/storage costs, gross margin,
and acquisition-cost payback with paying cohorts. Local execution limits the
need for cloud compute in containment, while Fleet evidence retention and support
remain costs to measure and control.

The individual local workstation containment boundary is never gated, degraded,
or delayed by licensing state. Feeds and policy distribution operate outside the
local enforcement loop. Remote orchestration must preserve local authorization,
registered ownership, and live compound-identity checks. Compliance evidence
supports customer audits; it does not itself confer SOC 2 certification or EU AI
Act compliance.

### Financial Milestones & Strategic Exit Multiple (Acquire.com & Private Equity)

The operating target is $15k–$25k MRR, equivalent to $180k–$300k ARR. Potential
exit channels include Acquire.com, strategic developer-security or AI
infrastructure acquirers, and private-equity buyers seeking a durable recurring
revenue business.

A **5×–8× ARR multiple is an aspirational strategic-exit assumption**, not an
established historical Acquire.com benchmark or a guaranteed offer.
[Acquire.com's January 2026 report](https://blog.acquire.com/acquire-com-biannual-acquisition-multiples-report-jan-2026/)
distinguishes revenue-based valuations for high-growth businesses from the
profit-based multiples typically used for profitable SaaS acquisitions. Buyer
fit, growth, retention, earnings, and diligence must support any premium.

Applying the assumed range to the full ARR target produces $900k–$2.4M in
illustrative gross valuation. The desired **$1.2M–$2.4M liquidity valuation** is a
strategic target within that range, not its mathematical minimum: $240k ARR at
5× implies $1.2M, while $300k ARR at 8× implies $2.4M. Gross purchase value is
not net cash proceeds; taxes, transaction costs, earn-outs, and retained equity
can change realized liquidity.

**Capital allocation:** Distributable free cash flow or capital realized from a
commercial exit is earmarked for physical cash-flowing assets, particularly
real estate, after operating reserves, taxes, and contractual obligations. This
is the intended allocation of realized capital, not an assumption that an exit
or investment return is assured.
