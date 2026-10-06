//! The hold queue for deferred intents.
//!
//! A [`Verdict::Defer`](crate::Verdict::Defer) means "not wrong, just not
//! yet": a resource off the allowlist, a freeze, or a conflict with another
//! agent's change. Instead of dropping the intent, the plane holds it here
//! until a human acts on it:
//!
//! - [`Floodwall::release`](crate::Floodwall::release) sends it back to the
//!   queue. On its next evaluation its deferrals are waived, because a human
//!   has said "now"; rejections and scheduling still apply.
//! - [`Floodwall::expire`](crate::Floodwall::expire) drops it.
//!
//! Held intents also expire on their own once they have been held for the
//! configured TTL, and the oldest is evicted when the hold queue is full.
//! Every release and expiry is recorded in the ledger.

use std::collections::{BTreeMap, HashMap};
use std::fmt;

use crate::intent::{Intent, IntentKey};

/// The hold queue capacity used by [`HoldConfig::default`].
pub const DEFAULT_HOLD_CAPACITY: usize = 1024;

/// How many deferred intents to hold, and for how long.
///
/// ```
/// use floodwall::HoldConfig;
///
/// let config = HoldConfig::default().with_capacity(256).with_ttl(Some(500));
/// assert_eq!(config.capacity(), 256);
/// assert_eq!(config.ttl(), Some(500));
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HoldConfig {
    capacity: usize,
    ttl: Option<u64>,
}

impl Default for HoldConfig {
    /// Hold up to [`DEFAULT_HOLD_CAPACITY`] intents, with no TTL.
    fn default() -> Self {
        Self {
            capacity: DEFAULT_HOLD_CAPACITY,
            ttl: None,
        }
    }
}

impl HoldConfig {
    /// Hold at most `capacity` intents; when a new one is deferred into a
    /// full hold, the oldest is evicted. `0` holds nothing: a deferred
    /// intent is expired as soon as it is deferred.
    pub fn with_capacity(mut self, capacity: usize) -> Self {
        self.capacity = capacity;
        self
    }

    /// Expire a held intent once it has been held for `ttl` ticks, or never
    /// with `None`. Expiry happens at the start of each
    /// [`Floodwall::tick`](crate::Floodwall::tick).
    pub fn with_ttl(mut self, ttl: Option<u64>) -> Self {
        self.ttl = ttl;
        self
    }

    /// The most intents the hold keeps.
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// How long an intent may stay held, in ticks.
    pub fn ttl(&self) -> Option<u64> {
        self.ttl
    }
}

/// A deferred intent waiting for a human.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Held {
    /// The intent.
    pub intent: Intent,
    /// The tick it was deferred.
    pub since: u64,
    /// Why it was deferred.
    pub reason: String,
}

/// Why a [`Floodwall::release`](crate::Floodwall::release) or
/// [`Floodwall::expire`](crate::Floodwall::expire) did nothing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HoldError {
    /// The intent is not held: it was never deferred, or has already been
    /// released or expired.
    NotHeld(IntentKey),
    /// The admission queue is full, so the intent cannot go back to it yet.
    /// It stays held; try again later.
    Backpressure(IntentKey),
}

impl fmt::Display for HoldError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HoldError::NotHeld(key) => write!(f, "intent {key} is not held"),
            HoldError::Backpressure(key) => {
                write!(f, "intent {key} stays held: the admission queue is full")
            }
        }
    }
}

impl std::error::Error for HoldError {}

/// Held intents, oldest first.
#[derive(Debug, Default)]
pub(crate) struct Hold {
    config: HoldConfig,
    /// By hold order. Since the plane's clock never moves backwards, `since`
    /// never decreases along this order.
    entries: BTreeMap<u64, Held>,
    index: HashMap<IntentKey, u64>,
    next: u64,
}

impl Hold {
    pub(crate) fn new(config: HoldConfig) -> Self {
        Self {
            config,
            ..Self::default()
        }
    }

    pub(crate) fn config(&self) -> &HoldConfig {
        &self.config
    }

    /// Replace the configuration. A lower capacity takes effect at the next
    /// [`Hold::trim`], and a lower TTL at the next [`Hold::expire_due`].
    pub(crate) fn set_config(&mut self, config: HoldConfig) {
        self.config = config;
    }

    /// Hold a deferred intent. Returns whatever had to be evicted to stay
    /// within capacity, oldest first; with capacity 0 that is the intent
    /// itself.
    pub(crate) fn put(&mut self, intent: Intent, reason: String, now: u64) -> Vec<Held> {
        let key = intent.key();
        debug_assert!(!self.index.contains_key(&key), "an intent was held twice");
        let slot = self.next;
        self.next += 1;
        self.index.insert(key, slot);
        self.entries.insert(
            slot,
            Held {
                intent,
                since: now,
                reason,
            },
        );
        self.trim()
    }

    /// Evict the oldest held intents until the hold is within capacity.
    pub(crate) fn trim(&mut self) -> Vec<Held> {
        let mut evicted = Vec::new();
        while self.entries.len() > self.config.capacity {
            let (_, held) = self
                .entries
                .pop_first()
                .expect("over capacity, so not empty");
            self.index.remove(&held.intent.key());
            evicted.push(held);
        }
        evicted
    }

    /// Remove and return a held intent.
    pub(crate) fn take(&mut self, key: &IntentKey) -> Option<Held> {
        let slot = self.index.remove(key)?;
        self.entries.remove(&slot)
    }

    pub(crate) fn contains(&self, key: &IntentKey) -> bool {
        self.index.contains_key(key)
    }

    /// Remove and return everything whose TTL has run out by tick `now`,
    /// oldest first.
    pub(crate) fn expire_due(&mut self, now: u64) -> Vec<Held> {
        let mut expired = Vec::new();
        if let Some(ttl) = self.config.ttl {
            while let Some(entry) = self.entries.first_entry() {
                if now < entry.get().since.saturating_add(ttl) {
                    break; // later entries were held no earlier
                }
                let held = entry.remove();
                self.index.remove(&held.intent.key());
                expired.push(held);
            }
        }
        expired
    }

    /// Everything held, oldest first.
    pub(crate) fn iter(&self) -> impl Iterator<Item = &Held> {
        self.entries.values()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{Action, AgentId, BlastRadius, Priority};

    fn intent(id: u64) -> Intent {
        Intent::new(
            id,
            AgentId::new("bot"),
            Action::Destroy {
                resource: "web".into(),
            },
            Priority::Normal,
            BlastRadius::Cell,
        )
    }

    fn ids<'a>(held: impl IntoIterator<Item = &'a Held>) -> Vec<u64> {
        held.into_iter().map(|h| h.intent.id).collect()
    }

    #[test]
    fn holds_in_order_and_takes_from_anywhere() {
        let mut h = Hold::new(HoldConfig::default());
        for id in 0..3 {
            assert!(h.put(intent(id), format!("r{id}"), id).is_empty());
        }
        assert_eq!(ids(h.iter()), [0, 1, 2]);
        let key = IntentKey::new("bot", 1);
        assert!(h.contains(&key));
        let taken = h.take(&key).unwrap();
        assert_eq!((taken.since, taken.reason.as_str()), (1, "r1"));
        assert!(!h.contains(&key));
        assert!(h.take(&key).is_none());
        assert_eq!(ids(h.iter()), [0, 2]);
        assert_eq!(h.entries.len(), 2);
    }

    #[test]
    fn a_full_hold_evicts_the_oldest() {
        let mut h = Hold::new(HoldConfig::default().with_capacity(2));
        h.put(intent(0), "r".into(), 0);
        h.put(intent(1), "r".into(), 0);
        let evicted = h.put(intent(2), "r".into(), 1);
        assert_eq!(ids(&evicted), [0]);
        assert_eq!(ids(h.iter()), [1, 2]);
        assert!(!h.contains(&IntentKey::new("bot", 0)));
    }

    #[test]
    fn capacity_zero_holds_nothing() {
        let mut h = Hold::new(HoldConfig::default().with_capacity(0));
        let evicted = h.put(intent(7), "r".into(), 3);
        assert_eq!(ids(&evicted), [7]);
        assert_eq!(h.entries.len(), 0);
        assert!(!h.contains(&IntentKey::new("bot", 7)));
    }

    #[test]
    fn ttl_expires_in_hold_order() {
        let mut h = Hold::new(HoldConfig::default().with_ttl(Some(10)));
        h.put(intent(0), "r".into(), 0);
        h.put(intent(1), "r".into(), 5);
        h.put(intent(2), "r".into(), 5);
        assert!(h.expire_due(9).is_empty());
        assert_eq!(ids(&h.expire_due(10)), [0]);
        assert!(h.expire_due(14).is_empty());
        assert_eq!(ids(&h.expire_due(15)), [1, 2]);
        assert_eq!(h.entries.len(), 0);
        assert!(h.index.is_empty());
    }

    #[test]
    fn no_ttl_never_expires_and_a_huge_ttl_does_not_overflow() {
        let mut h = Hold::new(HoldConfig::default());
        h.put(intent(0), "r".into(), 0);
        assert!(h.expire_due(u64::MAX).is_empty());
        h.set_config(HoldConfig::default().with_ttl(Some(u64::MAX)));
        assert!(h.expire_due(u64::MAX - 1).is_empty());
        assert_eq!(ids(&h.expire_due(u64::MAX)), [0]);
    }

    #[test]
    fn lowering_capacity_evicts_at_the_next_trim() {
        let mut h = Hold::new(HoldConfig::default());
        for id in 0..4 {
            h.put(intent(id), "r".into(), 0);
        }
        h.set_config(HoldConfig::default().with_capacity(1));
        assert_eq!(h.config().capacity(), 1);
        assert!(h.expire_due(0).is_empty(), "no TTL");
        assert_eq!(ids(&h.trim()), [0, 1, 2]);
        assert_eq!(ids(h.iter()), [3]);
    }

    #[test]
    fn errors_say_what_happened() {
        let key = IntentKey::new("bot", 3);
        assert_eq!(
            HoldError::NotHeld(key.clone()).to_string(),
            "intent bot#3 is not held"
        );
        assert_eq!(
            HoldError::Backpressure(key).to_string(),
            "intent bot#3 stays held: the admission queue is full"
        );
    }
}
