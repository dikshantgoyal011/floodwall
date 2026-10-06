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

use std::collections::BTreeMap;

use crate::intent::{Intent, IntentKey};

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
    #[expect(
        dead_code,
        reason = "the blast-radius rules (FW-202) are the first to block"
    )]
    Blocked,
}

/// What blocked intents have claimed so far in one pass. Empty for now;
/// later rules use it so lower-priority work cannot overtake them.
#[derive(Debug, Default)]
pub(crate) struct Pass {}

/// In-flight bookkeeping and the rules for what may run together.
#[derive(Debug, Default)]
pub(crate) struct Scheduler {
    in_flight: BTreeMap<IntentKey, InFlight>,
}

impl Scheduler {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Start a pass over the queue.
    pub(crate) fn begin(&self) -> Pass {
        Pass::default()
    }

    /// Whether `intent` may go to the gate now.
    pub(crate) fn readiness(&self, _intent: &Intent, _pass: &Pass) -> Readiness {
        Readiness::Ready
    }

    /// Record that `intent` was blocked in this pass.
    pub(crate) fn wait(&self, _intent: &Intent, _pass: &mut Pass) {}

    /// Dispatch an intent the gate admitted at tick `now`.
    pub(crate) fn start(&mut self, intent: Intent, now: u64) {
        let key = intent.key();
        let previous = self.in_flight.insert(key, InFlight { intent, since: now });
        debug_assert!(previous.is_none(), "an intent was dispatched twice");
    }

    /// The caller finished applying an intent at tick `now`. Returns it, or
    /// `None` if it was not in flight.
    pub(crate) fn finish(&mut self, key: &IntentKey, _now: u64) -> Option<InFlight> {
        self.in_flight.remove(key)
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
