//! A plain-text export of the ledger, so auditors can verify it with their
//! own tooling.
//!
//! [`Ledger::export_jsonl`] writes [JSON Lines](https://jsonlines.org): one
//! JSON object per line, UTF-8, `\n` line endings, with exactly the keys
//! shown below. Every object has a `"type"`. Digests, signatures and keys
//! are lowercase hex. Integers that can exceed 2^53 (and so are not exact in
//! every JSON parser), like intent ids and ticks, are written as decimal
//! strings; counts and replica numbers are plain numbers.
//!
//! **Header**, always the first line:
//!
//! ```text
//! {"type":"header","format":"floodwall-ledger","version":1,"from":0,
//!  "hash":"sha256","merkle":"rfc6962","record_encoding":"floodwall/ledger/record/v3",
//!  "intent_encoding":"floodwall/intent/v1","checkpoint_encoding":"floodwall/checkpoint/v1"}
//! ```
//!
//! `from` is how many records precede the export: 0 for a whole ledger, or
//! the size of the checkpoint a suffix export starts from.
//!
//! **Record**, one per ledger record, in order (fields as in [`Record`]):
//!
//! ```text
//! {"type":"record","seq":0,"tick":"12","intent_id":"7","agent":"deployer",
//!  "verdict":"admit","action":"apply web","reason":"..."|null,
//!  "policies":[["name","label"],...],"intent":<intent>|null,
//!  "prev":"<hex>","digest":"<hex>"}
//! ```
//!
//! `tick` is the logical tick the record was written at; ticks never
//! decrease from one record to the next (see [`crate::ledger`]).
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
//!
//! **Reading it back.** [`Ledger::read_jsonl`] reads a whole-ledger export
//! back into a ledger, checking it from genesis. A ledger kept on disk
//! ([`crate::durable`]) is this same file, written as it grows. Reading
//! accepts exactly what this module writes, byte for byte: each line is
//! written out again from what was read and must come out the same, so
//! other spacing, key orders, escapes, number forms or duplicate keys are
//! refused, and no line can mean two things to two readers.

use std::io::{self, Write};

use crate::checkpoint::Checkpoint;
use crate::ed25519::{Signature, VerifyingKey};
use crate::intent::{Action, AgentId, BlastRadius, Intent, Priority};
use crate::json::{self, Value};
use crate::keyring::Keyring;
use crate::ledger::{Digest, Evidence, Ledger, Record};
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

pub(crate) fn header(from: u64) -> String {
    format!(
        "{{\"type\":\"header\",\"format\":\"{FORMAT}\",\"version\":{VERSION},\"from\":{from},\
         \"hash\":\"sha256\",\"merkle\":\"rfc6962\",\
         \"record_encoding\":\"floodwall/ledger/record/v3\",\
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

pub(crate) fn record_line(r: &Record) -> String {
    let mut s = format!(
        "{{\"type\":\"record\",\"seq\":{},\"tick\":\"{}\",\"intent_id\":\"{}\",\"agent\":",
        r.seq, r.tick, r.intent_id
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

pub(crate) fn checkpoint_line(c: &Checkpoint) -> String {
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

/// One line of an export, read back by [`read_line`].
#[derive(Debug)]
pub(crate) enum Line {
    Header { from: u64 },
    Record(Record),
    Checkpoint(Checkpoint),
}

/// Read one line of an export (without its `\n`) back: a header, a record
/// or a checkpoint, exactly as this module writes them. Anything else is
/// refused, including JSON that means the same but is spelled differently
/// (other spacing, key order, escapes or number forms), so a line can only
/// ever be read one way. This checks the line's form; whether a record or
/// checkpoint fits the ledger is checked by the caller.
pub(crate) fn read_line(line: &str) -> Result<Line, String> {
    let value = json::parse(line).map_err(|e| format!("not JSON this reader accepts: {e}"))?;
    let kind = match &value {
        Value::Object(fields) => match fields.first() {
            Some((key, Value::String(kind))) if key == "type" => kind.as_str(),
            _ => "",
        },
        _ => "",
    };
    let (read, written) = match kind {
        "header" => {
            let from = read_header(&value)?;
            (Line::Header { from }, header(from))
        }
        "record" => {
            let r = read_record(&value)?;
            let written = record_line(&r);
            (Line::Record(r), written)
        }
        "checkpoint" => {
            let c = read_checkpoint(&value)?;
            let written = checkpoint_line(&c);
            (Line::Checkpoint(c), written)
        }
        _ => return Err("not a header, record or checkpoint line".into()),
    };
    if written != line {
        return Err(
            "the line is not written as floodwall writes it (spacing, key order, escapes or number forms)"
                .into(),
        );
    }
    Ok(read)
}

/// The values of an object that has exactly the fields `names`, in order.
fn fields<'a>(value: &'a Value, names: &[&str], what: &str) -> Result<Vec<&'a Value>, String> {
    let Value::Object(fields) = value else {
        return Err(format!("{what} is {}, not an object", value.kind()));
    };
    if let Some((key, _)) = fields
        .iter()
        .find(|(key, _)| !names.contains(&key.as_str()))
    {
        return Err(format!("{what} has an unknown field {key:?}"));
    }
    if let Some(name) = names
        .iter()
        .find(|n| !fields.iter().any(|(key, _)| key == *n))
    {
        return Err(format!("{what} has no {name:?}"));
    }
    if !fields
        .iter()
        .map(|(key, _)| key.as_str())
        .eq(names.iter().copied())
    {
        return Err(format!(
            "{what} does not have its fields in the documented order"
        ));
    }
    Ok(fields.iter().map(|(_, v)| v).collect())
}

fn string<'a>(value: &'a Value, what: &str) -> Result<&'a str, String> {
    match value {
        Value::String(s) => Ok(s),
        other => Err(format!("{what} is {}, not a string", other.kind())),
    }
}

fn opt_string(value: &Value, what: &str) -> Result<Option<String>, String> {
    match value {
        Value::Null => Ok(None),
        other => string(other, what).map(|s| Some(s.to_string())),
    }
}

fn number(value: &Value, what: &str) -> Result<u64, String> {
    match value {
        Value::Number(n) => Ok(*n),
        other => Err(format!("{what} is {}, not a number", other.kind())),
    }
}

/// A `u64` written as a decimal string, the way `intent_id` is.
fn decimal(value: &Value, what: &str) -> Result<u64, String> {
    let s = string(value, what)?;
    let canonical = s == "0" || (!s.starts_with('0') && s.bytes().all(|b| b.is_ascii_digit()));
    match s.parse::<u64>() {
        Ok(n) if canonical => Ok(n),
        _ => Err(format!("{what} is not a u64 written as a decimal string")),
    }
}

/// `N` bytes written as lowercase hex.
fn hex<const N: usize>(value: &Value, what: &str) -> Result<[u8; N], String> {
    let s = string(value, what)?;
    let digit = |b: u8| match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; N];
    if s.len() != 2 * N {
        return Err(format!("{what} is not {N} bytes of lowercase hex"));
    }
    for (byte, pair) in out.iter_mut().zip(s.as_bytes().chunks(2)) {
        match (digit(pair[0]), digit(pair[1])) {
            (Some(hi), Some(lo)) => *byte = (hi << 4) | lo,
            _ => return Err(format!("{what} is not {N} bytes of lowercase hex")),
        }
    }
    Ok(out)
}

fn signature(value: &Value, what: &str) -> Result<Option<Signature>, String> {
    match value {
        Value::Null => Ok(None),
        other => hex::<64>(other, what).map(|b| Some(Signature(b))),
    }
}

fn read_header(value: &Value) -> Result<u64, String> {
    let f = fields(
        value,
        &[
            "type",
            "format",
            "version",
            "from",
            "hash",
            "merkle",
            "record_encoding",
            "intent_encoding",
            "checkpoint_encoding",
        ],
        "the header",
    )?;
    let format = string(f[1], "format")?;
    let version = number(f[2], "version")?;
    if format != FORMAT || version != VERSION {
        return Err(format!("unsupported format {format:?} version {version}"));
    }
    let from = number(f[3], "from")?;
    for (value, name, expected) in [
        (f[4], "hash", "sha256"),
        (f[5], "merkle", "rfc6962"),
        (f[6], "record_encoding", "floodwall/ledger/record/v3"),
        (f[7], "intent_encoding", "floodwall/intent/v1"),
        (f[8], "checkpoint_encoding", "floodwall/checkpoint/v1"),
    ] {
        let got = string(value, name)?;
        if got != expected {
            return Err(format!("unsupported {name} {got:?}, not {expected:?}"));
        }
    }
    Ok(from)
}

fn read_intent(value: &Value) -> Result<Intent, String> {
    let f = fields(
        value,
        &[
            "id",
            "agent",
            "action",
            "priority",
            "blast_radius",
            "signature",
        ],
        "intent",
    )?;
    let kind = match f[2] {
        Value::Object(fields) => match fields.first() {
            Some((key, Value::String(kind))) if key == "kind" => kind.as_str(),
            _ => "",
        },
        _ => "",
    };
    let action = match kind {
        "apply" => {
            let a = fields(f[2], &["kind", "resource", "manifest"], "intent.action")?;
            Action::Apply {
                resource: string(a[1], "intent.action.resource")?.to_string(),
                manifest: string(a[2], "intent.action.manifest")?.to_string(),
            }
        }
        "scale" => {
            let a = fields(f[2], &["kind", "resource", "replicas"], "intent.action")?;
            let replicas = number(a[2], "intent.action.replicas")?;
            Action::Scale {
                resource: string(a[1], "intent.action.resource")?.to_string(),
                replicas: u32::try_from(replicas)
                    .map_err(|_| "intent.action.replicas is not a u32".to_string())?,
            }
        }
        "destroy" => {
            let a = fields(f[2], &["kind", "resource"], "intent.action")?;
            Action::Destroy {
                resource: string(a[1], "intent.action.resource")?.to_string(),
            }
        }
        _ => return Err("intent.action.kind is not \"apply\", \"scale\" or \"destroy\"".into()),
    };
    let priority = match string(f[3], "intent.priority")? {
        "bulk" => Priority::Bulk,
        "normal" => Priority::Normal,
        "urgent" => Priority::Urgent,
        "pager" => Priority::Pager,
        _ => return Err("intent.priority is not bulk, normal, urgent or pager".into()),
    };
    let blast_radius = match string(f[4], "intent.blast_radius")? {
        "cell" => BlastRadius::Cell,
        "service" => BlastRadius::Service,
        "region" => BlastRadius::Region,
        "global" => BlastRadius::Global,
        _ => return Err("intent.blast_radius is not cell, service, region or global".into()),
    };
    Ok(Intent {
        id: decimal(f[0], "intent.id")?,
        agent: AgentId::new(string(f[1], "intent.agent")?),
        action,
        priority,
        blast_radius,
        signature: signature(f[5], "intent.signature")?,
    })
}

fn read_record(value: &Value) -> Result<Record, String> {
    let f = fields(
        value,
        &[
            "type",
            "seq",
            "tick",
            "intent_id",
            "agent",
            "verdict",
            "action",
            "reason",
            "policies",
            "intent",
            "prev",
            "digest",
        ],
        "the record",
    )?;
    let Value::Array(items) = f[8] else {
        return Err(format!("policies is {}, not an array", f[8].kind()));
    };
    let policies = items
        .iter()
        .enumerate()
        .map(|(n, item)| match item {
            Value::Array(pair) if pair.len() == 2 => Ok((
                string(&pair[0], &format!("policies[{n}][0]"))?.to_string(),
                string(&pair[1], &format!("policies[{n}][1]"))?.to_string(),
            )),
            _ => Err(format!("policies[{n}] is not a [name, label] pair")),
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Record {
        seq: number(f[1], "seq")?,
        tick: decimal(f[2], "tick")?,
        intent_id: decimal(f[3], "intent_id")?,
        agent: string(f[4], "agent")?.to_string(),
        verdict: string(f[5], "verdict")?.to_string(),
        evidence: Evidence {
            action: string(f[6], "action")?.to_string(),
            reason: opt_string(f[7], "reason")?,
            policies,
        },
        intent: match f[9] {
            Value::Null => None,
            other => Some(read_intent(other)?),
        },
        prev: Digest(hex(f[10], "prev")?),
        digest: Digest(hex(f[11], "digest")?),
    })
}

fn read_checkpoint(value: &Value) -> Result<Checkpoint, String> {
    let f = fields(
        value,
        &["type", "size", "head", "root", "frontier", "signature"],
        "the checkpoint",
    )?;
    let Value::Array(peaks) = f[4] else {
        return Err(format!("frontier is {}, not an array", f[4].kind()));
    };
    Ok(Checkpoint {
        size: number(f[1], "size")?,
        head: Digest(hex(f[2], "head")?),
        root: Digest(hex(f[3], "root")?),
        frontier: peaks
            .iter()
            .enumerate()
            .map(|(n, peak)| hex(peak, &format!("frontier[{n}]")).map(Digest))
            .collect::<Result<_, _>>()?,
        signature: signature(f[5], "signature")?,
    })
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
        l.advance_clock(u64::MAX);
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
                "{{\"type\":\"record\",\"seq\":0,\"tick\":\"18446744073709551615\",\
                 \"intent_id\":\"18446744073709551615\",\
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

    /// A ledger with one line of every shape the export has.
    fn every_kind_of_line() -> Ledger {
        let key = SigningKey::from_seed(&[8; 32]);
        let mut l = Ledger::new()
            .with_checkpoints(2)
            .with_signer(SigningKey::from_seed(&[9; 32]));
        l.checkpoint(); // size 0, with an empty frontier
        let actions = [
            Action::Apply {
                resource: "w\u{e9}b".into(),
                manifest: "a\"b\\c\n\r\t\u{0}\u{1f}\u{7f}\u{2028}\u{1f980}".into(),
            },
            Action::Scale {
                resource: "api".into(),
                replicas: u32::MAX,
            },
            Action::Destroy {
                resource: String::new(),
            },
        ];
        let priorities = [Priority::Bulk, Priority::Normal, Priority::Pager];
        let blasts = [BlastRadius::Cell, BlastRadius::Region, BlastRadius::Global];
        for (n, action) in actions.into_iter().enumerate() {
            let intent = Intent::new(
                [u64::MAX, 0, 7][n],
                AgentId::new(["", "a\"b", "d\u{e9}ployeur"][n]),
                action,
                priorities[n],
                blasts[n],
            );
            let intent = if n == 1 { intent } else { intent.signed(&key) };
            l.append_intent(
                &intent,
                "admit",
                [None, Some(String::new()), Some("why\n".into())][n].clone(),
                vec![("p".into(), "admit".into()); n],
            );
        }
        l.append(3, "ops", "released");
        l
    }

    #[test]
    fn every_line_reads_back_as_written() {
        let l = every_kind_of_line();
        let text = export(&l);
        let mut records = l.records().iter();
        let mut checkpoints = l.checkpoints().iter();
        for line in text.lines() {
            match read_line(line).unwrap_or_else(|e| panic!("{line}: {e}")) {
                Line::Header { from } => assert_eq!(header(from), line),
                Line::Record(r) => {
                    let want = records.next().unwrap();
                    assert_eq!(record_line(&r), line);
                    assert_eq!(
                        (r.seq, r.digest, r.prev),
                        (want.seq, want.digest, want.prev)
                    );
                    assert_eq!(r.intent, want.intent);
                    assert_eq!(r.evidence, want.evidence);
                    assert_eq!((&r.agent, &r.verdict), (&want.agent, &want.verdict));
                }
                Line::Checkpoint(c) => assert_eq!(&c, checkpoints.next().unwrap()),
            }
        }
        assert!(records.next().is_none() && checkpoints.next().is_none());
        // A suffix header reads back too; whether to accept it is the
        // caller's choice.
        assert!(matches!(
            read_line(&header(9)),
            Ok(Line::Header { from: 9 })
        ));
    }

    #[test]
    fn malformed_lines_are_refused() {
        let l = every_kind_of_line();
        let text = export(&l);
        let lines: Vec<&str> = text.lines().collect();
        // The scale record (no signature) and the first checkpoint.
        let record = lines
            .iter()
            .find(|l| l.contains("\"kind\":\"scale\""))
            .unwrap();
        let checkpoint = lines[1];
        assert!(checkpoint.starts_with("{\"type\":\"checkpoint\",\"size\":0,"));
        let refused = |line: &str, problem: &str| match read_line(line) {
            Ok(read) => panic!("{line} was read as {read:?}"),
            Err(e) => assert!(e.contains(problem), "{line}: {e:?} should say {problem:?}"),
        };
        let r = |from: &str, to: &str| {
            assert!(record.contains(from), "{from}");
            record.replacen(from, to, 1)
        };
        // Types and values.
        refused(
            &r("\"intent_id\":\"0\"", "\"intent_id\":0"),
            "intent_id is a number, not a string",
        );
        refused(
            &r("\"intent_id\":\"0\"", "\"intent_id\":\"00\""),
            "intent_id is not a u64",
        );
        refused(
            &r("\"intent_id\":\"0\"", "\"intent_id\":\"+1\""),
            "intent_id is not a u64",
        );
        refused(
            &r(
                "\"intent_id\":\"0\"",
                "\"intent_id\":\"18446744073709551616\"",
            ),
            "intent_id is not a u64",
        );
        refused(
            &r("\"seq\":", "\"seq\":\"").replacen(",\"tick\"", "\",\"tick\"", 1),
            "seq is a string, not a number",
        );
        // A tick is a u64 written as a decimal string, like an intent id.
        refused(
            &r("\"tick\":\"0\"", "\"tick\":0"),
            "tick is a number, not a string",
        );
        refused(&r("\"tick\":\"0\"", "\"tick\":\"-1\""), "tick is not a u64");
        refused(
            &r("\"tick\":\"0\"", "\"tick\":\"18446744073709551616\""),
            "tick is not a u64",
        );
        refused(&r(",\"tick\":\"0\"", ""), "the record has no \"tick\"");
        refused(
            &r("\"kind\":\"scale\"", "\"kind\":[\"scale\"]"),
            "intent.action.kind is not",
        );
        refused(
            &r("\"kind\":\"scale\"", "\"kind\":\"Scale\""),
            "intent.action.kind is not",
        );
        refused(
            &r("\"replicas\":4294967295", "\"replicas\":4294967296"),
            "replicas is not a u32",
        );
        refused(
            &r("\"replicas\":4294967295", "\"replicas\":\"5\""),
            "replicas is a string",
        );
        refused(
            &r("\"priority\":\"normal\"", "\"priority\":\"high\""),
            "intent.priority is not",
        );
        refused(
            &r("\"blast_radius\":\"region\"", "\"blast_radius\":1"),
            "intent.blast_radius is a number",
        );
        refused(
            &r("[\"p\",\"admit\"]", "[\"p\",\"admit\",\"x\"]"),
            "policies[0] is not a [name, label] pair",
        );
        refused(
            &r("[\"p\",\"admit\"]", "[\"p\"]"),
            "policies[0] is not a [name, label] pair",
        );
        refused(
            &r("[\"p\",\"admit\"]", "[\"p\",1]"),
            "policies[0][1] is a number",
        );
        refused(
            &r("\"policies\":[", "\"policies\":{\"a\":[").replacen(
                "]],\"intent\"",
                "]]},\"intent\"",
                1,
            ),
            "policies is an object",
        );
        refused(
            &r("\"reason\":\"\"", "\"reason\":false"),
            "reason is a boolean",
        );
        refused(
            &r("\"agent\":\"a\\\"b\"", "\"agent\":null"),
            "agent is null, not a string",
        );
        refused(
            &r("\"intent\":{", "\"intent\":[{").replacen("},\"prev\"", "}],\"prev\"", 1),
            "intent is an array",
        );
        refused(
            &r("\"signature\":null", "\"signature\":\"00\""),
            "intent.signature is not 64 bytes",
        );
        let digest_at = record.find("\"digest\":\"").unwrap() + 10;
        let upper = format!("{}A{}", &record[..digest_at], &record[digest_at + 1..]);
        refused(&upper, "digest is not 32 bytes of lowercase hex");
        refused(&r("\"prev\":\"", "\"prev\":\"0"), "prev is not 32 bytes");
        // Fields: unknown, missing, out of order, twice.
        refused(
            &r("\"verdict\":", "\"x\":1,\"verdict\":"),
            "the record has an unknown field \"x\"",
        );
        refused(
            &r(",\"verdict\":\"admit\"", ""),
            "the record has no \"verdict\"",
        );
        refused(
            &r(
                "\"agent\":\"a\\\"b\",\"verdict\":\"admit\"",
                "\"verdict\":\"admit\",\"agent\":\"a\\\"b\"",
            ),
            "the record does not have its fields in the documented order",
        );
        refused(
            &r("\"verdict\":", "\"verdict\":\"admit\",\"verdict\":"),
            "appears twice",
        );
        refused(
            &r(
                "\"replicas\":4294967295",
                "\"replicas\":4294967295,\"manifest\":\"m\"",
            ),
            "intent.action has an unknown field \"manifest\"",
        );
        // Spellings that mean the same thing are still refused.
        refused(
            &r("\"verdict\":", "\"verdict\" :"),
            "not written as floodwall writes it",
        );
        refused(
            &r("\"verdict\":\"admit\"", "\"verdict\":\"\\u0061dmit\""),
            "not written as floodwall writes it",
        );
        refused(
            &r("\"resource\":\"api\"", "\"resource\":\"\\/api\""),
            "not written as floodwall writes it",
        );
        refused(&format!(" {record}"), "not written as floodwall writes it");
        // Checkpoints.
        refused(
            &checkpoint.replacen("\"size\":0", "\"size\":-0", 1),
            "negative numbers are not used",
        );
        refused(
            &checkpoint.replacen("\"frontier\":[]", "\"frontier\":[1]", 1),
            "frontier[0] is a number",
        );
        refused(
            &checkpoint.replacen("\"frontier\":[]", "\"frontier\":{}", 1),
            "frontier is an object",
        );
        refused(
            &checkpoint.replacen("\"size\":0", "\"size\":0.0", 1),
            "only whole numbers are used",
        );
        // Headers and other lines.
        let h = header(0);
        refused(
            &h.replacen("\"version\":1", "\"version\":2", 1),
            "unsupported format \"floodwall-ledger\" version 2",
        );
        refused(
            &h.replacen("\"hash\":\"sha256\"", "\"hash\":\"md5\"", 1),
            "unsupported hash \"md5\"",
        );
        refused(
            &h.replacen("\"from\":0", "\"from\":\"0\"", 1),
            "from is a string",
        );
        refused(
            "{\"type\":\"comment\"}",
            "not a header, record or checkpoint line",
        );
        refused(
            "{\"kind\":\"record\",\"type\":\"record\"}",
            "not a header, record or checkpoint line",
        );
        refused("[]", "not a header, record or checkpoint line");
        refused("", "not JSON this reader accepts");
        refused("{\"type\":\"record\"", "not JSON this reader accepts");
    }
}
