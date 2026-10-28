//! The worked example in `policies/README.md` (FW-502): production
//! guardrails written as floodwall rules, checked against the Rego they
//! stand for, and the example's output checked against the walkthrough.
//!
//! The Rego is transcribed below rule for rule, as a second, independent
//! statement of the same policies. On every combination of the agents,
//! resources, actions, priorities and blast radii the policies tell apart,
//! the gate built from `policies/production.rules` must reach the Rego's
//! decision with exactly its messages: the reasons of the rejecting
//! policies are the Rego's `deny` set, and those of the deferring ones its
//! `defer` set.

use std::collections::{BTreeMap, BTreeSet};

use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
use floodwall::{Gate, Verdict};

#[allow(dead_code)] // its main
#[path = "../examples/production.rs"]
mod example;

const RULES: &str = include_str!("../policies/production.rules");
const WALKTHROUGH: &str = include_str!("../policies/README.md");

/// What the Rego's `deny` and `defer` rules produce for an input.
#[derive(Debug, Default, PartialEq, Eq)]
struct Messages {
    deny: BTreeSet<String>,
    defer: BTreeSet<String>,
}

/// The Rego's rules, one name each, for counting which ones hold.
const REGO_RULES: [&str; 9] = [
    "trusted-registry",
    "protect-state",
    "service-ownership (payments)",
    "service-ownership (search)",
    "scale-bounds (over 40)",
    "scale-bounds (zero)",
    "change-risk (global)",
    "change-risk (region)",
    "chaos-in-staging",
];

impl Messages {
    /// The Rego's `decision`: deny-overrides, defaulting to admit.
    fn decision(&self) -> &'static str {
        if !self.deny.is_empty() {
            "reject"
        } else if !self.defer.is_empty() {
            "defer"
        } else {
            "admit"
        }
    }
}

fn rank(priority: Priority) -> u8 {
    match priority {
        Priority::Bulk => 0,
        Priority::Normal => 1,
        Priority::Urgent => 2,
        Priority::Pager => 3,
    }
}

/// The input fields the Rego reads, named as in the exported intent.
fn name(priority: Priority) -> &'static str {
    ["bulk", "normal", "urgent", "pager"][rank(priority) as usize]
}

fn radius(blast: BlastRadius) -> &'static str {
    match blast {
        BlastRadius::Cell => "cell",
        BlastRadius::Service => "service",
        BlastRadius::Region => "region",
        BlastRadius::Global => "global",
    }
}

/// `package floodwall.production`, rule for rule. A field the action does
/// not have is `None`, and a Rego expression over it is undefined, so the
/// rule body fails, as an undefined `input.action.replicas > 40` does.
fn rego(input: &Intent) -> (Messages, BTreeSet<&'static str>) {
    let mut m = Messages::default();
    let mut held = BTreeSet::new();
    let agent = input.agent.as_str();
    let (kind, resource, manifest, replicas) = match &input.action {
        Action::Apply { resource, manifest } => ("apply", resource, Some(manifest.as_str()), None),
        Action::Scale { resource, replicas } => ("scale", resource, None, Some(*replicas)),
        Action::Destroy { resource } => ("destroy", resource, None, None),
    };
    let priority = input.priority;
    let blast = radius(input.blast_radius);

    // destructive if input.action.kind == "destroy"
    // destructive if { input.action.kind == "scale"; input.action.replicas == 0 }
    let destructive = kind == "destroy" || (kind == "scale" && replicas == Some(0));

    // trusted-registry
    if kind == "apply" {
        if let Some(manifest) = manifest {
            if !manifest.starts_with("registry.internal/") {
                m.deny.insert(format!(
                    "{agent} tried to deploy {manifest}, which is not from registry.internal"
                ));
                held.insert("trusted-registry");
            }
        }
    }

    // protect-state: stateful(r) if endswith(r, "-db"), or endswith(r, "-queue")
    let stateful = resource.ends_with("-db") || resource.ends_with("-queue");
    if destructive && stateful {
        m.deny.insert(format!(
            "{resource} holds state, so no agent may take it to zero"
        ));
        held.insert("protect-state");
    }

    // service-ownership, over the owners object
    let owners: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::from([
        (
            "payments",
            BTreeSet::from(["payments-deployer", "autoscaler"]),
        ),
        ("search", BTreeSet::from(["search-deployer", "autoscaler"])),
    ]);
    for (prefix, team) in &owners {
        if resource.starts_with(prefix) && !team.contains(agent) {
            m.deny.insert(format!("{agent} does not own {resource}"));
            held.insert(if *prefix == "payments" {
                "service-ownership (payments)"
            } else {
                "service-ownership (search)"
            });
        }
    }

    // scale-bounds
    if let Some(replicas) = replicas {
        if replicas > 40 {
            m.defer.insert(format!(
                "scaling {resource} to {replicas} replicas needs a human"
            ));
            held.insert("scale-bounds (over 40)");
        }
        if replicas == 0 {
            m.defer
                .insert(format!("scaling {resource} to zero needs a human"));
            held.insert("scale-bounds (zero)");
        }
    }

    // change-risk
    if blast == "global" && rank(priority) < rank(Priority::Pager) {
        m.deny.insert(format!(
            "a global {kind} needs priority pager, not {}",
            name(priority)
        ));
        held.insert("change-risk (global)");
    }
    if blast == "region" && rank(priority) < rank(Priority::Urgent) {
        m.defer.insert(format!(
            "a region-wide change at priority {} waits for a human",
            name(priority)
        ));
        held.insert("change-risk (region)");
    }

    // chaos-in-staging
    if agent.starts_with("chaos-") && !resource.starts_with("staging-") {
        m.deny
            .insert(format!("{agent} may only touch staging, not {resource}"));
        held.insert("chaos-in-staging");
    }
    (m, held)
}

/// What the gate's policies said about an intent, in the Rego's terms.
fn gate_messages(gate: &Gate, intent: &Intent) -> (&'static str, Messages) {
    let decision = gate.evaluate(intent);
    let mut m = Messages::default();
    for (_, verdict) in &decision.breakdown {
        match verdict {
            Verdict::Reject(why) => m.deny.insert(why.clone()),
            Verdict::Defer(why) => m.defer.insert(why.clone()),
            Verdict::Admit => false,
        };
    }
    (decision.verdict.label(), m)
}

const AGENTS: [&str; 8] = [
    "payments-deployer",
    "search-deployer",
    "autoscaler",
    "web-deployer",
    "chaos-monkey",
    "chaos-",
    "chaosmonkey",
    "cdn-bot",
];

const RESOURCES: [&str; 16] = [
    "payments",
    "payments-api",
    "xpayments",
    "search",
    "xsearch",
    "search-db",
    "orders-db",
    "mongodb",
    "events-queue",
    "queue",
    "web",
    "staging-web",
    "stagingweb",
    "staging-db",
    "staging-",
    "cdn",
];

const MANIFESTS: [&str; 5] = [
    "registry.internal/web:v42",
    "registry.internal/",
    "docker.io/library/web:latest",
    "registry.internal.evil/web:v1",
    "",
];

const REPLICAS: [u32; 6] = [0, 1, 2, 40, 41, 1000];

const PRIORITIES: [Priority; 4] = [
    Priority::Bulk,
    Priority::Normal,
    Priority::Urgent,
    Priority::Pager,
];

const BLASTS: [BlastRadius; 4] = [
    BlastRadius::Cell,
    BlastRadius::Service,
    BlastRadius::Region,
    BlastRadius::Global,
];

/// Every combination the policies tell apart, and the values either side
/// of each boundary: 8 agents, 16 resources, 12 actions, 4 priorities and
/// 4 blast radii.
fn every_intent() -> Vec<Intent> {
    let mut all = Vec::new();
    for agent in AGENTS {
        for resource in RESOURCES {
            let mut actions: Vec<Action> = MANIFESTS
                .iter()
                .map(|m| Action::Apply {
                    resource: resource.into(),
                    manifest: (*m).into(),
                })
                .collect();
            actions.extend(REPLICAS.iter().map(|&replicas| Action::Scale {
                resource: resource.into(),
                replicas,
            }));
            actions.push(Action::Destroy {
                resource: resource.into(),
            });
            for action in actions {
                for priority in PRIORITIES {
                    for blast in BLASTS {
                        let id = all.len() as u64;
                        all.push(Intent::new(
                            id,
                            AgentId::new(agent),
                            action.clone(),
                            priority,
                            blast,
                        ));
                    }
                }
            }
        }
    }
    all
}

#[test]
fn the_rules_decide_as_the_rego_does_on_every_combination() {
    let gate = Gate::new().with_rules(RULES).unwrap();
    let intents = every_intent();
    assert_eq!(intents.len(), 8 * 16 * 12 * 4 * 4);
    let mut decisions: BTreeMap<&str, usize> = BTreeMap::new();
    let mut holds: BTreeMap<&str, usize> = BTreeMap::new();
    for intent in &intents {
        let (want, held) = rego(intent);
        let (decision, got) = gate_messages(&gate, intent);
        assert_eq!(got, want, "messages for {intent:?}");
        assert_eq!(decision, want.decision(), "decision for {intent:?}");
        *decisions.entry(decision).or_default() += 1;
        for rule in held {
            *holds.entry(rule).or_default() += 1;
        }
    }
    // All three decisions are reached, many times over.
    assert_eq!(decisions.len(), 3, "{decisions:?}");
    assert!(decisions.values().all(|&n| n > 1000), "{decisions:?}");
    // Every Rego rule, and so the floodwall rule it matches, holds for some
    // intents and not for others.
    for rule in REGO_RULES {
        let n = holds.get(rule).copied().unwrap_or(0);
        assert!(n > 0 && n < intents.len(), "{rule} holds for {n} intents");
    }
    assert_eq!(holds.len(), REGO_RULES.len(), "{holds:?}");
}

#[test]
fn the_file_holds_the_six_policies_the_walkthrough_describes() {
    let policies = floodwall::rules::parse(RULES).unwrap();
    let names: Vec<&str> = policies.iter().map(floodwall::Policy::name).collect();
    assert_eq!(
        names,
        [
            "trusted-registry",
            "protect-state",
            "service-ownership",
            "scale-bounds",
            "change-risk",
            "chaos-in-staging"
        ]
    );
    let rules: Vec<usize> = policies.iter().map(|p| p.len()).collect();
    assert_eq!(rules, [1, 1, 2, 2, 2, 1]);
    assert_eq!(rules.iter().sum::<usize>(), REGO_RULES.len());
    // Each policy admits some intents: none of them blocks everything.
    let gate = Gate::new().with_rules(RULES).unwrap();
    let mut admitted = [0usize; 6];
    for intent in every_intent() {
        for (i, (_, verdict)) in gate.evaluate(&intent).breakdown.iter().enumerate() {
            if verdict.is_admit() {
                admitted[i] += 1;
            }
        }
    }
    assert!(admitted.iter().all(|&n| n > 0), "{admitted:?}");
}

/// The lines of the walkthrough's example run, after its command line.
fn documented_output() -> String {
    let text = WALKTHROUGH.replace("\r\n", "\n");
    let start = text
        .find("$ cargo run --example production\n")
        .expect("the walkthrough shows the example's run");
    let after = &text[start..];
    let body = &after[after.find('\n').unwrap() + 1..];
    let end = body.find("```").expect("the run's block ends");
    body[..end].trim_start_matches('\n').to_string()
}

#[test]
fn the_walkthrough_shows_what_the_example_prints() {
    assert_eq!(documented_output(), example::run());
}

#[test]
fn the_example_policies_are_the_walkthroughs() {
    // The walkthrough quotes each policy from the file as it is.
    let text = WALKTHROUGH.replace("\r\n", "\n");
    let rules = RULES.replace("\r\n", "\n");
    for block in rules.split("\npolicy ").skip(1) {
        let policy = format!("policy {}", &block[..block.find("\n}\n").unwrap() + 2]);
        assert!(
            text.contains(&policy),
            "the walkthrough does not quote:\n{policy}"
        );
    }
}
