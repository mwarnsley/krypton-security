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
while containing the blast radius.” Krypton places a deterministic local
execution boundary around agent activity so companies can permit useful local
automation without granting every agent implicit access to the rest of the
workstation.

### Commercial counter-arguments

#### Objection: “Why not just pass an HR policy?”

**Defense:** Policy can define acceptable behavior, but it cannot enforce a
filesystem boundary. It does not stop an approved agent from accidentally
reading a poisoned ticket, nor does it stop an unsanctioned agent already
running on an employee's machine. Training and policy remain useful governance
tools; they are not runtime controls. Krypton converts a written least-privilege
expectation into an enforceable local boundary without asking employees to give
up the tools that make them faster.

#### Objection: “Why not just look at the logs tomorrow morning?”

**Defense:** Tomorrow morning is after the first unauthorized read, file
modification, credential access, or data transfer. Retrospective logs can help
explain an incident, but they cannot reverse it. Some harmful actions are
entirely local, and outbound activity can resemble ordinary approved HTTPS
traffic. Krypton moves the control from post-incident investigation to the
moment of execution: deny the boundary crossing, terminate the rogue child
process, and then preserve a local event for the existing security workflow.

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

This architecture gives buyers a measurable failure boundary: an operation is
inside the delegated workspace and process authority, or it is denied. When
state is unavailable or canonicalization is indeterminate, enforcement fails
closed. Krypton therefore reduces both security risk and operational variance;
its control-plane latency is governed by local system work rather than an
external service's availability or inference tail latency.

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
