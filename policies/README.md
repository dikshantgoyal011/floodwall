# Policies as data: a worked example

floodwall's gate can load its policies from a rules file instead of Rust (see [`src/rules.rs`](../src/rules.rs) for the format). This walkthrough takes a set of production guardrails of the kind platform teams write in [OPA/Rego](https://www.openpolicyagent.org/docs/latest/policy-language/), writes each one as floodwall rules next to its Rego, and runs them at the gate.

| File | What it is |
|------|------------|
| [`production.rules`](production.rules) | The guardrails in this walkthrough, released as the policy bundle `production`, revision `2026.10.28-1`. |
| [`standard.rules`](standard.rules) | The crate's built-in policies (`NoGlobalDestroy`, `BlastNeedsPriority`, `ResourceAllowlist`), written as rules. |

Rules are data, so a plane reads them when it starts, from wherever they are released:

```rust
use floodwall::Gate;

fn gate() -> Result<Gate, Box<dyn std::error::Error>> {
    let rules = std::fs::read_to_string("policies/production.rules")?;
    // A mistake in the file is a ParseError naming its line and column.
    Ok(Gate::new().with_rules(&rules)?)
}
```

## The input

OPA evaluates a policy against an `input` document. At floodwall's gate, the input is the intent an agent submitted, in the shape the ledger exports it ([`src/export.rs`](../src/export.rs)):

```json
{"id":"2","agent":"web-deployer",
 "action":{"kind":"apply","resource":"api","manifest":"docker.io/library/api:latest"},
 "priority":"normal","blast_radius":"service","signature":null}
```

A rule tests the same fields by name:

| Rego | floodwall rules |
|------|-----------------|
| `input.agent` | `agent` |
| `input.action.kind` | `kind`: `apply`, `scale` or `destroy` |
| `input.action.resource` | `resource` |
| `input.action.manifest` | `manifest`, for an `apply` |
| `input.action.replicas` | `replicas`, for a `scale` |
| `input.priority` | `priority`: `bulk` < `normal` < `urgent` < `pager` |
| `input.blast_radius` | `blast_radius`: `cell` < `service` < `region` < `global` |

The Rego below is one module, `package floodwall.production`, in OPA 1.0 syntax. It starts with what the rules language has built in: an order for priorities, what counts as destructive, and how the policies' findings combine.

```rego
package floodwall.production

rank := {"bulk": 0, "normal": 1, "urgent": 2, "pager": 3}

destructive if input.action.kind == "destroy"

destructive if {
	input.action.kind == "scale"
	input.action.replicas == 0
}

# Deny-overrides: one deny rejects the change, whatever else holds.
default decision := "admit"

decision := "reject" if count(deny) > 0

decision := "defer" if {
	count(deny) == 0
	count(defer) > 0
}
```

`deny` holds the messages of rules that block a change outright. `defer` holds those of rules that send it to a human, which is floodwall's hold queue: a deferred change waits there until someone releases it (its deferrals are then waived) or expires it.

## The guardrails

### Trusted registry

Deploy only images that CI built and pushed to the internal registry: the classic admission-control policy.

```rego
deny contains msg if {
	input.action.kind == "apply"
	not startswith(input.action.manifest, "registry.internal/")
	msg := sprintf("%s tried to deploy %s, which is not from registry.internal", [input.agent, input.action.manifest])
}
```

```text
policy "trusted-registry" {
  reject "{agent} tried to deploy {manifest}, which is not from registry.internal"
    when kind == apply and not manifest matches "registry.internal/*"
}
```

`matches` tests the whole string against a pattern in which `*` stands for any run of characters, so `"registry.internal/*"` is Rego's `startswith`, and `"*-db"` its `endswith`.

### Protect state

No agent tears down a database or a queue, or scales one to zero.

```rego
stateful(resource) if endswith(resource, "-db")

stateful(resource) if endswith(resource, "-queue")

deny contains msg if {
	destructive
	stateful(input.action.resource)
	msg := sprintf("%s holds state, so no agent may take it to zero", [input.action.resource])
}
```

```text
policy "protect-state" {
  reject "{resource} holds state, so no agent may take it to zero"
    when destructive and (resource matches "*-db" or resource matches "*-queue")
}
```

### Service ownership

A team's services change only through its own deployer, or the shared autoscaler. In Rego the owners are data; a rules file has nothing but the intent to go on, so the owners are written into the rules, one per team.

```rego
owners := {
	"payments": {"payments-deployer", "autoscaler"},
	"search": {"search-deployer", "autoscaler"},
}

deny contains msg if {
	some prefix, team in owners
	startswith(input.action.resource, prefix)
	not input.agent in team
	msg := sprintf("%s does not own %s", [input.agent, input.action.resource])
}
```

```text
policy "service-ownership" {
  reject "{agent} does not own {resource}"
    when resource matches "payments*" and agent not in ["payments-deployer", "autoscaler"]
  reject "{agent} does not own {resource}"
    when resource matches "search*" and agent not in ["search-deployer", "autoscaler"]
}
```

### Scale bounds

Scaling past the usual bounds waits for a human.

```rego
defer contains msg if {
	input.action.replicas > 40
	msg := sprintf("scaling %s to %d replicas needs a human", [input.action.resource, input.action.replicas])
}

defer contains msg if {
	input.action.replicas == 0
	msg := sprintf("scaling %s to zero needs a human", [input.action.resource])
}
```

```text
policy "scale-bounds" {
  defer "scaling {resource} to {replicas} replicas needs a human"
    when replicas > 40
  defer "scaling {resource} to zero needs a human"
    when replicas == 0
}
```

Neither needs `kind == scale`. Only a scale has replicas: in Rego, `input.action.replicas` is undefined for anything else, so the rule's body fails; in floodwall, a test of a field the intent does not have is false.

### Change risk

The wider a change can break things, the more urgency it needs.

```rego
deny contains msg if {
	input.blast_radius == "global"
	rank[input.priority] < rank.pager
	msg := sprintf("a global %s needs priority pager, not %s", [input.action.kind, input.priority])
}

defer contains msg if {
	input.blast_radius == "region"
	rank[input.priority] < rank.urgent
	msg := sprintf("a region-wide change at priority %s waits for a human", [input.priority])
}
```

```text
policy "change-risk" {
  reject "a global {kind} needs priority pager, not {priority}"
    when blast_radius == global and priority < pager
  defer "a region-wide change at priority {priority} waits for a human"
    when blast_radius == region and priority < urgent
}
```

### Chaos in staging

Chaos agents stay in staging.

```rego
deny contains msg if {
	startswith(input.agent, "chaos-")
	not startswith(input.action.resource, "staging-")
	msg := sprintf("%s may only touch staging, not %s", [input.agent, input.action.resource])
}
```

```text
policy "chaos-in-staging" {
  reject "{agent} may only touch staging, not {resource}"
    when agent matches "chaos-*" and not resource matches "staging-*"
}
```

## What carries over, and what does not

| OPA/Rego | floodwall rules |
|----------|-----------------|
| `deny contains msg if { ... }` | `reject "msg" when ...` |
| a `defer` set, for changes that need a human | `defer "msg" when ...`: the change is held for a human |
| `sprintf("%s ...", [input.agent])` | `"{agent} ..."`; `{action}` is the action's summary, `scale web to 5` |
| `startswith(s, "x")`, `endswith(s, "x")` | `s matches "x*"`, `s matches "*x"` |
| `x in {...}`, `not x in {...}` | `x in [...]`, `x not in [...]` |
| a rule over an undefined field fails | a test of a field the intent does not have is false |
| `data`, such as the owners | written into the rules: a rule sees only the intent |
| `decision`, with a `default` | the gate's deny-overrides, policy by policy |
| `deny` is a set of every message | each policy gives one verdict, with the reason of its first rule that holds. The ledger records every policy's verdict, and the decision's reason is the first rejecting policy's, in file order. |
| `time.now_ns()`, `http.send` | nothing like them: a rule depends only on the intent, so a gate decides the same way every time and a plane can be [replayed from its ledger](../src/replay.rs). Change the rules file to change the rules, or write a [`Policy`](../src/policy.rs) in Rust for anything that needs the outside world. |
| a bundle's `.manifest` `revision`, in each decision log entry | `bundle "production" revision "..."` after the format line: every decision records the bundle's name, its revision and the file's SHA-256 in the ledger |

## A versioned bundle

OPA ships policies as bundles. Each has a revision in its manifest, and every decision log entry says which revision decided it. `production.rules` does the same with its second line:

```text
format 1
bundle "production" revision "2026.10.28-1"
```

Every decision made with this file records the bundle in the ledger, next to the verdict:

- its name;
- its revision;
- the SHA-256 of the file.

The record's digest covers all three, so which rules decided a change can be no more rewritten than the decision itself. The export carries them, and `tools/verify-ledger.mjs` lists each bundle a ledger names, with its digest and how many records name it.

An auditor holding the file can check it is the one that decided: `sha256sum policies/production.rules` prints the same digest the ledger shows. The digest also tells apart two files that claim the same revision but differ, by as little as a comment.

To change the rules, release the file under a new revision. A plane can restart on it as long as the new revision rules on the ledger's history the same way (see [`src/replay.rs`](../src/replay.rs), "Policy bundles"). The earlier decisions keep the revision that made them, and the first decision under the new one marks the change in the ledger.

## Running it

[`examples/production.rs`](../examples/production.rs) builds a plane whose gate is `production.rules`, submits a morning's changes from a fleet of agents, rules on them, and lets a human work the hold queue:

```text
$ cargo run --example production
production guardrails: 6 policies, 9 rules, from policies/production.rules
bundle production 2026.10.28-1, sha256 e3c40d209bda389299dacffed289567069e42e57e50ac75d69db9e3030991e63

tick 0: 11 intents submitted, 11 ruled on
  reject  cdn-bot#1            destroy cdn
          change-risk: a global destroy needs priority pager, not urgent
  admit   web-deployer#1       apply web
  reject  web-deployer#2       apply api
          trusted-registry: web-deployer tried to deploy docker.io/library/api:latest, which is not from registry.internal
  reject  cleanup-bot#1        destroy sessions-db
          protect-state: sessions-db holds state, so no agent may take it to zero
  reject  web-deployer#3       scale payments-api to 4
          service-ownership: web-deployer does not own payments-api
  admit   payments-deployer#1  apply payments-web
  defer   autoscaler#1         scale search to 60
          scale-bounds: scaling search to 60 replicas needs a human
  defer   autoscaler#2         scale thumbnails to 0
          scale-bounds: scaling thumbnails to zero needs a human
  defer   web-deployer#4       apply web-edge
          change-risk: a region-wide change at priority normal waits for a human
  reject  chaos-monkey#1       destroy orders-db
          protect-state: orders-db holds state, so no agent may take it to zero
          chaos-in-staging: chaos-monkey may only touch staging, not orders-db
  admit   chaos-monkey#2       destroy staging-web

held for a human: 3
  autoscaler#1         scaling search to 60 replicas needs a human
  autoscaler#2         scaling thumbnails to zero needs a human
  web-deployer#4       a region-wide change at priority normal waits for a human

alice releases autoscaler#1 and web-deployer#4; bob expires autoscaler#2

tick 2: 2 ruled on, their deferrals waived
  admit   autoscaler#1         scale search to 60  (released by alice)
          scale-bounds: waived: scaling search to 60 replicas needs a human
  admit   web-deployer#4       apply web-edge  (released by alice)
          change-risk: waived: a region-wide change at priority normal waits for a human

ledger: 32 records, chain valid: true
  queued 11, reject 5, admit 5, defer 3, succeeded 5, released 2, expired 1
  13 decisions record bundle production 2026.10.28-1
```

Under each decision are the policies that did not admit it, with their reasons.

- **`cdn-bot#1` is ruled on first.** It is the only `urgent` change, and the queue serves higher priorities first. A global change runs alone, and nothing is in flight yet, so it is ruled on at once: rejected, since a global change needs `pager`.
- **`chaos-monkey#1` is rejected by two policies.** Both reasons are in the ledger. The decision's reason is the first one, `protect-state`'s.
- **The three deferred changes are held, not dropped.** alice releases two, which go ahead at the next tick with their deferrals waived. A rejection would still have applied. bob expires the third.
- **Everything is on the record.** Every arrival (`queued`), decision, release, expiry and outcome is in the ledger, with each policy's verdict.
- **Each decision says which rules made it.** All 13 decisions, the two released ones included, record the bundle `production 2026.10.28-1` and the file's digest. The arrivals, release, expiry and outcomes record none, since the gate did not decide them.

## How it is checked

[`tests/production_policies.rs`](../tests/production_policies.rs) transcribes the Rego above, rule for rule, into plain Rust: a second statement of the same policies that shares nothing with the rules file. It then checks the two on 24,576 intents, every combination of:

- 8 agents
- 16 resources
- 12 actions: an apply of five images, a scale to six replica counts, and a destroy
- 4 priorities
- 4 blast radii

The values sit either side of every boundary, such as `registry.internal/` against `registry.internal.evil/`, `orders-db` against `mongodb`, 40 replicas against 41, and `chaos-monkey` against `chaosmonkey`. On every one, the gate's decision must be the Rego's, and its policies' reasons exactly the Rego's `deny` and `defer` messages. Every rule must hold for some of the intents and not for others.

The test also checks two things against this walkthrough: the policies quoted here are the file's, and the output above is what the example prints.
