//! The worked example in `policies/README.md`: production guardrails written
//! as floodwall rules, the way a platform team writes them in OPA/Rego,
//! ruling on a morning's changes from a fleet of agents.
//!
//! ```text
//! cargo run --example production
//! ```

use std::fmt::Write;

use floodwall::intent::{Action, AgentId, BlastRadius, Intent, IntentKey, Priority};
use floodwall::{Admission, Decision, Floodwall, Gate, Outcome, RateLimit, Verdict};

/// The guardrails, read at build time so the example runs from anywhere.
pub const RULES: &str = include_str!("../policies/production.rules");

fn main() {
    print!("{}", run());
}

fn intent(
    agent: &str,
    id: u64,
    action: Action,
    priority: Priority,
    blast_radius: BlastRadius,
) -> Intent {
    Intent::new(id, AgentId::new(agent), action, priority, blast_radius)
}

fn apply(resource: &str, image: &str) -> Action {
    Action::Apply {
        resource: resource.into(),
        manifest: image.into(),
    }
}

fn scale(resource: &str, replicas: u32) -> Action {
    Action::Scale {
        resource: resource.into(),
        replicas,
    }
}

fn destroy(resource: &str) -> Action {
    Action::Destroy {
        resource: resource.into(),
    }
}

/// The morning's changes, each chosen to show one guardrail (or none).
pub fn morning() -> Vec<Intent> {
    use BlastRadius::{Cell, Global, Region, Service};
    use Priority::{Bulk, Normal, Urgent};
    vec![
        intent(
            "web-deployer",
            1,
            apply("web", "registry.internal/web:v42"),
            Normal,
            Service,
        ),
        intent(
            "web-deployer",
            2,
            apply("api", "docker.io/library/api:latest"),
            Normal,
            Service,
        ),
        intent("cleanup-bot", 1, destroy("sessions-db"), Normal, Service),
        intent("web-deployer", 3, scale("payments-api", 4), Normal, Service),
        intent(
            "payments-deployer",
            1,
            apply("payments-web", "registry.internal/payments:v9"),
            Normal,
            Service,
        ),
        intent("autoscaler", 1, scale("search", 60), Normal, Service),
        intent("autoscaler", 2, scale("thumbnails", 0), Normal, Service),
        intent(
            "web-deployer",
            4,
            apply("web-edge", "registry.internal/edge:v7"),
            Normal,
            Region,
        ),
        intent("cdn-bot", 1, destroy("cdn"), Urgent, Global),
        intent("chaos-monkey", 1, destroy("orders-db"), Bulk, Cell),
        intent("chaos-monkey", 2, destroy("staging-web"), Bulk, Cell),
    ]
}

/// One decision: the verdict, the intent and its action, and each policy
/// that did not admit it, with why. A released intent's deferrals are
/// waived, and show as such.
fn show(out: &mut String, d: &Decision) {
    let by = d
        .released_by
        .as_ref()
        .map(|by| format!("  (released by {by})"))
        .unwrap_or_default();
    let key = d.intent.key().to_string();
    let label = d.verdict.label();
    let action = d.intent.action.to_string();
    writeln!(out, "  {label:<7} {key:<20} {action}{by}").unwrap();
    for (policy, verdict) in &d.breakdown {
        let Some(reason) = verdict.reason() else {
            continue;
        };
        let waived = if d.released_by.is_some() && matches!(verdict, Verdict::Defer(_)) {
            "waived: "
        } else {
            ""
        };
        writeln!(out, "{:10}{policy}: {waived}{reason}", "").unwrap();
    }
}

/// The whole example, as it prints.
pub fn run() -> String {
    let mut out = String::new();
    let policies = floodwall::rules::parse(RULES).expect("the guardrails parse");
    let rules: usize = policies.iter().map(|p| p.len()).sum();
    let gate = Gate::new().with_rules(RULES).expect("the guardrails parse");
    let bundle = gate.bundles()[0].clone();
    let mut plane = Floodwall::new(Admission::new(64, RateLimit::new(8.0, 1.0)), gate);
    writeln!(
        out,
        "production guardrails: {} policies, {rules} rules, from policies/production.rules",
        policies.len()
    )
    .unwrap();
    writeln!(out, "bundle {bundle}, sha256 {}", bundle.digest).unwrap();

    let morning = morning();
    let count = morning.len();
    for intent in morning {
        plane.submit(intent, 0).expect("the queue has room");
    }
    let report = plane.tick(0);
    writeln!(
        out,
        "\ntick 0: {count} intents submitted, {} ruled on",
        report.decisions.len()
    )
    .unwrap();
    for d in &report.decisions {
        show(&mut out, d);
    }

    writeln!(out, "\nheld for a human: {}", plane.held().count()).unwrap();
    for held in plane.held() {
        writeln!(
            out,
            "  {:<20} {}",
            held.intent.key().to_string(),
            held.reason
        )
        .unwrap();
    }

    // The admitted changes are applied and reported back.
    let admitted: Vec<IntentKey> = report.admitted().map(Intent::key).collect();
    for key in &admitted {
        plane
            .complete(key, Outcome::Succeeded, 1)
            .expect("in flight");
    }

    // A human works the hold queue: two changes go ahead, one does not.
    plane
        .release(&IntentKey::new("autoscaler", 1), "alice", 1)
        .expect("held");
    plane
        .release(&IntentKey::new("web-deployer", 4), "alice", 1)
        .expect("held");
    plane
        .expire(&IntentKey::new("autoscaler", 2), "bob", 1)
        .expect("held");
    writeln!(
        out,
        "\nalice releases autoscaler#1 and web-deployer#4; bob expires autoscaler#2"
    )
    .unwrap();

    let report = plane.tick(2);
    writeln!(
        out,
        "\ntick 2: {} ruled on, their deferrals waived",
        report.decisions.len()
    )
    .unwrap();
    for d in &report.decisions {
        show(&mut out, d);
    }
    for key in report.admitted().map(Intent::key).collect::<Vec<_>>() {
        plane
            .complete(&key, Outcome::Succeeded, 3)
            .expect("in flight");
    }

    // Every arrival, decision, release, expiry and outcome is on the record.
    let ledger = plane.ledger();
    let mut kinds: Vec<(&str, usize)> = Vec::new();
    for record in ledger.records() {
        match kinds
            .iter_mut()
            .find(|(verdict, _)| *verdict == record.verdict)
        {
            Some((_, n)) => *n += 1,
            None => kinds.push((&record.verdict, 1)),
        }
    }
    let kinds: Vec<String> = kinds.iter().map(|(v, n)| format!("{v} {n}")).collect();
    writeln!(
        out,
        "\nledger: {} records, chain valid: {}\n  {}",
        ledger.len(),
        ledger.verify(),
        kinds.join(", ")
    )
    .unwrap();
    // Each decision records the bundle that made it.
    let decided = ledger
        .records()
        .iter()
        .filter(|r| r.evidence.bundles == [bundle.clone()])
        .count();
    writeln!(out, "  {decided} decisions record bundle {bundle}").unwrap();
    out
}
