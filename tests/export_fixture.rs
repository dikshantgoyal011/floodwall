//! Writes an export full of edge cases to `target/export-fixture/`, for
//! the independent verifier (`tools/verify-ledger.mjs`) to check in CI:
//! the largest intent id, non-ASCII names, quotes, backslashes, newlines and
//! control characters in text, empty and missing fields, signed intents and
//! signed checkpoints, including one at size 0.

use std::fs;
use std::path::Path;

use floodwall::export::keys_json;
use floodwall::intent::{Action, AgentId, BlastRadius, Intent, Priority};
use floodwall::{Evidence, Keyring, Ledger, SigningKey};

#[test]
fn write_an_edge_case_export_for_the_independent_verifier() {
    let plane = SigningKey::from_seed(&[1; 32]);
    let agent_names = ["déployeur", "a\"b\\c", "bot"];
    let keys: Vec<SigningKey> = (0..agent_names.len())
        .map(|i| SigningKey::from_seed(&[10 + i as u8; 32]))
        .collect();
    let keyring = agent_names
        .iter()
        .zip(&keys)
        .fold(Keyring::new(), |ring, (name, key)| {
            ring.with(*name, key.verifying_key())
        });

    let mut ledger = Ledger::new().with_checkpoints(3).with_signer(plane.clone());
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
        let who = (i % 3) as usize;
        let intent = Intent::new(
            if i == 0 { u64::MAX } else { i },
            AgentId::new(agent_names[who]),
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
            Evidence {
                action: actions[who].to_string(),
                reason: reasons[who].clone(),
                policies,
            },
        );
    }
    ledger.checkpoint(); // size 8
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

    let text = String::from_utf8(whole).unwrap();
    assert!(text.contains("\"intent_id\":\"18446744073709551615\""));
    assert_eq!(text.lines().count(), 1 + 8 + 4); // header, records, checkpoints 0/3/6/8
}
