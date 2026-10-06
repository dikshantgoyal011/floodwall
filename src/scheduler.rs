//! The scheduler - what may run now.
//!
//! Admission decides how fast intents reach the wall and in what order they
//! wait. The scheduler sits between that queue and the gate and decides
//! *when* each waiting intent is ruled on: an intent is only handed to the
//! gate once it could actually start. An intent the gate admits is
//! *dispatched*: it is in flight, the caller applies it, and it holds its
//! place in the scheduler until the caller reports it complete.
//!
//! Each [`Floodwall::tick`](crate::Floodwall::tick) is one *pass* over the
//! queue in priority order. Every intent is either ready (it goes to the
//! gate now) or blocked (it waits for in-flight work to finish).
//!
//! # What may run together
//!
//! The wider an intent's [`BlastRadius`], the more it has to itself:
//!
//! | Blast radius       | May start when                                      | While in flight                  |
//! |--------------------|-----------------------------------------------------|----------------------------------|
//! | `Global`           | nothing at all is in flight                         | nothing else starts              |
//! | `Region`           | no other wide intent is in flight, and nothing is in flight on its resource | nothing else starts on its resource, and no other wide intent starts |
//! | `Service`, `Cell`  | no `Global` is in flight, and no other intent is in flight on its resource | -                  |
//!
//! So narrow intents are partitioned by resource: work on different
//! resources runs concurrently, and work on one resource runs one intent at
//! a time, in queue order.
//!
//! # No overtaking
//!
//! A pass walks the queue highest priority first. When an intent is
//! blocked, it keeps what it is waiting for from anything behind it in the
//! queue, so a wide change is not starved by a stream of smaller ones:
//!
//! - a blocked `Global` ends the pass: nothing behind it starts;
//! - a blocked `Region` keeps the wide slot and its resource: nothing
//!   behind it that is wide, or that targets its resource, starts;
//! - a blocked narrow intent keeps its resource: nothing behind it that
//!   targets the same resource starts.
//!
//! Work *ahead* of a blocked intent in the queue still starts, because it
//! has priority over it. A blocked intent is only ever waiting on work
//! that is already in flight, so as long as the caller completes what it
//! is given, the front of the queue always makes progress.
//!
//! # Conflicts
//!
//! Two agents must not apply contradictory changes to one resource in the
//! same window (see [`Action::contradicts`]). Every dispatched intent
//! *claims* its `(resource, action)` while it is in flight and for
//! [`SchedulerConfig::conflict_window`] ticks after it completes, however it
//! completed. When an intent is about to start, it is checked against the
//! claims on its resource made by *other* agents; an agent may always
//! follow up on its own change. A contradiction defers the intent so a
//! human can decide which change should win.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::intent::{Action, BlastRadius, Intent, IntentKey};

/// The conflict window used by [`SchedulerConfig::default`], in ticks.
pub const DEFAULT_CONFLICT_WINDOW: u64 = 10;

/// How the scheduler runs intents together. Build with the setters:
///
/// ```
/// use floodwall::SchedulerConfig;
///
/// let config = SchedulerConfig::default().with_conflict_window(30);
/// assert_eq!(config.conflict_window(), 30);
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SchedulerConfig {
    conflict_window: u64,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            conflict_window: DEFAULT_CONFLICT_WINDOW,
        }
    }
}

impl SchedulerConfig {
    /// How many ticks after an intent completes its claim on its
    /// `(resource, action)` stays open. `0` means only in-flight intents
    /// can conflict.
    pub fn with_conflict_window(mut self, ticks: u64) -> Self {
        self.conflict_window = ticks;
        self
    }

    /// The conflict window, in ticks.
    pub fn conflict_window(&self) -> u64 {
        self.conflict_window
    }
}

/// A dispatched intent's claim on its `(resource, action)`.
#[derive(Clone, Debug)]
struct Claim {
    key: IntentKey,
    action: Action,
    /// When it completed; `None` while it is in flight.
    done_at: Option<u64>,
}

impl Claim {
    /// The first tick at which the claim no longer counts, if it has
    /// completed.
    fn closes_at(&self, window: u64) -> Option<u64> {
        self.done_at.map(|done| done.saturating_add(window))
    }

    fn is_open(&self, now: u64, window: u64) -> bool {
        self.closes_at(window).is_none_or(|closes| now < closes)
    }
}

/// An intent the gate admitted, which the caller is applying.
#[derive(Clone, Debug)]
pub struct InFlight {
    /// The intent being applied.
    pub intent: Intent,
    /// The tick it was dispatched.
    pub since: u64,
}

/// The scheduler's answer for one queued intent during a pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Readiness {
    /// It may go to the gate now.
    Ready,
    /// It has to wait for in-flight work to finish.
    Blocked,
}

/// What blocked intents have kept from the rest of one pass.
#[derive(Debug, Default)]
pub(crate) struct Pass {
    /// A blocked `Global`: nothing further in the queue may start.
    closed: bool,
    /// A blocked wide intent: no further wide intent may start.
    wide: bool,
    /// Resources a blocked intent is waiting for.
    resources: HashSet<String>,
}

impl Pass {
    /// Whether nothing further in the queue may start in this pass.
    pub(crate) fn is_closed(&self) -> bool {
        self.closed
    }
}

/// The one wide (`Region` or `Global`) intent allowed in flight.
#[derive(Debug)]
struct Wide {
    key: IntentKey,
    resource: String,
    global: bool,
}

fn is_wide(blast: BlastRadius) -> bool {
    blast >= BlastRadius::Region
}

/// In-flight bookkeeping and the rules for what may run together.
#[derive(Debug, Default)]
pub(crate) struct Scheduler {
    config: SchedulerConfig,
    in_flight: BTreeMap<IntentKey, InFlight>,
    /// In-flight count per resource; resources with none are absent.
    per_resource: HashMap<String, usize>,
    wide: Option<Wide>,
    /// Open claims per resource, oldest first; resources with none are
    /// absent.
    claims: HashMap<String, Vec<Claim>>,
}

impl Scheduler {
    pub(crate) fn new(config: SchedulerConfig) -> Self {
        Self {
            config,
            ..Self::default()
        }
    }

    pub(crate) fn config(&self) -> &SchedulerConfig {
        &self.config
    }

    /// Replace the configuration. It applies from the next check on,
    /// including to claims already made.
    pub(crate) fn set_config(&mut self, config: SchedulerConfig) {
        self.config = config;
    }

    /// Start a pass over the queue at tick `now`, first dropping claims
    /// whose window has closed.
    pub(crate) fn begin(&mut self, now: u64) -> Pass {
        let window = self.config.conflict_window;
        self.claims.retain(|_, claims| {
            claims.retain(|c| c.is_open(now, window));
            !claims.is_empty()
        });
        Pass::default()
    }

    /// If starting `intent` at tick `now` would contradict another agent's
    /// open claim on the same resource, say which one and why.
    pub(crate) fn conflict(&self, intent: &Intent, now: u64) -> Option<String> {
        let window = self.config.conflict_window;
        let claims = self.claims.get(intent.action.resource())?;
        let claim = claims.iter().find(|c| {
            c.key.agent != intent.agent
                && c.is_open(now, window)
                && c.action.contradicts(&intent.action)
        })?;
        Some(match claim.closes_at(window) {
            None => format!(
                "contradicts `{}` by {}, which is in flight",
                claim.action, claim.key
            ),
            Some(closes) => format!(
                "contradicts `{}` by {}, completed at tick {}; conflict window open until tick {closes}",
                claim.action,
                claim.key,
                claim.done_at.expect("closes_at is Some only once done")
            ),
        })
    }

    fn in_flight_on(&self, resource: &str) -> usize {
        self.per_resource.get(resource).copied().unwrap_or(0)
    }

    fn global_in_flight(&self) -> bool {
        self.wide.as_ref().is_some_and(|w| w.global)
    }

    /// Whether a `Region` intent in flight has `resource` to itself.
    fn region_holds(&self, resource: &str) -> bool {
        self.wide.as_ref().is_some_and(|w| w.resource == resource)
    }

    /// Whether `intent` may go to the gate now.
    pub(crate) fn readiness(&self, intent: &Intent, pass: &Pass) -> Readiness {
        let resource = intent.action.resource();
        let ready = !pass.closed
            && match intent.blast_radius {
                // A blocked intent is only ever waiting on in-flight work,
                // so with nothing in flight the pass has kept nothing back.
                BlastRadius::Global => self.in_flight.is_empty(),
                BlastRadius::Region => {
                    self.wide.is_none()
                        && !pass.wide
                        && !pass.resources.contains(resource)
                        && self.in_flight_on(resource) == 0
                }
                BlastRadius::Service | BlastRadius::Cell => {
                    !self.global_in_flight()
                        && !self.region_holds(resource)
                        && !pass.resources.contains(resource)
                        && self.in_flight_on(resource) < 1
                }
            };
        if ready {
            Readiness::Ready
        } else {
            Readiness::Blocked
        }
    }

    /// Record that `intent` was blocked in this pass, so nothing behind it
    /// in the queue takes what it is waiting for.
    pub(crate) fn wait(&self, intent: &Intent, pass: &mut Pass) {
        match intent.blast_radius {
            BlastRadius::Global => pass.closed = true,
            BlastRadius::Region => {
                pass.wide = true;
                pass.resources.insert(intent.action.resource().to_string());
            }
            BlastRadius::Service | BlastRadius::Cell => {
                pass.resources.insert(intent.action.resource().to_string());
            }
        }
    }

    /// Dispatch an intent the gate admitted at tick `now`.
    pub(crate) fn start(&mut self, intent: Intent, now: u64) {
        let key = intent.key();
        let resource = intent.action.resource().to_string();
        if is_wide(intent.blast_radius) {
            debug_assert!(self.wide.is_none(), "two wide intents in flight");
            self.wide = Some(Wide {
                key: key.clone(),
                resource: resource.clone(),
                global: intent.blast_radius == BlastRadius::Global,
            });
        }
        *self.per_resource.entry(resource.clone()).or_insert(0) += 1;
        self.claims.entry(resource).or_default().push(Claim {
            key: key.clone(),
            action: intent.action.clone(),
            done_at: None,
        });
        let previous = self.in_flight.insert(key, InFlight { intent, since: now });
        debug_assert!(previous.is_none(), "an intent was dispatched twice");
    }

    /// The caller finished applying an intent at tick `now`. Returns it, or
    /// `None` if it was not in flight. Its claim stays open for the
    /// conflict window.
    pub(crate) fn finish(&mut self, key: &IntentKey, now: u64) -> Option<InFlight> {
        let finished = self.in_flight.remove(key)?;
        let resource = finished.intent.action.resource();
        let claim = self.claims.get_mut(resource).and_then(|claims| {
            claims
                .iter_mut()
                .find(|c| &c.key == key && c.done_at.is_none())
        });
        match claim {
            Some(claim) => claim.done_at = Some(now),
            None => debug_assert!(false, "in-flight intent without an open claim"),
        }
        match self.per_resource.get_mut(resource) {
            Some(1) => {
                self.per_resource.remove(resource);
            }
            Some(n) => *n -= 1,
            None => debug_assert!(false, "in-flight intent missing from its resource count"),
        }
        if self.wide.as_ref().is_some_and(|w| &w.key == key) {
            self.wide = None;
        }
        Some(finished)
    }

    /// Everything in flight, ordered by intent key.
    pub(crate) fn in_flight(&self) -> impl Iterator<Item = &InFlight> {
        self.in_flight.values()
    }

    /// Whether `key` is in flight.
    pub(crate) fn is_in_flight(&self, key: &IntentKey) -> bool {
        self.in_flight.contains_key(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{Action, AgentId, Priority};

    fn intent(id: u64, resource: &str, blast: BlastRadius) -> Intent {
        Intent::new(
            id,
            AgentId::new("bot"),
            Action::Apply {
                resource: resource.into(),
                manifest: format!("m{id}"),
            },
            Priority::Normal,
            blast,
        )
    }

    /// The scheduler's half of a `Floodwall::tick`, with every ready intent
    /// admitted: returns the ids dispatched, and removes them from `queue`.
    fn pass(s: &mut Scheduler, queue: &mut Vec<Intent>, now: u64) -> Vec<u64> {
        let mut p = s.begin(now);
        let mut dispatched = Vec::new();
        let mut i = 0;
        while i < queue.len() && !p.is_closed() {
            match s.readiness(&queue[i], &p) {
                Readiness::Ready => {
                    let intent = queue.remove(i);
                    dispatched.push(intent.id);
                    s.start(intent, now);
                }
                Readiness::Blocked => {
                    s.wait(&queue[i], &mut p);
                    i += 1;
                }
            }
        }
        dispatched
    }

    fn finish(s: &mut Scheduler, id: u64) {
        s.finish(&IntentKey::new("bot", id), 0)
            .expect("was in flight");
    }

    fn sched() -> Scheduler {
        Scheduler::new(SchedulerConfig::default())
    }

    use BlastRadius::{Cell, Global, Region, Service};

    fn by(agent: &str, id: u64, action: Action) -> Intent {
        Intent::new(id, AgentId::new(agent), action, Priority::Normal, Cell)
    }

    fn scale(n: u32) -> Action {
        Action::Scale {
            resource: "web".into(),
            replicas: n,
        }
    }

    #[test]
    fn an_in_flight_claim_conflicts_with_another_agents_contradiction() {
        let mut s = sched();
        s.start(by("a", 1, scale(3)), 0);
        let reason = s.conflict(&by("b", 1, scale(5)), 0).expect("conflict");
        assert_eq!(
            reason,
            "contradicts `scale web to 3` by a#1, which is in flight"
        );
        // The same agent may follow up on its own change.
        assert_eq!(s.conflict(&by("a", 2, scale(5)), 0), None);
        // Agreeing, or a different action on the resource, is fine.
        assert_eq!(s.conflict(&by("b", 2, scale(3)), 0), None);
        let apply = Action::Apply {
            resource: "web".into(),
            manifest: "v2".into(),
        };
        assert_eq!(s.conflict(&by("b", 3, apply), 0), None);
        // Another resource is untouched.
        let api = Action::Scale {
            resource: "api".into(),
            replicas: 9,
        };
        assert_eq!(s.conflict(&by("b", 4, api), 0), None);
    }

    #[test]
    fn a_claim_stays_open_for_the_window_after_completion() {
        let mut s = Scheduler::new(SchedulerConfig::default().with_conflict_window(10));
        s.start(by("a", 1, scale(3)), 0);
        s.finish(&IntentKey::new("a", 1), 5).unwrap();
        let late = by("b", 1, scale(5));
        // Open for ticks 5..15.
        assert_eq!(
            s.conflict(&late, 14).as_deref(),
            Some(
                "contradicts `scale web to 3` by a#1, completed at tick 5; conflict window open until tick 15"
            )
        );
        assert_eq!(s.conflict(&late, 15), None);
        // A pass after the window drops the claim.
        s.begin(15);
        assert!(s.claims.is_empty());
    }

    #[test]
    fn a_zero_window_only_guards_in_flight_work() {
        let mut s = Scheduler::new(SchedulerConfig::default().with_conflict_window(0));
        s.start(by("a", 1, scale(3)), 0);
        assert!(s.conflict(&by("b", 1, scale(5)), 0).is_some());
        s.finish(&IntentKey::new("a", 1), 2).unwrap();
        assert_eq!(s.conflict(&by("b", 1, scale(5)), 2), None);
        s.begin(2);
        assert!(s.claims.is_empty());
    }

    #[test]
    fn the_window_follows_the_current_config() {
        let mut s = Scheduler::new(SchedulerConfig::default().with_conflict_window(10));
        s.start(by("a", 1, scale(3)), 0);
        s.finish(&IntentKey::new("a", 1), 0).unwrap();
        assert!(s.conflict(&by("b", 1, scale(5)), 3).is_some());
        s.set_config(SchedulerConfig::default().with_conflict_window(2));
        assert_eq!(s.config().conflict_window(), 2);
        assert_eq!(s.conflict(&by("b", 1, scale(5)), 3), None);
    }

    #[test]
    fn claims_survive_a_reused_intent_key() {
        // a#1 completes, then a reuses id 1 for a new change. Each claim is
        // tracked separately: finishing the new one closes only its own.
        let mut s = Scheduler::new(SchedulerConfig::default().with_conflict_window(10));
        s.start(by("a", 1, scale(3)), 0);
        s.finish(&IntentKey::new("a", 1), 1).unwrap();
        s.start(by("a", 1, scale(4)), 2);
        assert_eq!(s.claims["web"].len(), 2);
        s.finish(&IntentKey::new("a", 1), 20).unwrap();
        let done: Vec<Option<u64>> = s.claims["web"].iter().map(|c| c.done_at).collect();
        assert_eq!(done, [Some(1), Some(20)]);
        s.begin(20);
        assert_eq!(
            s.claims["web"].len(),
            1,
            "the first claim's window closed at 11"
        );
    }

    #[test]
    fn narrow_intents_on_different_resources_run_together() {
        let mut s = sched();
        let mut q = vec![intent(1, "web", Service), intent(2, "api", Cell)];
        assert_eq!(pass(&mut s, &mut q, 0), [1, 2]);
    }

    #[test]
    fn global_waits_for_everything_in_flight_then_runs_alone() {
        let mut s = sched();
        let mut q = vec![intent(1, "web", Service)];
        assert_eq!(pass(&mut s, &mut q, 0), [1]);

        q.push(intent(2, "db", Global));
        assert!(pass(&mut s, &mut q, 1).is_empty(), "web is still in flight");
        finish(&mut s, 1);
        assert_eq!(pass(&mut s, &mut q, 2), [2]);

        // Nothing starts while the global change is in flight, not even an
        // unrelated narrow one.
        q.push(intent(3, "cache", Cell));
        assert!(pass(&mut s, &mut q, 3).is_empty());
        finish(&mut s, 2);
        assert_eq!(pass(&mut s, &mut q, 4), [3]);
    }

    #[test]
    fn a_blocked_global_holds_back_everything_behind_it() {
        let mut s = sched();
        let mut q = vec![intent(1, "web", Service)];
        pass(&mut s, &mut q, 0);
        // The global is first in line; the cell change behind it could run
        // alongside web, but must not overtake the global.
        q = vec![intent(2, "db", Global), intent(3, "cache", Cell)];
        assert!(pass(&mut s, &mut q, 1).is_empty());
        finish(&mut s, 1);
        assert_eq!(pass(&mut s, &mut q, 2), [2]);
        finish(&mut s, 2);
        assert_eq!(pass(&mut s, &mut q, 3), [3]);
    }

    #[test]
    fn work_ahead_of_a_blocked_global_still_runs() {
        let mut s = sched();
        let mut q = vec![intent(1, "web", Service)];
        pass(&mut s, &mut q, 0);
        // Ahead of the global in the queue, so it has priority over it.
        q = vec![intent(2, "api", Cell), intent(3, "db", Global)];
        assert_eq!(pass(&mut s, &mut q, 1), [2]);
        assert_eq!(q.len(), 1);
    }

    #[test]
    fn regions_run_one_at_a_time_in_queue_order() {
        let mut s = sched();
        let mut q = vec![
            intent(1, "web", Region),
            intent(2, "api", Region),
            intent(3, "db", Region),
        ];
        assert_eq!(pass(&mut s, &mut q, 0), [1]);
        assert!(pass(&mut s, &mut q, 1).is_empty());
        finish(&mut s, 1);
        assert_eq!(pass(&mut s, &mut q, 2), [2]);
        finish(&mut s, 2);
        assert_eq!(pass(&mut s, &mut q, 3), [3]);
    }

    #[test]
    fn a_region_and_a_global_never_overlap() {
        let mut s = sched();
        let mut q = vec![intent(1, "web", Region), intent(2, "db", Global)];
        assert_eq!(pass(&mut s, &mut q, 0), [1]);
        finish(&mut s, 1);
        assert_eq!(pass(&mut s, &mut q, 1), [2]);
        q.push(intent(3, "api", Region));
        assert!(pass(&mut s, &mut q, 2).is_empty());
    }

    #[test]
    fn a_region_needs_its_resource_to_itself() {
        let mut s = sched();
        let mut q = vec![intent(1, "web", Cell)];
        pass(&mut s, &mut q, 0);
        q.push(intent(2, "web", Region));
        assert!(
            pass(&mut s, &mut q, 1).is_empty(),
            "a cell change is in flight on web"
        );
        finish(&mut s, 1);
        assert_eq!(pass(&mut s, &mut q, 2), [2]);
        // While the region change runs, nothing else starts on web...
        q.push(intent(3, "web", Cell));
        // ...but narrow work elsewhere does.
        q.push(intent(4, "api", Service));
        assert_eq!(pass(&mut s, &mut q, 3), [4]);
        finish(&mut s, 2);
        assert_eq!(pass(&mut s, &mut q, 4), [3]);
    }

    #[test]
    fn a_blocked_region_keeps_its_resource_and_the_wide_slot() {
        let mut s = sched();
        let mut q = vec![intent(1, "web", Cell)];
        pass(&mut s, &mut q, 0);
        q = vec![
            intent(2, "web", Region), // blocked: web is busy
            intent(3, "web", Cell),   // would fit, but must not overtake 2
            intent(4, "api", Region), // would fit, but 2 has the wide slot
            intent(5, "api", Cell),   // would fit, but must not overtake 4
            intent(6, "db", Cell),    // unrelated: runs
        ];
        assert_eq!(pass(&mut s, &mut q, 1), [6]);
        finish(&mut s, 1);
        // web is free: the region change goes first. 3 waits for it, and
        // 4 now waits for the wide slot, still keeping api from 5.
        assert_eq!(pass(&mut s, &mut q, 2), [2]);
        finish(&mut s, 2);
        assert_eq!(pass(&mut s, &mut q, 3), [3, 4]);
        // 5 waits for the region change on api.
        assert!(pass(&mut s, &mut q, 4).is_empty());
        finish(&mut s, 4);
        assert_eq!(pass(&mut s, &mut q, 5), [5]);
    }

    #[test]
    fn finishing_frees_exactly_what_was_held() {
        let mut s = sched();
        let mut q = vec![intent(1, "web", Cell), intent(2, "api", Service)];
        assert_eq!(pass(&mut s, &mut q, 0), [1, 2]);
        assert_eq!(s.in_flight_on("web"), 1);
        finish(&mut s, 1);
        assert_eq!(s.in_flight_on("web"), 0);
        assert!(!s.per_resource.contains_key("web"), "no stale zero entries");
        assert_eq!(s.in_flight_on("api"), 1);
        q.push(intent(3, "db", Global));
        assert!(pass(&mut s, &mut q, 1).is_empty(), "2 is still on api");
        finish(&mut s, 2);
        assert_eq!(pass(&mut s, &mut q, 2), [3]);
        finish(&mut s, 3);
        assert!(s.wide.is_none());
        assert!(s.per_resource.is_empty());
        assert!(s.in_flight.is_empty());
        assert!(s.finish(&IntentKey::new("bot", 3), 3).is_none());
    }

    #[test]
    fn narrow_intents_on_one_resource_run_one_at_a_time_in_queue_order() {
        let mut s = sched();
        let mut q = vec![
            intent(1, "web", Cell),
            intent(2, "web", Service),
            intent(3, "web", Cell),
        ];
        assert_eq!(pass(&mut s, &mut q, 0), [1]);
        assert!(pass(&mut s, &mut q, 1).is_empty());
        finish(&mut s, 1);
        assert_eq!(pass(&mut s, &mut q, 2), [2]);
        finish(&mut s, 2);
        assert_eq!(pass(&mut s, &mut q, 3), [3]);
    }

    #[test]
    fn each_resource_is_its_own_lane() {
        let mut s = sched();
        // Three intents on each of four resources, interleaved.
        let resources = ["web", "api", "cache", "db"];
        let mut q: Vec<Intent> = (0..12)
            .map(|i| intent(i, resources[i as usize % 4], Cell))
            .collect();
        // One per resource, the first of each in queue order.
        assert_eq!(pass(&mut s, &mut q, 0), [0, 1, 2, 3]);
        // Finishing one lane only advances that lane.
        finish(&mut s, 2);
        assert_eq!(pass(&mut s, &mut q, 1), [6]);
        for id in [0, 1, 3, 6] {
            finish(&mut s, id);
        }
        assert_eq!(pass(&mut s, &mut q, 2), [4, 5, 7, 10]);
    }
}
