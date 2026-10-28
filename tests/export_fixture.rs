//! Writes an export full of edge cases to `target/export-fixture/`, for
//! the independent verifier (`tools/verify-ledger.mjs`) to check in CI:
//! the largest intent id, ticks beyond 2^53 and repeated ticks, non-ASCII
//! names, quotes, backslashes, newlines and
//! control characters in text, empty and missing fields, signed intents and
//! signed checkpoints, including one at size 0, and an agent whose records
//! were signed by a key it has since rotated away from. The same ledger is
//! also kept on disk (`durable.jsonl`), which must be the export byte for
//! byte, and the export must read back into the same ledger.

use std::fs;
use std::path::Path;

use floodwall::export::keys_json;
use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
use floodwall::{Keyring, Ledger, SigningKey};

const AGENTS: [&str; 3] = ["déployeur", "a\"b\\c", "bot"];

fn agent_keys() -> Vec<SigningKey> {
    (0..AGENTS.len())
        .map(|i| SigningKey::from_seed(&[10 + i as u8; 32]))
        .collect()
}

/// Record the fixture's history in `ledger`.
fn fill(ledger: &mut Ledger) {
    let keys = agent_keys();
    ledger.checkpoint(); // size 0
    let actions = [
        Action::Apply {
            resource: "web".into(),
            manifest: "line 1\nline 2\t\"quoted\"".into(),
        },
        Action::Scale {
            resource: "api".into(),
            replicas: u32::MAX,
        },
        Action::Destroy {
            resource: "ledger-db".into(),
        },
    ];
    let reasons = [
        None,
        Some(String::new()),
        Some("control \u{1} \u{1f} and \u{7f}, unicode 🦀, backslash \\ quote \"".into()),
    ];
    for i in 0..8u64 {
        // Ticks 0, 0, 2, 2, then past 2^53 (exact only as a string).
        ledger.advance_clock(if i < 4 { i / 2 * 2 } else { (1 << 60) + i });
        let who = (i % 3) as usize;
        let intent = Intent::new(
            if i == 0 { u64::MAX } else { i },
            AgentId::new(AGENTS[who]),
            actions[who].clone(),
            Priority::Pager,
            BlastRadius::Region,
        )
        .signed(&keys[who]);
        let policies = if i % 2 == 0 {
            vec![]
        } else {
            vec![("règle".to_string(), "defer".to_string())]
        };
        ledger.append_intent(
            &intent,
            ["admit", "defer", "reject"][who],
            reasons[who].clone(),
            policies,
        );
    }
    ledger.checkpoint(); // size 8
}

#[test]
fn write_an_edge_case_export_for_the_independent_verifier() {
    let plane = SigningKey::from_seed(&[1; 32]);
    let keys = agent_keys();
    // "bot" has rotated to a new key since signing: its records verify
    // only with its retired key.
    let keyring = AGENTS
        .iter()
        .zip(&keys)
        .fold(Keyring::new(), |ring, (name, key)| {
            ring.with(*name, key.verifying_key())
        })
        .with("bot", SigningKey::from_seed(&[99; 32]).verifying_key())
        .with_retired("bot", keys[2].verifying_key());

    let mut ledger = Ledger::new().with_checkpoints(3).with_signer(plane.clone());
    fill(&mut ledger);
    assert!(ledger.verify());
    assert_eq!(ledger.verify_signatures(&keyring), Ok(8));

    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .parent()
        .expect("target dir")
        .join("export-fixture");
    fs::create_dir_all(&dir).unwrap();
    let mut whole = Vec::new();
    ledger.export_jsonl(&mut whole).unwrap();
    fs::write(dir.join("edge.jsonl"), &whole).unwrap();
    let mut suffix = Vec::new();
    ledger
        .export_jsonl_from(&ledger.checkpoints()[1].clone(), &mut suffix)
        .unwrap();
    fs::write(dir.join("edge-suffix.jsonl"), &suffix).unwrap();
    fs::write(
        dir.join("keys.json"),
        keys_json(&keyring, Some(&plane.verifying_key())) + "\n",
    )
    .unwrap();

    let text = String::from_utf8(whole.clone()).unwrap();
    assert!(text.contains("\"intent_id\":\"18446744073709551615\""));
    assert_eq!(text.lines().count(), 1 + 8 + 4); // header, records, checkpoints 0/3/6/8
    assert!(keys_json(&keyring, None).contains(&format!(
        "\"retired\":{{\"bot\":[\"{}\"]}}",
        keys[2].verifying_key()
    )));

    // The export reads back into the same ledger.
    let back = Ledger::read_jsonl(&whole[..]).unwrap();
    assert_eq!(back.head(), ledger.head());
    assert_eq!(back.checkpoints(), ledger.checkpoints());
    assert_eq!(back.verify_signatures(&keyring), Ok(8));
    let mut again = Vec::new();
    back.export_jsonl(&mut again).unwrap();
    assert_eq!(again, whole);

    // The same history kept on disk is the export, byte for byte, and
    // reopens as the same ledger.
    let durable = dir.join("durable.jsonl");
    let _ = fs::remove_file(&durable);
    let mut on_disk = Ledger::create(&durable)
        .unwrap()
        .with_checkpoints(3)
        .with_signer(plane.clone());
    fill(&mut on_disk);
    drop(on_disk);
    assert_eq!(fs::read(&durable).unwrap(), whole);
    let reopened = Ledger::open(&durable).unwrap();
    assert_eq!(reopened.head(), ledger.head());
    assert_eq!(reopened.checkpoints(), ledger.checkpoints());
}
