//! Admission control - the gate's throughput governor.
//!
//! Even an intent that would pass every policy has to get through the wall
//! first. This is what makes high volume survivable:
//!
//! - a per-agent **token bucket** caps how fast any one agent can push, so a
//!   single runaway loop cannot starve the rest of the fleet;
//! - a **bounded priority queue** orders what is waiting (highest priority
//!   first, FIFO within a priority) and applies **backpressure** once the
//!   queue is full.
//!
//! # Time
//!
//! Time is a logical tick supplied by the caller, so behaviour is fully
//! deterministic and testable - there is no wall clock anywhere in here.
//!
//! An [`Admission`] keeps one clock: the latest tick any call has supplied.
//! Every method that takes a `now` first treats a tick earlier than that
//! clock as the clock itself, before changing any state, so time as the
//! controller sees it never moves backwards. That is what makes forgetting
//! a refilled bucket safe: no later call can ask about a moment when it
//! was not yet full.

use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};
use std::fmt;

use crate::intent::{AgentId, Intent, Priority};

/// Token-bucket parameters, applied per agent.
#[derive(Clone, Copy, Debug)]
pub struct RateLimit {
    /// Maximum burst: the bucket's capacity in tokens.
    pub burst: f64,
    /// Tokens refilled per logical tick.
    pub refill_per_tick: f64,
}

impl RateLimit {
    /// A limit allowing up to `burst` queued at once, refilling
    /// `refill_per_tick` tokens each tick.
    ///
    /// # Panics
    ///
    /// Panics if the limit is invalid; see [`RateLimit::try_new`].
    pub fn new(burst: f64, refill_per_tick: f64) -> Self {
        match Self::try_new(burst, refill_per_tick) {
            Ok(limit) => limit,
            Err(e) => panic!("{e}"),
        }
    }

    /// A limit allowing up to `burst` queued at once, refilling
    /// `refill_per_tick` tokens each tick, or an error if it could never
    /// admit anything sensibly: `burst` must be finite and at least `1.0`
    /// (a bucket that cannot hold a whole token rate-limits every intent),
    /// and `refill_per_tick` must be finite and non-negative.
    pub fn try_new(burst: f64, refill_per_tick: f64) -> Result<Self, InvalidRateLimit> {
        let limit = Self {
            burst,
            refill_per_tick,
        };
        limit.validate()?;
        Ok(limit)
    }

    /// Check the limit's parameters. The fields are public, so a limit built
    /// by hand is checked again when it is handed to [`Admission::new`].
    pub fn validate(&self) -> Result<(), InvalidRateLimit> {
        if !self.burst.is_finite() || self.burst < 1.0 {
            return Err(InvalidRateLimit::Burst(self.burst));
        }
        if !self.refill_per_tick.is_finite() || self.refill_per_tick < 0.0 {
            return Err(InvalidRateLimit::Refill(self.refill_per_tick));
        }
        Ok(())
    }
}

/// Why a [`RateLimit`] was refused.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InvalidRateLimit {
    /// `burst` was below `1.0`, NaN, or infinite.
    Burst(f64),
    /// `refill_per_tick` was negative, NaN, or infinite.
    Refill(f64),
}

impl fmt::Display for InvalidRateLimit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InvalidRateLimit::Burst(b) => {
                write!(f, "rate limit burst must be finite and >= 1.0, got {b}")
            }
            InvalidRateLimit::Refill(r) => write!(
                f,
                "rate limit refill_per_tick must be finite and >= 0.0, got {r}"
            ),
        }
    }
}

impl std::error::Error for InvalidRateLimit {}

#[derive(Debug)]
struct Bucket {
    tokens: f64,
    last: u64,
}

impl Bucket {
    fn new(limit: RateLimit, now: u64) -> Self {
        Self {
            tokens: limit.burst,
            last: now,
        }
    }

    fn try_take(&mut self, limit: RateLimit, now: u64) -> bool {
        if now > self.last {
            let elapsed = (now - self.last) as f64;
            self.tokens = (self.tokens + elapsed * limit.refill_per_tick).min(limit.burst);
            self.last = now;
        }
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Whether the bucket will have refilled to `burst` by `now`. A full
    /// bucket behaves exactly like a fresh one, so it can be forgotten
    /// without changing any future decision.
    fn is_full_at(&self, limit: RateLimit, now: u64) -> bool {
        let elapsed = now.saturating_sub(self.last) as f64;
        self.tokens + elapsed * limit.refill_per_tick >= limit.burst
    }
}

/// The smallest bucket-map size that triggers an automatic prune.
const MIN_PRUNE_AT: usize = 1024;

/// Why an intent could not be queued.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejected {
    /// The agent is over its rate limit for this tick.
    RateLimited,
    /// The queue is at capacity - backpressure, come back later.
    Backpressure,
    /// An intent with the same agent and id is already live (queued, in
    /// flight, or held). Returned by [`Floodwall::submit`](crate::Floodwall::submit);
    /// [`Admission`] itself does not track identity.
    Duplicate,
}

/// An intent's place in the queue. Keys sort in processing order: highest
/// priority first (hence `Reverse`), then submission order within a
/// priority (FIFO). The scheduler walks the queue in this order and can
/// take an intent from anywhere in it, which a heap cannot do.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct QueueKey {
    priority: Reverse<Priority>,
    seq: u64,
}

/// The front door: per-agent rate limiting in front of a bounded priority queue.
pub struct Admission {
    queue: BTreeMap<QueueKey, Intent>,
    capacity: usize,
    seq: u64,
    limit: RateLimit,
    buckets: HashMap<AgentId, Bucket>,
    /// Bucket-map size at which the next new agent triggers a prune.
    prune_at: usize,
    /// The latest tick any call has supplied; see [Time](self#time).
    clock: u64,
}

impl Admission {
    /// A controller holding at most `capacity` waiting intents, with `limit`
    /// applied to each agent independently.
    ///
    /// Per-agent state is bounded: once the number of tracked agents
    /// passes a threshold (at least 1024, doubling with the live set),
    /// agents whose buckets have refilled are forgotten. This never changes
    /// a decision, because a full bucket is identical to a new one and time
    /// never moves backwards (see [Time](self#time)).
    ///
    /// # Panics
    ///
    /// Panics if `limit` is invalid (see [`RateLimit::try_new`]), which can
    /// happen when it was built by setting its public fields directly.
    pub fn new(capacity: usize, limit: RateLimit) -> Self {
        if let Err(e) = limit.validate() {
            panic!("{e}");
        }
        Self {
            queue: BTreeMap::new(),
            capacity,
            seq: 0,
            limit,
            buckets: HashMap::new(),
            prune_at: MIN_PRUNE_AT,
            clock: 0,
        }
    }

    /// Advance the clock to `now` and return the effective time: `now`, or
    /// the clock if `now` is earlier. Every time-taking method calls this
    /// before touching any other state.
    fn advance(&mut self, now: u64) -> u64 {
        self.clock = self.clock.max(now);
        self.clock
    }

    /// The latest tick any call has supplied. A `now` earlier than this is
    /// treated as this.
    pub fn clock(&self) -> u64 {
        self.clock
    }

    /// Forget every agent whose bucket has refilled by logical time `now`,
    /// returning how many were dropped. Called automatically as the agent
    /// set grows; call it directly to reclaim memory sooner.
    ///
    /// `now` advances the clock like [`Admission::submit`] does, so pass the
    /// current tick, not a future one: ticks earlier than it are treated as
    /// it from then on.
    ///
    /// With `refill_per_tick == 0` a spent bucket never refills, so it is
    /// never dropped: forgetting it would hand the agent a fresh burst.
    pub fn prune_idle(&mut self, now: u64) -> usize {
        let now = self.advance(now);
        let limit = self.limit;
        let before = self.buckets.len();
        self.buckets.retain(|_, b| !b.is_full_at(limit, now));
        before - self.buckets.len()
    }

    /// How many agents currently have rate-limit state.
    pub fn tracked_agents(&self) -> usize {
        self.buckets.len()
    }

    /// Try to admit an intent into the queue at logical time `now`. A `now`
    /// earlier than [`Admission::clock`] is treated as the clock.
    ///
    /// Backpressure is checked before the rate limit, so a full queue does
    /// not burn the agent's tokens.
    pub fn submit(&mut self, intent: Intent, now: u64) -> Result<(), Rejected> {
        let now = self.advance(now);
        if self.is_full() {
            return Err(Rejected::Backpressure);
        }
        if self.buckets.len() >= self.prune_at && !self.buckets.contains_key(&intent.agent) {
            self.prune_idle(now);
            // Doubling keeps pruning amortized O(1) per new agent even when
            // most agents are still active and nothing could be dropped.
            self.prune_at = (self.buckets.len() * 2).max(MIN_PRUNE_AT);
        }
        let limit = self.limit;
        let bucket = self
            .buckets
            .entry(intent.agent.clone())
            .or_insert_with(|| Bucket::new(limit, now));
        if !bucket.try_take(limit, now) {
            return Err(Rejected::RateLimited);
        }
        self.enqueue(intent);
        Ok(())
    }

    /// Put an intent that already passed admission back in the queue, e.g.
    /// one released from hold. It goes to the back of its priority class
    /// and does not touch the agent's rate limit, but is still refused with
    /// [`Rejected::Backpressure`] when the queue is full.
    pub(crate) fn requeue(&mut self, intent: Intent, now: u64) -> Result<(), Rejected> {
        self.advance(now);
        if self.is_full() {
            return Err(Rejected::Backpressure);
        }
        self.enqueue(intent);
        Ok(())
    }

    /// Put an intent at the back of its priority class.
    fn enqueue(&mut self, intent: Intent) {
        let key = QueueKey {
            priority: Reverse(intent.priority),
            seq: self.seq,
        };
        self.seq += 1;
        self.queue.insert(key, intent);
    }

    /// Pull the next intent to process: highest priority, FIFO within a
    /// priority. Returns `None` when nothing is waiting.
    pub fn dequeue(&mut self) -> Option<Intent> {
        self.queue.pop_first().map(|(_, intent)| intent)
    }

    /// The waiting intents, in the order they would be dequeued.
    pub fn waiting(&self) -> impl Iterator<Item = &Intent> {
        self.queue.values()
    }

    /// Every queue position, in processing order. A snapshot: positions
    /// stay valid while intents are taken from the queue.
    pub(crate) fn queued_keys(&self) -> Vec<QueueKey> {
        self.queue.keys().copied().collect()
    }

    /// The intent at a queue position, if it is still there.
    pub(crate) fn get(&self, key: &QueueKey) -> Option<&Intent> {
        self.queue.get(key)
    }

    /// Remove and return the intent at a queue position.
    pub(crate) fn take(&mut self, key: &QueueKey) -> Option<Intent> {
        self.queue.remove(key)
    }

    /// How many intents are waiting.
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    /// Whether the queue is at capacity, so the next submit would be refused
    /// with [`Rejected::Backpressure`].
    pub fn is_full(&self) -> bool {
        self.queue.len() >= self.capacity
    }

    /// Whether the queue is empty.
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{Action, BlastRadius};

    fn intent_for(agent: &str, id: u64, priority: Priority) -> Intent {
        Intent::new(
            id,
            AgentId::new(agent),
            Action::Apply {
                resource: "web".into(),
                manifest: String::new(),
            },
            priority,
            BlastRadius::Cell,
        )
    }

    #[test]
    fn rate_limit_caps_the_burst_then_refills() {
        // burst 3, refill 1/tick.
        let mut a = Admission::new(1_000, RateLimit::new(3.0, 1.0));
        // First three at tick 0 go through; the fourth is rate-limited.
        for id in 0..3 {
            assert_eq!(a.submit(intent_for("bot", id, Priority::Normal), 0), Ok(()));
        }
        assert_eq!(
            a.submit(intent_for("bot", 3, Priority::Normal), 0),
            Err(Rejected::RateLimited)
        );
        // One tick later, one token has refilled: exactly one more gets in.
        assert_eq!(a.submit(intent_for("bot", 4, Priority::Normal), 1), Ok(()));
        assert_eq!(
            a.submit(intent_for("bot", 5, Priority::Normal), 1),
            Err(Rejected::RateLimited)
        );
    }

    #[test]
    fn prune_drops_only_refilled_buckets() {
        // burst 2, refill 1/tick.
        let mut a = Admission::new(1_000, RateLimit::new(2.0, 1.0));
        a.submit(intent_for("idle", 0, Priority::Normal), 0)
            .unwrap();
        a.submit(intent_for("busy", 0, Priority::Normal), 0)
            .unwrap();
        a.submit(intent_for("busy", 1, Priority::Normal), 0)
            .unwrap();
        assert_eq!(a.tracked_agents(), 2);
        // At tick 1, "idle" (1 token + 1 refill) is full again; "busy"
        // (0 tokens + 1 refill) is not.
        assert_eq!(a.prune_idle(1), 1);
        assert_eq!(a.tracked_agents(), 1);
        // "busy" kept its debt: one token now, then rate-limited.
        assert_eq!(a.submit(intent_for("busy", 2, Priority::Normal), 1), Ok(()));
        assert_eq!(
            a.submit(intent_for("busy", 3, Priority::Normal), 1),
            Err(Rejected::RateLimited)
        );
    }

    #[test]
    fn prune_never_forgives_a_bucket_that_cannot_refill() {
        let mut a = Admission::new(1_000, RateLimit::new(1.0, 0.0));
        a.submit(intent_for("x", 0, Priority::Normal), 0).unwrap();
        assert_eq!(a.prune_idle(1_000_000), 0);
        assert_eq!(
            a.submit(intent_for("x", 1, Priority::Normal), 1_000_000),
            Err(Rejected::RateLimited)
        );
    }

    #[test]
    fn agent_churn_does_not_grow_state_without_bound() {
        // Every tick a brand-new agent submits once, then never returns.
        // Each bucket refills one tick later, so pruning can always reclaim
        // the old ones.
        let mut a = Admission::new(usize::MAX, RateLimit::new(1.0, 1.0));
        for t in 0..10_000u64 {
            a.submit(intent_for(&format!("agent-{t}"), t, Priority::Bulk), t)
                .unwrap();
            a.dequeue();
        }
        assert!(
            a.tracked_agents() <= 2 * MIN_PRUNE_AT,
            "tracked {} agents",
            a.tracked_agents()
        );
    }

    #[test]
    fn pruning_then_an_earlier_tick_matches_an_unpruned_controller() {
        // Review repro on PR #7: x spends its only token at tick 0, the
        // bucket is pruned at tick 1, then x submits stamped tick 0. The
        // pruned controller must answer exactly like one that never pruned.
        use Step::*;
        let script = [
            Submit("x", 0),
            Dequeue,
            Prune(1),
            Submit("x", 0),
            Submit("x", 0),
        ];
        assert_pruning_changes_nothing(RateLimit::new(1.0, 1.0), 0, &script);

        // And the pruning really happened in that scenario.
        let mut a = Admission::new(10, RateLimit::new(1.0, 1.0));
        a.submit(intent_for("x", 0, Priority::Normal), 0).unwrap();
        a.dequeue();
        assert_eq!(a.prune_idle(1), 1);
        assert_eq!(a.clock(), 1);
    }

    #[test]
    fn earlier_ticks_are_treated_as_the_clock() {
        let mut a = Admission::new(10, RateLimit::new(1.0, 1.0));
        a.submit(intent_for("x", 0, Priority::Normal), 5).unwrap();
        assert_eq!(
            a.submit(intent_for("x", 1, Priority::Normal), 3),
            Err(Rejected::RateLimited),
            "tick 3 is tick 5: no refill yet"
        );
        assert_eq!(a.clock(), 5);
        assert_eq!(a.submit(intent_for("x", 2, Priority::Normal), 6), Ok(()));
    }

    /// One scripted call against a controller, for twin comparisons.
    enum Step {
        Submit(&'static str, u64),
        Prune(u64),
        Dequeue,
    }

    /// Run `script` on a controller that prunes (automatically, plus every
    /// `Prune` step) and on a twin that never prunes, and assert that every
    /// submit gets the same answer from both.
    fn assert_pruning_changes_nothing(limit: RateLimit, noise_agents: usize, script: &[Step]) {
        let mut pruned = Admission::new(usize::MAX, limit);
        let mut twin = Admission::new(usize::MAX, limit);
        twin.prune_at = usize::MAX; // never prunes automatically
                                    // Fill both past the automatic-prune threshold with agents that
                                    // spend their burst at tick 0.
        let noise: Vec<String> = (0..noise_agents).map(|i| format!("noise-{i}")).collect();
        for name in &noise {
            for a in [&mut pruned, &mut twin] {
                while a.submit(intent_for(name, 0, Priority::Bulk), 0).is_ok() {}
            }
        }
        for (i, step) in script.iter().enumerate() {
            match *step {
                Step::Submit(agent, now) => {
                    let got = pruned.submit(intent_for(agent, i as u64, Priority::Normal), now);
                    let want = twin.submit(intent_for(agent, i as u64, Priority::Normal), now);
                    assert_eq!(got, want, "step {i}: submit {agent} at tick {now}");
                }
                Step::Prune(now) => {
                    pruned.prune_idle(now);
                    // The twin only sees the time, like any other call would.
                    twin.advance(now);
                }
                Step::Dequeue => {
                    pruned.dequeue();
                    twin.dequeue();
                }
            }
        }
    }

    #[test]
    fn manual_pruning_never_changes_a_decision_even_when_time_goes_backwards() {
        use Step::*;
        let script = [
            Submit("x", 0),
            Submit("x", 0),
            Prune(1),
            Submit("x", 0),
            Submit("x", 0),
            Submit("y", 4),
            Submit("y", 4),
            Prune(10),
            Submit("y", 2),
            Submit("y", 2),
            Submit("y", 2),
            Dequeue,
            Submit("x", 9),
        ];
        assert_pruning_changes_nothing(RateLimit::new(2.0, 1.0), 0, &script);
        assert_pruning_changes_nothing(RateLimit::new(1.0, 0.5), 0, &script);
    }

    #[test]
    fn automatic_pruning_never_changes_a_decision_even_when_time_goes_backwards() {
        use Step::*;
        // The noise agents push the bucket map past the threshold; a new
        // agent at tick 3 then triggers an automatic prune of all of them.
        let script = [
            Submit("trigger", 3),
            Submit("noise-0", 0),
            Submit("noise-0", 0),
            Submit("noise-0", 1),
            Submit("noise-1", 2),
            Submit("trigger", 0),
            Submit("noise-2", 7),
            Submit("noise-2", 4),
        ];
        assert_pruning_changes_nothing(RateLimit::new(2.0, 1.0), MIN_PRUNE_AT, &script);
    }

    #[test]
    fn automatic_pruning_runs_in_the_twin_test() {
        // Guard for the test above: the noise really does trigger a prune.
        let mut a = Admission::new(usize::MAX, RateLimit::new(2.0, 1.0));
        for i in 0..MIN_PRUNE_AT {
            let name = format!("noise-{i}");
            while a.submit(intent_for(&name, 0, Priority::Bulk), 0).is_ok() {}
        }
        assert_eq!(a.tracked_agents(), MIN_PRUNE_AT);
        a.submit(intent_for("trigger", 0, Priority::Normal), 3)
            .unwrap();
        assert_eq!(a.tracked_agents(), 1, "only the trigger is left");
    }

    #[test]
    fn rate_limit_rejects_parameters_that_never_admit() {
        // A bucket that cannot hold a whole token would rate-limit forever.
        assert_eq!(
            RateLimit::try_new(0.5, 1.0).unwrap_err(),
            InvalidRateLimit::Burst(0.5)
        );
        assert!(RateLimit::try_new(f64::NAN, 1.0).is_err());
        assert!(RateLimit::try_new(f64::INFINITY, 1.0).is_err());
        assert_eq!(
            RateLimit::try_new(4.0, -1.0).unwrap_err(),
            InvalidRateLimit::Refill(-1.0)
        );
        assert!(RateLimit::try_new(4.0, f64::NAN).is_err());
        // Boundary values are fine: one token, no refill.
        assert!(RateLimit::try_new(1.0, 0.0).is_ok());
    }

    #[test]
    #[should_panic(expected = "burst must be finite and >= 1.0")]
    fn admission_rejects_a_hand_built_invalid_limit() {
        let limit = RateLimit {
            burst: 0.0,
            refill_per_tick: 1.0,
        };
        let _ = Admission::new(8, limit);
    }

    #[test]
    fn the_queue_can_be_walked_in_order_and_taken_from_anywhere() {
        let mut a = Admission::new(3, RateLimit::new(100.0, 0.0));
        a.submit(intent_for("x", 0, Priority::Normal), 0).unwrap();
        a.submit(intent_for("x", 1, Priority::Pager), 0).unwrap();
        a.submit(intent_for("x", 2, Priority::Normal), 0).unwrap();
        assert!(a.is_full());
        let order: Vec<u64> = a.waiting().map(|i| i.id).collect();
        assert_eq!(order, [1, 0, 2]);

        let keys = a.queued_keys();
        assert_eq!(a.get(&keys[1]).unwrap().id, 0);
        // Take from the middle; the rest keep their order and positions.
        assert_eq!(a.take(&keys[1]).unwrap().id, 0);
        assert!(a.get(&keys[1]).is_none());
        assert!(a.take(&keys[1]).is_none());
        assert!(!a.is_full());
        assert_eq!(a.waiting().map(|i| i.id).collect::<Vec<_>>(), [1, 2]);
        assert_eq!(a.get(&keys[2]).unwrap().id, 2);
        // A new submission joins the back of its priority class.
        a.submit(intent_for("x", 3, Priority::Normal), 0).unwrap();
        assert_eq!(a.waiting().map(|i| i.id).collect::<Vec<_>>(), [1, 2, 3]);
        assert_eq!(a.dequeue().unwrap().id, 1);
    }

    #[test]
    fn requeue_skips_the_rate_limit_but_not_capacity() {
        let mut a = Admission::new(2, RateLimit::new(1.0, 0.0));
        a.submit(intent_for("x", 0, Priority::Normal), 0).unwrap();
        // x's only token is spent, but a requeue does not need one.
        assert_eq!(a.requeue(intent_for("x", 1, Priority::Normal), 0), Ok(()));
        assert_eq!(
            a.requeue(intent_for("x", 2, Priority::Normal), 0),
            Err(Rejected::Backpressure)
        );
        // It joined the back of its class.
        assert_eq!(a.waiting().map(|i| i.id).collect::<Vec<_>>(), [0, 1]);
        // And the clock still advances.
        a.dequeue();
        a.requeue(intent_for("x", 3, Priority::Normal), 9).unwrap();
        assert_eq!(a.clock(), 9);
    }

    #[test]
    fn limits_are_per_agent() {
        let mut a = Admission::new(1_000, RateLimit::new(1.0, 0.0));
        assert_eq!(a.submit(intent_for("x", 0, Priority::Normal), 0), Ok(()));
        // x is spent, but y has its own bucket.
        assert_eq!(
            a.submit(intent_for("x", 1, Priority::Normal), 0),
            Err(Rejected::RateLimited)
        );
        assert_eq!(a.submit(intent_for("y", 0, Priority::Normal), 0), Ok(()));
    }

    #[test]
    fn backpressure_when_full() {
        // capacity 2, generous rate limit.
        let mut a = Admission::new(2, RateLimit::new(100.0, 0.0));
        assert_eq!(a.submit(intent_for("x", 0, Priority::Normal), 0), Ok(()));
        assert_eq!(a.submit(intent_for("x", 1, Priority::Normal), 0), Ok(()));
        assert_eq!(
            a.submit(intent_for("x", 2, Priority::Normal), 0),
            Err(Rejected::Backpressure)
        );
    }

    #[test]
    fn dequeue_is_priority_then_fifo() {
        let mut a = Admission::new(1_000, RateLimit::new(100.0, 0.0));
        // Submit out of priority order, with two at the same priority.
        a.submit(intent_for("x", 0, Priority::Normal), 0).unwrap();
        a.submit(intent_for("x", 1, Priority::Pager), 0).unwrap();
        a.submit(intent_for("x", 2, Priority::Normal), 0).unwrap();
        a.submit(intent_for("x", 3, Priority::Bulk), 0).unwrap();
        // Pager first.
        assert_eq!(a.dequeue().unwrap().id, 1);
        // Then the two Normals, in submission order (FIFO).
        assert_eq!(a.dequeue().unwrap().id, 0);
        assert_eq!(a.dequeue().unwrap().id, 2);
        // Bulk last.
        assert_eq!(a.dequeue().unwrap().id, 3);
        assert!(a.dequeue().is_none());
    }
}
