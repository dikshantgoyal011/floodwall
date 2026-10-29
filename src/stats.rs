//! What a plane has done, counted as it goes, for operators to watch.
//!
//! [`Floodwall::stats`](crate::Floodwall::stats) returns a [`Stats`]: for
//! each agent and for the whole fleet, how many intents were refused at the
//! door and why, got into the queue, were admitted, deferred or rejected,
//! released or expired, and succeeded or failed; and how deep the queue is
//! now and has been at most, and how much is in flight and held.
//! [`Stats::prometheus`] writes it in the Prometheus text exposition format,
//! with no dependency, for whatever scrapes the plane.
//!
//! # What is counted, and since when
//!
//! The counts are what this plane has done since it was built, or resumed:
//! [`Floodwall::resume`](crate::Floodwall::resume) starts them afresh once
//! the replay is done, as metrics do when a process restarts. The ledger
//! holds the whole history, but not the refusals at the door, which change
//! nothing and are never recorded; counting replayed history would mix the
//! two.
//!
//! An agent's count of decisions includes those on its intents released
//! from hold, which are ruled on again; `released` counts the releases
//! themselves. `expired` counts both an operator's expiries and the plane's
//! (a TTL, or eviction from a full hold).
//!
//! # Bounded
//!
//! A fleet that mints fresh agent ids must not grow the plane's memory
//! without limit (see FW-104 in GOALS.md), so per-agent counts are kept for
//! the first [`AGENT_LIMIT`] agents the plane hears from. What later agents
//! do is counted in [`Stats::untracked`], and always in [`Stats::total`].
//!
//! With a [`Keyring`](crate::Keyring), an intent can name any agent until
//! it is authenticated, so only the keyring's agents get counts of their
//! own: an intent refused at the door in any other name is counted in
//! [`Stats::untracked`]. Otherwise anyone could take up the per-agent
//! counts with made-up names.

use std::collections::BTreeMap;
use std::fmt::Write;

use crate::admission::Rejected;

/// How many agents a plane keeps counts for (see [Bounded](self#bounded)).
pub const AGENT_LIMIT: usize = 1024;

/// Something a plane did, to count.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Event {
    Refused(Rejected),
    Queued,
    Admitted,
    Deferred,
    Rejected,
    Released,
    Expired,
    Succeeded,
    Failed,
}

/// What happened to one agent's intents, or the fleet's.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    /// Refused at the door: unsigned, with a keyring.
    pub unsigned: u64,
    /// Refused at the door: no key for the agent, with a keyring.
    pub unknown_agent: u64,
    /// Refused at the door: not signed by the agent's key.
    pub bad_signature: u64,
    /// Refused at the door: an intent with the same key was live.
    pub duplicate: u64,
    /// Refused at the door: the queue was full.
    pub backpressure: u64,
    /// Refused at the door: over the agent's rate limit.
    pub rate_limited: u64,
    /// Got into the queue.
    pub queued: u64,
    /// Admitted at the gate, and dispatched.
    pub admitted: u64,
    /// Deferred at the gate, and held.
    pub deferred: u64,
    /// Rejected at the gate.
    pub rejected: u64,
    /// Released from hold by a human.
    pub released: u64,
    /// Expired from hold: by a human, past the TTL, or evicted.
    pub expired: u64,
    /// Reported applied.
    pub succeeded: u64,
    /// Reported failed.
    pub failed: u64,
}

impl Counts {
    /// Every count, with the name it has in [`Stats::prometheus`], in a
    /// fixed order: refusals, the queue, the gate, the hold, outcomes.
    pub fn events(&self) -> [(&'static str, u64); 14] {
        [
            ("unsigned", self.unsigned),
            ("unknown_agent", self.unknown_agent),
            ("bad_signature", self.bad_signature),
            ("duplicate", self.duplicate),
            ("backpressure", self.backpressure),
            ("rate_limited", self.rate_limited),
            ("queued", self.queued),
            ("admitted", self.admitted),
            ("deferred", self.deferred),
            ("rejected", self.rejected),
            ("released", self.released),
            ("expired", self.expired),
            ("succeeded", self.succeeded),
            ("failed", self.failed),
        ]
    }

    /// All the refusals at the door.
    pub fn refused(&self) -> u64 {
        self.unsigned
            + self.unknown_agent
            + self.bad_signature
            + self.duplicate
            + self.backpressure
            + self.rate_limited
    }

    fn add(&mut self, event: Event) {
        let count = match event {
            Event::Refused(why) => match why {
                Rejected::Unsigned => &mut self.unsigned,
                Rejected::UnknownAgent => &mut self.unknown_agent,
                Rejected::BadSignature => &mut self.bad_signature,
                Rejected::Duplicate => &mut self.duplicate,
                Rejected::Backpressure => &mut self.backpressure,
                Rejected::RateLimited => &mut self.rate_limited,
            },
            Event::Queued => &mut self.queued,
            Event::Admitted => &mut self.admitted,
            Event::Deferred => &mut self.deferred,
            Event::Rejected => &mut self.rejected,
            Event::Released => &mut self.released,
            Event::Expired => &mut self.expired,
            Event::Succeeded => &mut self.succeeded,
            Event::Failed => &mut self.failed,
        };
        *count += 1;
    }
}

/// The counts a plane keeps as it goes.
#[derive(Clone, Debug, Default)]
pub(crate) struct Counters {
    total: Counts,
    agents: BTreeMap<String, Counts>,
    untracked: Counts,
    peak_queue_depth: usize,
}

impl Counters {
    /// Count `event` for `agent`.
    pub(crate) fn count(&mut self, agent: &str, event: Event) {
        self.tally(agent, event, true);
    }

    /// Count a refusal at the door of an intent in `agent`'s name. Unless
    /// the name is `trusted` (the plane has no keyring, or the agent is in
    /// it), it gets no counts of its own (see [Bounded](self#bounded)).
    pub(crate) fn refused(&mut self, agent: &str, why: Rejected, trusted: bool) {
        self.tally(agent, Event::Refused(why), trusted);
    }

    fn tally(&mut self, agent: &str, event: Event, track: bool) {
        self.total.add(event);
        if let Some(counts) = self.agents.get_mut(agent) {
            counts.add(event);
        } else if track && self.agents.len() < AGENT_LIMIT {
            self.agents.entry(agent.to_string()).or_default().add(event);
        } else {
            self.untracked.add(event);
        }
    }

    /// Note how deep the queue is now.
    pub(crate) fn queue_depth(&mut self, depth: usize) {
        self.peak_queue_depth = self.peak_queue_depth.max(depth);
    }

    /// Start afresh, with the queue `depth` deep.
    pub(crate) fn reset(&mut self, depth: usize) {
        *self = Counters::default();
        self.peak_queue_depth = depth;
    }

    pub(crate) fn snapshot(&self, queue_depth: usize, in_flight: usize, held: usize) -> Stats {
        Stats {
            total: self.total,
            agents: self.agents.clone(),
            untracked: self.untracked,
            queue_depth,
            peak_queue_depth: self.peak_queue_depth,
            in_flight,
            held,
        }
    }
}

/// What a plane has done since it was built or resumed, and where it stands
/// now (see [`crate::stats`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stats {
    /// Across every agent.
    pub total: Counts,
    agents: BTreeMap<String, Counts>,
    /// Across the agents past [`AGENT_LIMIT`], which have no counts of their
    /// own.
    pub untracked: Counts,
    /// Intents waiting in the queue now.
    pub queue_depth: usize,
    /// The most that have waited at once.
    pub peak_queue_depth: usize,
    /// Intents dispatched and not yet completed.
    pub in_flight: usize,
    /// Intents held for a human.
    pub held: usize,
}

impl Stats {
    /// One agent's counts, if the plane keeps them: it has heard from the
    /// agent, and the agent is among the first [`AGENT_LIMIT`].
    pub fn agent(&self, agent: &str) -> Option<&Counts> {
        self.agents.get(agent)
    }

    /// Every agent with counts of its own, by name.
    pub fn agents(&self) -> impl Iterator<Item = (&str, &Counts)> {
        self.agents
            .iter()
            .map(|(name, counts)| (name.as_str(), counts))
    }

    /// The stats in the [Prometheus text exposition
    /// format](https://prometheus.io/docs/instrumenting/exposition_formats/):
    ///
    /// ```text
    /// # HELP floodwall_intents_total Intents by agent and what happened to them, since the plane started.
    /// # TYPE floodwall_intents_total counter
    /// floodwall_intents_total{agent="deployer",event="queued"} 12
    /// ...
    /// # TYPE floodwall_queue_depth gauge
    /// floodwall_queue_depth 3
    /// ```
    ///
    /// `floodwall_intents_total` has a sample for every event of every agent
    /// with counts of its own, agents in name order and events in the order
    /// of [`Counts::events`]; agent names are escaped as the format requires.
    /// What untracked agents did is `floodwall_untracked_intents_total`, by
    /// event. Then the gauges: queue depth, its peak, in flight, held.
    pub fn prometheus(&self) -> String {
        let mut out = String::new();
        out.push_str(
            "# HELP floodwall_intents_total Intents by agent and what happened to them, \
             since the plane started.\n\
             # TYPE floodwall_intents_total counter\n",
        );
        for (agent, counts) in &self.agents {
            for (event, n) in counts.events() {
                writeln!(
                    out,
                    "floodwall_intents_total{{agent=\"{}\",event=\"{event}\"}} {n}",
                    label(agent)
                )
                .unwrap();
            }
        }
        out.push_str(
            "# HELP floodwall_untracked_intents_total Intents of agents past the per-agent \
             limit, by what happened to them.\n\
             # TYPE floodwall_untracked_intents_total counter\n",
        );
        for (event, n) in self.untracked.events() {
            writeln!(
                out,
                "floodwall_untracked_intents_total{{event=\"{event}\"}} {n}"
            )
            .unwrap();
        }
        for (name, help, value) in [
            (
                "floodwall_queue_depth",
                "Intents waiting in the queue.",
                self.queue_depth,
            ),
            (
                "floodwall_queue_depth_peak",
                "The most intents that have waited in the queue at once.",
                self.peak_queue_depth,
            ),
            (
                "floodwall_in_flight",
                "Intents dispatched and not yet completed.",
                self.in_flight,
            ),
            ("floodwall_held", "Intents held for a human.", self.held),
        ] {
            writeln!(
                out,
                "# HELP {name} {help}\n# TYPE {name} gauge\n{name} {value}"
            )
            .unwrap();
        }
        out
    }
}

/// A label value as the text format writes it: `\`, `"` and line feeds
/// escaped.
fn label(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{Action, AgentId, BlastRadius, Intent, IntentKey, Priority};
    use crate::policy::{NoGlobalDestroy, ResourceAllowlist};
    use crate::{
        Admission, Floodwall, Gate, HoldConfig, Keyring, Ledger, Outcome, RateLimit, SigningKey,
    };

    fn key(agent: &str) -> SigningKey {
        SigningKey::from_seed(&[agent.as_bytes()[0]; 32])
    }

    fn intent(agent: &str, id: u64, action: Action, blast: BlastRadius) -> Intent {
        let priority = if blast == BlastRadius::Global {
            Priority::Pager
        } else {
            Priority::Normal
        };
        Intent::new(id, AgentId::new(agent), action, priority, blast)
    }

    fn scale(agent: &str, id: u64, resource: &str) -> Intent {
        let action = Action::Scale {
            resource: resource.into(),
            replicas: 2,
        };
        intent(agent, id, action, BlastRadius::Service)
    }

    fn apply(agent: &str, id: u64, resource: &str) -> Intent {
        let action = Action::Apply {
            resource: resource.into(),
            manifest: "v2".into(),
        };
        intent(agent, id, action, BlastRadius::Service)
    }

    /// The counts, as numbers in the order of `Counts::events`.
    fn numbers(c: &Counts) -> Vec<u64> {
        c.events().iter().map(|(_, n)| *n).collect()
    }

    #[test]
    fn every_refusal_at_the_door_is_counted_by_its_reason() {
        // A queue of 3, two tokens an agent, and a keyring for a and b.
        let keyring = Keyring::new()
            .with("a", key("a").verifying_key())
            .with("b", key("b").verifying_key());
        let mut plane = Floodwall::new(Admission::new(3, RateLimit::new(2.0, 0.0)), Gate::new())
            .with_keyring(keyring);
        let signed = |i: Intent, by: &str| i.signed(&key(by));
        let _ = plane.submit(signed(scale("a", 1, "web"), "a"), 0); // queued
        let _ = plane.submit(signed(scale("a", 1, "web"), "a"), 0); // duplicate
        let _ = plane.submit(signed(scale("a", 2, "api"), "a"), 0); // queued
        let _ = plane.submit(signed(scale("a", 3, "db"), "a"), 0); // rate-limited
        let _ = plane.submit(scale("b", 1, "web"), 0); // unsigned
        let _ = plane.submit(signed(scale("z", 1, "web"), "z"), 0); // unknown agent
        let _ = plane.submit(scale("y", 1, "web"), 0); // unsigned, and unknown
        let _ = plane.submit(signed(scale("b", 1, "web"), "a"), 0); // a's key, not b's
        let _ = plane.submit(signed(scale("b", 1, "web"), "b"), 0); // queued: now full
        let _ = plane.submit(signed(scale("b", 2, "api"), "b"), 0); // backpressure
        let stats = plane.stats();
        let a = Counts {
            queued: 2,
            duplicate: 1,
            rate_limited: 1,
            ..Counts::default()
        };
        // b is in the keyring: its first refusal gives it counts of its own.
        let b = Counts {
            queued: 1,
            unsigned: 1,
            bad_signature: 1,
            backpressure: 1,
            ..Counts::default()
        };
        assert_eq!(stats.agent("a"), Some(&a));
        assert_eq!(stats.agent("b"), Some(&b));
        assert_eq!(stats.agents().count(), 2);
        // z and y are not: anyone can send an intent in any name.
        let strangers = Counts {
            unknown_agent: 1,
            unsigned: 1,
            ..Counts::default()
        };
        assert_eq!(stats.untracked, strangers);
        assert_eq!(stats.total.queued, 3);
        assert_eq!(stats.total.refused(), 7);
        assert_eq!((stats.queue_depth, stats.peak_queue_depth), (3, 3));
    }

    #[test]
    fn without_a_keyring_every_name_is_counted() {
        let mut plane = Floodwall::new(Admission::new(1, RateLimit::new(1.0, 0.0)), Gate::new());
        plane.submit(scale("a", 1, "web"), 0).unwrap();
        let _ = plane.submit(scale("z", 1, "web"), 0); // backpressure
        let stats = plane.stats();
        assert_eq!(stats.agent("z").map(|c| c.backpressure), Some(1));
        assert_eq!(stats.untracked, Counts::default());
    }

    #[test]
    fn decisions_releases_expiries_and_outcomes_are_counted() {
        let gate = Gate::new()
            .with(NoGlobalDestroy)
            .with(ResourceAllowlist::new(["web", "api"]));
        let mut plane = Floodwall::new(Admission::new(16, RateLimit::new(8.0, 1.0)), gate)
            .with_hold(HoldConfig::default().with_ttl(Some(3)));
        plane.submit(scale("a", 1, "web"), 0).unwrap(); // admitted
        plane.submit(apply("a", 2, "cache"), 0).unwrap(); // deferred, then released
        plane.submit(apply("a", 3, "billing"), 0).unwrap(); // deferred, then past the TTL
        plane.submit(apply("a", 4, "queue"), 0).unwrap(); // deferred, then expired by hand
        let destroy = Action::Destroy {
            resource: "api".into(),
        };
        plane
            .submit(intent("b", 1, destroy, BlastRadius::Global), 0)
            .unwrap(); // rejected
        assert_eq!(plane.stats().peak_queue_depth, 5);
        plane.tick(1);
        let mid = plane.stats();
        assert_eq!((mid.queue_depth, mid.in_flight, mid.held), (0, 1, 3));
        plane.release(&IntentKey::new("a", 2), "alice", 2).unwrap();
        plane.expire(&IntentKey::new("a", 4), "bob", 2).unwrap();
        assert_eq!((plane.stats().queue_depth, plane.stats().held), (1, 1));
        plane.tick(2); // a#2 goes ahead, its deferral waived
        plane
            .complete(&IntentKey::new("a", 1), Outcome::Succeeded, 3)
            .unwrap();
        plane
            .complete(&IntentKey::new("a", 2), Outcome::Failed("boom".into()), 3)
            .unwrap();
        plane.tick(4); // a#3, held since 1, reaches the TTL of 3
        let stats = plane.stats();
        let a = Counts {
            queued: 4,
            admitted: 2,
            deferred: 3,
            released: 1,
            expired: 2,
            succeeded: 1,
            failed: 1,
            ..Counts::default()
        };
        let b = Counts {
            queued: 1,
            rejected: 1,
            ..Counts::default()
        };
        assert_eq!(stats.agent("a"), Some(&a));
        assert_eq!(stats.agent("b"), Some(&b));
        // The fleet's counts are the agents' added up.
        let sum: Vec<u64> = numbers(&a)
            .iter()
            .zip(numbers(&b))
            .map(|(x, y)| x + y)
            .collect();
        assert_eq!(numbers(&stats.total), sum);
        assert_eq!(
            (
                stats.queue_depth,
                stats.peak_queue_depth,
                stats.in_flight,
                stats.held
            ),
            (0, 5, 0, 0)
        );
        // Reading the stats changes nothing.
        let head = plane.ledger().head();
        assert_eq!(plane.stats(), stats);
        assert_eq!(plane.ledger().head(), head);
    }

    #[test]
    fn a_plane_built_on_a_queue_starts_at_its_depth() {
        // What the Admission held already was not queued by this plane, so
        // it is not counted, but the queue's peak is at least its depth.
        let mut admission = Admission::new(8, RateLimit::new(8.0, 0.0));
        admission.submit(scale("a", 1, "web"), 0).unwrap();
        admission.submit(scale("a", 2, "api"), 0).unwrap();
        let mut plane = Floodwall::new(admission, Gate::new());
        let stats = plane.stats();
        assert_eq!((stats.queue_depth, stats.peak_queue_depth), (2, 2));
        assert_eq!(stats.total, Counts::default());
        plane.tick(0);
        let stats = plane.stats();
        assert_eq!((stats.queue_depth, stats.peak_queue_depth), (0, 2));
        assert_eq!(stats.agent("a").map(|c| c.admitted), Some(2));
    }

    #[test]
    fn a_resumed_plane_counts_afresh() {
        let plane = || {
            Floodwall::new(
                Admission::new(16, RateLimit::new(8.0, 1.0)),
                Gate::new().with(ResourceAllowlist::new(["web", "api"])),
            )
        };
        let mut before = plane();
        before.submit(scale("a", 1, "web"), 0).unwrap();
        before.submit(apply("a", 2, "cache"), 0).unwrap();
        before.tick(1); // a#1 in flight, a#2 held
        before.submit(scale("a", 3, "api"), 2).unwrap(); // queued
        assert_eq!(before.stats().total.queued, 3);
        let mut export = Vec::new();
        before.ledger().export_jsonl(&mut export).unwrap();
        let mut after = plane()
            .resume(Ledger::read_jsonl(&export[..]).unwrap(), 2)
            .unwrap();
        // Nothing counted for what was replayed; where the plane stands is
        // the same.
        let stats = after.stats();
        assert_eq!(stats.total, Counts::default());
        assert_eq!(stats.agents().count(), 0);
        assert_eq!(
            (
                stats.queue_depth,
                stats.peak_queue_depth,
                stats.in_flight,
                stats.held
            ),
            (1, 1, 1, 1)
        );
        // What it does from here on is counted.
        after.submit(scale("a", 4, "db"), 3).unwrap();
        after
            .complete(&IntentKey::new("a", 1), Outcome::Succeeded, 3)
            .unwrap();
        let stats = after.stats();
        let a = Counts {
            queued: 1,
            succeeded: 1,
            ..Counts::default()
        };
        assert_eq!(stats.agent("a"), Some(&a));
        assert_eq!(stats.peak_queue_depth, 2);
    }

    #[test]
    fn agents_past_the_limit_are_counted_together() {
        let mut plane = Floodwall::new(
            Admission::new(AGENT_LIMIT + 16, RateLimit::new(1.0, 0.0)),
            Gate::new(),
        );
        for n in 0..AGENT_LIMIT + 5 {
            plane.submit(scale(&format!("a{n}"), 1, "web"), 0).unwrap();
        }
        // An agent already counted stays counted once the limit is reached.
        assert_eq!(
            plane.submit(scale("a0", 2, "web"), 0),
            Err(crate::Rejected::RateLimited)
        );
        let late = format!("a{}", AGENT_LIMIT + 4);
        assert_eq!(
            plane.submit(scale(&late, 2, "web"), 0),
            Err(crate::Rejected::RateLimited)
        );
        let stats = plane.stats();
        assert_eq!(stats.agents().count(), AGENT_LIMIT);
        assert_eq!(stats.agent(&late), None);
        assert_eq!(stats.agent("a0").unwrap().rate_limited, 1);
        assert_eq!(stats.untracked.queued, 5);
        assert_eq!(stats.untracked.rate_limited, 1);
        assert_eq!(stats.total.queued, AGENT_LIMIT as u64 + 5);
        assert_eq!(stats.total.rate_limited, 2);
    }

    #[test]
    fn the_prometheus_text_is_exact() {
        let mut plane = Floodwall::new(
            Admission::new(8, RateLimit::new(8.0, 1.0)),
            Gate::new().with(ResourceAllowlist::new(["web"])),
        );
        let awkward = "a\"b\\c\nd";
        plane.submit(scale(awkward, 1, "web"), 0).unwrap();
        plane.submit(apply("bot", 1, "cache"), 0).unwrap();
        plane.tick(1);
        plane.submit(scale("bot", 2, "web"), 2).unwrap();
        let text = plane.stats().prometheus();
        let samples = |agent: &str, counts: [u64; 14]| -> String {
            Counts::default()
                .events()
                .iter()
                .zip(counts)
                .map(|((event, _), n)| {
                    format!("floodwall_intents_total{{agent=\"{agent}\",event=\"{event}\"}} {n}\n")
                })
                .collect()
        };
        let mut want = String::from(
            "# HELP floodwall_intents_total Intents by agent and what happened to them, \
             since the plane started.\n\
             # TYPE floodwall_intents_total counter\n",
        );
        // Agents in name order, the awkward one escaped: `\`, `"` and line
        // feeds.
        want += &samples(
            "a\\\"b\\\\c\\nd",
            [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
        );
        want += &samples("bot", [0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0, 0]);
        want += "# HELP floodwall_untracked_intents_total Intents of agents past the \
                 per-agent limit, by what happened to them.\n\
                 # TYPE floodwall_untracked_intents_total counter\n";
        for (event, _) in Counts::default().events() {
            want += &format!("floodwall_untracked_intents_total{{event=\"{event}\"}} 0\n");
        }
        want += "# HELP floodwall_queue_depth Intents waiting in the queue.\n\
                 # TYPE floodwall_queue_depth gauge\n\
                 floodwall_queue_depth 1\n\
                 # HELP floodwall_queue_depth_peak The most intents that have waited in the \
                 queue at once.\n\
                 # TYPE floodwall_queue_depth_peak gauge\n\
                 floodwall_queue_depth_peak 2\n\
                 # HELP floodwall_in_flight Intents dispatched and not yet completed.\n\
                 # TYPE floodwall_in_flight gauge\n\
                 floodwall_in_flight 1\n\
                 # HELP floodwall_held Intents held for a human.\n\
                 # TYPE floodwall_held gauge\n\
                 floodwall_held 1\n";
        assert_eq!(text, want);
        // Every line is a comment or a sample with a whole-number value.
        for line in text.lines() {
            assert!(
                line.starts_with("# HELP ")
                    || line.starts_with("# TYPE ")
                    || line
                        .rsplit_once(' ')
                        .is_some_and(|(_, v)| v.parse::<u64>().is_ok()),
                "{line}"
            );
        }
    }
}
