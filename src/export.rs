//! A plain-text export of the ledger, so auditors can verify it with their
//! own tooling.
//!
//! [`Ledger::export_jsonl`] writes [JSON Lines](https://jsonlines.org): one
//! JSON object per line, UTF-8, `\n` line endings, with exactly the keys
//! shown below. Every object has a `"type"`. Digests, signatures and keys
//! are lowercase hex. Integers that can exceed 2^53 (and so are not exact in
//! every JSON parser) are written as decimal strings; counts and replica
//! numbers are plain numbers.
//!
//! **Header**, always the first line:
//!
//! ```text
//! {"type":"header","format":"floodwall-ledger","version":1,"from":0,
//!  "hash":"sha256","merkle":"rfc6962","record_encoding":"floodwall/ledger/record/v2",
//!  "intent_encoding":"floodwall/intent/v1","checkpoint_encoding":"floodwall/checkpoint/v1"}
//! ```
//!
//! `from` is how many records precede the export: 0 for a whole ledger, or
//! the size of the checkpoint a suffix export starts from.
//!
//! **Record**, one per ledger record, in order (fields as in [`Record`]):
//!
//! ```text
//! {"type":"record","seq":0,"intent_id":"7","agent":"deployer","verdict":"admit",
//!  "action":"apply web","reason":"..."|null,"policies":[["name","label"],...],
//!  "intent":<intent>|null,"prev":"<hex>","digest":"<hex>"}
//! ```
//!
//! `intent` is the intent the record is about, as its agent signed it:
//!
//! ```text
//! {"id":"7","agent":"deployer",
//!  "action":{"kind":"apply","resource":"web","manifest":"v2"}
//!          |{"kind":"scale","resource":"web","replicas":5}
//!          |{"kind":"destroy","resource":"web"},
//!  "priority":"bulk"|"normal"|"urgent"|"pager",
//!  "blast_radius":"cell"|"service"|"region"|"global",
//!  "signature":"<hex>"|null}
//! ```
//!
//! A record with an intent must agree with it: the same `intent_id` (its
//! `id`) and `agent`, and an `action` that is its action's summary:
//! `apply <resource>`, `scale <resource> to <replicas>` or
//! `destroy <resource>`. The record digest covers the intent's digest and
//! signature (see [`crate::ledger`]).
//!
//! **Checkpoint**, placed right after the record that completes it (a
//! checkpoint of size 0 right after the header), fields as in
//! [`Checkpoint`]:
//!
//! ```text
//! {"type":"checkpoint","size":4,"head":"<hex>","root":"<hex>",
//!  "frontier":["<hex>",...],"signature":"<hex>"|null}
//! ```
//!
//! Checkpoint sizes strictly increase through a file. A suffix export
//! ([`Ledger::export_jsonl_from`]) starts with the trusted checkpoint, then
//! the records after it, so a verifier starts from that checkpoint's head
//! and frontier instead of from genesis.
//!
//! With the record, intent and checkpoint encodings documented in
//! [`crate::ledger`], [`crate::Intent`] and [`Checkpoint::digest`], this is
//! everything needed to recompute and check every digest, link, Merkle root
//! and signature, and that every record shows what its agent signed.
//! `tools/verify-ledger.mjs` in the repository does so with nothing but
//! Node's standard library.

use std::io::{self, Write};

use crate::checkpoint::Checkpoint;
use crate::ed25519::VerifyingKey;
use crate::intent::{Action, BlastRadius, Intent, Priority};
use crate::keyring::Keyring;
use crate::ledger::{Digest, Ledger, Record};
use crate::merkle::Frontier;

/// The `format` named in the header.
pub const FORMAT: &str = "floodwall-ledger";
/// The `version` named in the header.
pub const VERSION: u64 = 1;

/// Write `s` as a JSON string: quotes and backslashes escaped, control
/// characters as escapes, everything else as UTF-8.
fn json_str(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn json_opt_str(out: &mut String, s: Option<&str>) {
    match s {
        Some(s) => json_str(out, s),
        None => out.push_str("null"),
    }
}

fn header(from: u64) -> String {
    format!(
        "{{\"type\":\"header\",\"format\":\"{FORMAT}\",\"version\":{VERSION},\"from\":{from},\
         \"hash\":\"sha256\",\"merkle\":\"rfc6962\",\
         \"record_encoding\":\"floodwall/ledger/record/v2\",\
         \"intent_encoding\":\"floodwall/intent/v1\",\
         \"checkpoint_encoding\":\"floodwall/checkpoint/v1\"}}"
    )
}

fn intent_json(s: &mut String, i: &Intent) {
    s.push_str(&format!("{{\"id\":\"{}\",\"agent\":", i.id));
    json_str(s, i.agent.as_str());
    s.push_str(",\"action\":{\"kind\":");
    match &i.action {
        Action::Apply { resource, manifest } => {
            s.push_str("\"apply\",\"resource\":");
            json_str(s, resource);
            s.push_str(",\"manifest\":");
            json_str(s, manifest);
        }
        Action::Scale { resource, replicas } => {
            s.push_str("\"scale\",\"resource\":");
            json_str(s, resource);
            s.push_str(&format!(",\"replicas\":{replicas}"));
        }
        Action::Destroy { resource } => {
            s.push_str("\"destroy\",\"resource\":");
            json_str(s, resource);
        }
    }
    let priority = match i.priority {
        Priority::Bulk => "bulk",
        Priority::Normal => "normal",
        Priority::Urgent => "urgent",
        Priority::Pager => "pager",
    };
    let blast = match i.blast_radius {
        BlastRadius::Cell => "cell",
        BlastRadius::Service => "service",
        BlastRadius::Region => "region",
        BlastRadius::Global => "global",
    };
    s.push_str(&format!(
        "}},\"priority\":\"{priority}\",\"blast_radius\":\"{blast}\",\"signature\":"
    ));
    json_opt_str(s, i.signature.map(|sig| sig.to_string()).as_deref());
    s.push('}');
}

fn record_line(r: &Record) -> String {
    let mut s = format!(
        "{{\"type\":\"record\",\"seq\":{},\"intent_id\":\"{}\",\"agent\":",
        r.seq, r.intent_id
    );
    json_str(&mut s, &r.agent);
    s.push_str(",\"verdict\":");
    json_str(&mut s, &r.verdict);
    s.push_str(",\"action\":");
    json_str(&mut s, &r.evidence.action);
    s.push_str(",\"reason\":");
    json_opt_str(&mut s, r.evidence.reason.as_deref());
    s.push_str(",\"policies\":[");
    for (i, (name, label)) in r.evidence.policies.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push('[');
        json_str(&mut s, name);
        s.push(',');
        json_str(&mut s, label);
        s.push(']');
    }
    s.push_str("],\"intent\":");
    match &r.intent {
        Some(i) => intent_json(&mut s, i),
        None => s.push_str("null"),
    }
    s.push_str(&format!(
        ",\"prev\":\"{}\",\"digest\":\"{}\"}}",
        r.prev, r.digest
    ));
    s
}

fn checkpoint_line(c: &Checkpoint) -> String {
    let frontier: Vec<String> = c.frontier.iter().map(|d| format!("\"{d}\"")).collect();
    let mut s = format!(
        "{{\"type\":\"checkpoint\",\"size\":{},\"head\":\"{}\",\"root\":\"{}\",\"frontier\":[{}],\"signature\":",
        c.size,
        c.head,
        c.root,
        frontier.join(",")
    );
    json_opt_str(&mut s, c.signature.map(|sig| sig.to_string()).as_deref());
    s.push('}');
    s
}

impl Ledger {
    /// Write the whole ledger as JSON Lines (see [`crate::export`]): a
    /// header, then every record, with each checkpoint after the record
    /// that completes it.
    pub fn export_jsonl<W: Write>(&self, out: &mut W) -> io::Result<()> {
        writeln!(out, "{}", header(0))?;
        self.write_from(0, false, out)
    }

    /// Write what follows `from` as JSON Lines: a header, `from` itself,
    /// then the records after it and the checkpoints among them. An auditor
    /// who trusts `from` verifies this without any earlier record.
    ///
    /// Fails with [`io::ErrorKind::InvalidInput`] unless `from` matches this
    /// ledger: no larger than it, ending at the record it claims, and with
    /// the Merkle root and frontier of the records it covers.
    pub fn export_jsonl_from<W: Write>(&self, from: &Checkpoint, out: &mut W) -> io::Result<()> {
        if !self.matches(from) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the checkpoint does not match this ledger",
            ));
        }
        writeln!(out, "{}", header(from.size))?;
        writeln!(out, "{}", checkpoint_line(from))?;
        self.write_from(from.size, true, out)
    }

    /// Records from `start` on, with the stored checkpoints among them. A
    /// checkpoint at `start` itself is written only when the export is not
    /// already anchored there (a whole-ledger export's genesis checkpoint),
    /// so no checkpoint is ever written twice.
    fn write_from<W: Write>(&self, start: u64, anchored: bool, out: &mut W) -> io::Result<()> {
        let mut checkpoints = self
            .checkpoints()
            .iter()
            .filter(|c| c.size > start || (!anchored && c.size == start))
            .peekable();
        while let Some(c) = checkpoints.next_if(|c| c.size == start) {
            writeln!(out, "{}", checkpoint_line(c))?;
        }
        let start = usize::try_from(start).map_err(|_| io::ErrorKind::InvalidInput)?;
        for r in self.records().get(start..).unwrap_or_default() {
            writeln!(out, "{}", record_line(r))?;
            while let Some(c) = checkpoints.next_if(|c| c.size == r.seq + 1) {
                writeln!(out, "{}", checkpoint_line(c))?;
            }
        }
        Ok(())
    }

    /// Whether `c` describes this ledger at `c.size` records.
    fn matches(&self, c: &Checkpoint) -> bool {
        let Some(records) = usize::try_from(c.size)
            .ok()
            .and_then(|n| self.records().get(..n))
        else {
            return false;
        };
        let head = records.last().map_or(Digest::GENESIS, |r| r.digest);
        let mut frontier = Frontier::new();
        for r in records {
            frontier.push(&r.digest);
        }
        c.head == head && c.root == frontier.root() && c.frontier == frontier.peaks()
    }
}

/// The public keys an auditor needs, as JSON: the plane's checkpoint key
/// (or `null`), each agent's current key, and any retired keys (see
/// [`Keyring::with_retired`]).
///
/// ```text
/// {"plane":"<hex>"|null,"agents":{"deployer":"<hex>",...},
///  "retired":{"deployer":["<hex>",...],...}}
/// ```
///
/// Hand it to auditors separately from the export: keys taken from the
/// same place as the ledger prove nothing about it.
pub fn keys_json(keyring: &Keyring, plane: Option<&VerifyingKey>) -> String {
    let mut s = String::from("{\"plane\":");
    json_opt_str(&mut s, plane.map(|k| k.to_string()).as_deref());
    s.push_str(",\"agents\":{");
    for (i, (agent, key)) in keyring.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        json_str(&mut s, agent.as_str());
        s.push_str(&format!(":\"{key}\""));
    }
    s.push_str("},\"retired\":{");
    for (i, (agent, keys)) in keyring.retired().enumerate() {
        if i > 0 {
            s.push(',');
        }
        json_str(&mut s, agent.as_str());
        let keys: Vec<String> = keys.iter().map(|k| format!("\"{k}\"")).collect();
        s.push_str(&format!(":[{}]", keys.join(",")));
    }
    s.push_str("}}");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ed25519::SigningKey;
    use crate::intent::{Action, AgentId, BlastRadius, Intent, Priority};

    fn export(l: &Ledger) -> String {
        let mut out = Vec::new();
        l.export_jsonl(&mut out).unwrap();
        String::from_utf8(out).unwrap()
    }

    fn types(text: &str) -> Vec<String> {
        text.lines()
            .map(|l| {
                let start = l.find("\"type\":\"").unwrap() + 8;
                l[start..start + l[start..].find('"').unwrap()].to_string()
            })
            .collect()
    }

    #[test]
    fn strings_are_escaped_as_json() {
        let mut s = String::new();
        json_str(&mut s, "a\"b\\c\nd\re\tf\u{1}g\u{7f}é🦀");
        assert_eq!(s, r#""a\"b\\c\nd\re\tf\u0001g"#.to_string() + "\u{7f}é🦀\"");
    }

    #[test]
    fn a_record_line_has_every_field() {
        let key = SigningKey::from_seed(&[7; 32]);
        let intent = Intent::new(
            u64::MAX,
            AgentId::new("depl\"oyer"),
            Action::Apply {
                resource: "web".into(),
                manifest: "v2".into(),
            },
            Priority::Urgent,
            BlastRadius::Service,
        )
        .signed(&key);
        let mut l = Ledger::new();
        l.append_intent(
            &intent,
            "defer",
            Some("line one\nline two".into()),
            vec![
                ("allow".into(), "admit".into()),
                ("conflict-window".into(), "defer".into()),
            ],
        );
        l.append(3, "ops", "released");
        let text = export(&l);
        let lines: Vec<&str> = text.lines().collect();
        let r = &l.records()[0];
        assert_eq!(
            lines[1],
            format!(
                "{{\"type\":\"record\",\"seq\":0,\"intent_id\":\"18446744073709551615\",\
                 \"agent\":\"depl\\\"oyer\",\"verdict\":\"defer\",\"action\":\"apply web\",\
                 \"reason\":\"line one\\nline two\",\
                 \"policies\":[[\"allow\",\"admit\"],[\"conflict-window\",\"defer\"]],\
                 \"intent\":{{\"id\":\"18446744073709551615\",\"agent\":\"depl\\\"oyer\",\
                 \"action\":{{\"kind\":\"apply\",\"resource\":\"web\",\"manifest\":\"v2\"}},\
                 \"priority\":\"urgent\",\"blast_radius\":\"service\",\"signature\":\"{}\"}},\
                 \"prev\":\"{}\",\"digest\":\"{}\"}}",
                intent.signature.unwrap(),
                Digest::GENESIS,
                r.digest
            )
        );
        // Absent values are null, an empty policy list is [].
        assert!(lines[2].contains("\"reason\":null,\"policies\":[],\"intent\":null,"));
        assert!(text.ends_with('\n'));
        assert!(!text.contains('\r'));
    }

    #[test]
    fn an_intent_is_written_as_its_agent_signed_it() {
        let line = |action, priority, blast_radius, key: Option<&SigningKey>| {
            let mut intent = Intent::new(7, AgentId::new("bot"), action, priority, blast_radius);
            if let Some(key) = key {
                intent = intent.signed(key);
            }
            let mut s = String::new();
            intent_json(&mut s, &intent);
            s
        };
        assert_eq!(
            line(
                Action::Scale {
                    resource: "api".into(),
                    replicas: u32::MAX
                },
                Priority::Bulk,
                BlastRadius::Cell,
                None
            ),
            "{\"id\":\"7\",\"agent\":\"bot\",\
             \"action\":{\"kind\":\"scale\",\"resource\":\"api\",\"replicas\":4294967295},\
             \"priority\":\"bulk\",\"blast_radius\":\"cell\",\"signature\":null}"
        );
        assert_eq!(
            line(
                Action::Destroy {
                    resource: "d\"b".into()
                },
                Priority::Pager,
                BlastRadius::Global,
                None
            ),
            "{\"id\":\"7\",\"agent\":\"bot\",\
             \"action\":{\"kind\":\"destroy\",\"resource\":\"d\\\"b\"},\
             \"priority\":\"pager\",\"blast_radius\":\"global\",\"signature\":null}"
        );
        let key = SigningKey::from_seed(&[4; 32]);
        let signed = line(
            Action::Destroy {
                resource: "db".into(),
            },
            Priority::Normal,
            BlastRadius::Region,
            Some(&key),
        );
        assert!(signed.contains("\"priority\":\"normal\",\"blast_radius\":\"region\""));
        assert!(!signed.contains("\"signature\":null"));
    }

    #[test]
    fn checkpoints_follow_the_record_that_completes_them() {
        let plane = SigningKey::from_seed(&[9; 32]);
        let mut l = Ledger::new().with_checkpoints(2).with_signer(plane);
        l.checkpoint(); // size 0
        for i in 0..5 {
            l.append(i, "bot", "admit");
        }
        let text = export(&l);
        assert_eq!(
            types(&text),
            [
                "header",
                "checkpoint",
                "record",
                "record",
                "checkpoint",
                "record",
                "record",
                "checkpoint",
                "record"
            ]
        );
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], header(0));
        assert!(lines[0].contains("\"from\":0"));
        let c = &l.checkpoints()[1];
        assert_eq!(lines[4], checkpoint_line(c));
        assert!(lines[4].starts_with(&format!(
            "{{\"type\":\"checkpoint\",\"size\":2,\"head\":\"{}\"",
            c.head
        )));
        assert!(lines[4].contains(&format!("\"signature\":\"{}\"", c.signature.unwrap())));
    }

    #[test]
    fn a_suffix_export_starts_at_its_checkpoint() {
        let mut l = Ledger::new().with_checkpoints(3);
        for i in 0..8 {
            l.append(i, "bot", "admit");
        }
        let from = l.checkpoints()[0].clone(); // size 3
        let mut out = Vec::new();
        l.export_jsonl_from(&from, &mut out).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert_eq!(
            types(&text),
            [
                "header",
                "checkpoint",
                "record",
                "record",
                "record",
                "checkpoint",
                "record",
                "record"
            ]
        );
        assert!(text.lines().next().unwrap().contains("\"from\":3"));
        assert!(text.lines().nth(2).unwrap().contains("\"seq\":3,"));
        // The size-3 checkpoint is not repeated after the header's.
        assert_eq!(text.matches("\"size\":3,").count(), 1);
    }

    #[test]
    fn a_suffix_export_from_genesis_writes_genesis_once() {
        let mut l = Ledger::new().with_checkpoints(2);
        l.checkpoint(); // size 0, stored
        for i in 0..3 {
            l.append(i, "bot", "admit");
        }
        let genesis = l.checkpoints()[0].clone();
        assert_eq!(genesis.size, 0);
        let mut out = Vec::new();
        l.export_jsonl_from(&genesis, &mut out).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert_eq!(
            types(&text),
            [
                "header",
                "checkpoint",
                "record",
                "record",
                "checkpoint",
                "record"
            ]
        );
        assert_eq!(text.matches("\"size\":0,").count(), 1);
        // The whole-ledger export still carries the stored genesis checkpoint.
        assert_eq!(export(&l).matches("\"size\":0,").count(), 1);
        // With nothing after it, the suffix is just the header and anchor.
        let mut empty = Ledger::new();
        empty.checkpoint();
        let mut out = Vec::new();
        empty
            .export_jsonl_from(&empty.checkpoints()[0].clone(), &mut out)
            .unwrap();
        assert_eq!(
            types(&String::from_utf8(out).unwrap()),
            ["header", "checkpoint"]
        );
    }

    #[test]
    fn a_suffix_export_refuses_a_checkpoint_from_elsewhere() {
        let mut l = Ledger::new().with_checkpoints(2);
        for i in 0..4 {
            l.append(i, "bot", "admit");
        }
        let good = l.checkpoints()[0].clone();
        let bad = |edit: fn(&mut Checkpoint)| {
            let mut c = good.clone();
            edit(&mut c);
            let err = l.export_jsonl_from(&c, &mut Vec::new()).unwrap_err();
            assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        };
        bad(|c| c.size = 9);
        bad(|c| c.head.0[0] ^= 1);
        bad(|c| c.root.0[0] ^= 1);
        bad(|c| c.frontier.clear());
        // A checkpoint cut by someone else but matching is fine, and so is
        // the empty one.
        let mut fresh = Ledger::new();
        fresh.checkpoint();
        assert!(l
            .export_jsonl_from(&fresh.checkpoints()[0], &mut Vec::new())
            .is_ok());
        assert!(l.export_jsonl_from(&good, &mut Vec::new()).is_ok());
    }

    #[test]
    fn an_empty_ledger_exports_just_a_header() {
        assert_eq!(export(&Ledger::new()), format!("{}\n", header(0)));
    }

    #[test]
    fn keys_are_listed_for_auditors() {
        let a = SigningKey::from_seed(&[1; 32]).verifying_key();
        let b = SigningKey::from_seed(&[2; 32]).verifying_key();
        let plane = SigningKey::from_seed(&[3; 32]).verifying_key();
        let ring = Keyring::new().with("b-agent", b).with("a\"agent", a);
        assert_eq!(
            keys_json(&ring, Some(&plane)),
            format!(
                "{{\"plane\":\"{plane}\",\"agents\":{{\"a\\\"agent\":\"{a}\",\"b-agent\":\"{b}\"}},\
                 \"retired\":{{}}}}"
            )
        );
        assert_eq!(
            keys_json(&Keyring::new(), None),
            "{\"plane\":null,\"agents\":{},\"retired\":{}}"
        );
        // Retired keys are listed so an audit spans a rotation.
        let rotated = ring
            .with_retired("b-agent", a)
            .with_retired("b-agent", plane);
        assert!(keys_json(&rotated, None).ends_with(&format!(
            "\"retired\":{{\"b-agent\":[\"{a}\",\"{plane}\"]}}}}"
        )));
    }
}
