//! A durable, append-only ledger on disk.
//!
//! [`Ledger::create`] starts a ledger in a new file, and [`Ledger::open`]
//! picks one up again, after a restart or a crash. The file is the ledger's
//! [JSON Lines export](crate::export), written as it grows: a header, then
//! every record and checkpoint, one line each, in order. So the file a plane
//! is writing is also an export an auditor can check with their own tools,
//! `tools/verify-ledger.mjs` included.
//!
//! ```
//! use floodwall::Ledger;
//!
//! let path = std::env::temp_dir().join(format!("floodwall-doc-{}.jsonl", std::process::id()));
//! # let _ = std::fs::remove_file(&path);
//! let mut ledger = Ledger::create(&path).unwrap();
//! ledger.append(7, "deployer", "admit"); // on disk, and synced, when this returns
//! let head = ledger.head();
//! drop(ledger);
//!
//! // After a restart: the same ledger, checked from genesis.
//! let mut ledger = Ledger::open(&path).unwrap();
//! assert_eq!((ledger.len(), ledger.head()), (1, head));
//! ledger.append(8, "deployer", "admit");
//! # drop(ledger);
//! # std::fs::remove_file(&path).unwrap();
//! ```
//!
//! # Durability
//!
//! A record is written, and the file synced to the disk (`fsync`), before
//! the record is added to the ledger and before the call that adds it
//! returns. A [`Floodwall`](crate::Floodwall) writes the records of one call
//! (a [`tick`](crate::Floodwall::tick), say) and syncs once before
//! returning, so no decision is reported, and so acted on, until it is on
//! disk. A checkpoint is written with the record that completes it.
//!
//! If a write or a sync fails, the ledger stops writing: whether the
//! failed write reached the disk is unknown, and after a failed sync the
//! operating system may have dropped the data while reporting later syncs
//! as successful (as PostgreSQL found in 2018), so retrying cannot be
//! trusted. [`Ledger::try_append_intent`] and the other `try_` methods
//! return [`WriteError`]; the other appends panic. A plane panics too
//! (see [`Floodwall`](crate::Floodwall#durability)), before the decision
//! takes effect. Reopen the file to carry on: it holds what reached the
//! disk.
//!
//! # Crashes
//!
//! A crash can leave the last line half written. Nothing was reported
//! about it, because it was never synced, so [`Ledger::open`] discards an
//! unfinished last line (one with no `\n`), truncates the file to the last
//! complete line, and says how many bytes it dropped
//! ([`Ledger::discarded_on_open`]). Every complete line must be exactly
//! what floodwall writes and must verify, as with [`Ledger::verify`]:
//! anything else is reported as [`ReadError::Invalid`], with the line and
//! its byte offset, and the file is left as it is. Truncating the file to
//! that offset keeps everything before the bad line.
//!
//! What opening checks is the bytes it reads. A process that stopped
//! between writing lines and syncing them may have left them only in the
//! operating system's cache, where `open` reads them like any other; so it
//! syncs the file before returning, and the ledger it returns is on disk.
//! A write that never reached the file at all is simply not there: it was
//! never synced, so nothing was reported about it.
//!
//! # One writer
//!
//! Opening a ledger file locks it, until the [`Ledger`] is dropped, so a
//! second `open` or `create`, in this process or another, fails with
//! [`ReadError::InUse`] instead of writing alongside it. On Unix the lock
//! is advisory (`flock`): it binds other floodwall processes, not programs
//! that ignore it. On Windows it is mandatory and also keeps other
//! programs from reading the file while it is open; audit a copy, or read
//! it after the ledger is closed.
//!
//! # What it does not do
//!
//! Opening checks that the file is a consistent ledger. Whoever can write
//! the file can still rewrite it consistently, or cut it short; a head you
//! kept, or a checkpoint signed by the plane, detects that, as for any
//! ledger. The checkpoint interval and the plane's signing key are not
//! stored in the file: set them again after opening
//! ([`Ledger::with_checkpoints`], [`Ledger::with_signer`]). The whole ledger
//! is still held in memory. Resuming a [`Floodwall`](crate::Floodwall) from
//! a reopened ledger (FW-402) is not here yet.

use std::fmt;
use std::fs::{File, OpenOptions, TryLockError};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::export::{self, Line};
use crate::ledger::Ledger;

/// Why a ledger could not be read, created or opened.
#[derive(Debug)]
pub enum ReadError {
    /// Reading or writing the file failed.
    Io(io::Error),
    /// Another [`Ledger`], in this process or another, has the file open.
    InUse,
    /// Line `line` (counted from 1), which starts `offset` bytes into the
    /// input, is not what floodwall writes, or does not fit the ledger
    /// before it.
    Invalid {
        line: u64,
        offset: u64,
        problem: String,
    },
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadError::Io(e) => write!(f, "{e}"),
            ReadError::InUse => f.write_str("the ledger file is already open"),
            ReadError::Invalid {
                line,
                offset,
                problem,
            } => write!(f, "line {line} (at byte {offset}): {problem}"),
        }
    }
}

impl std::error::Error for ReadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ReadError::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<io::Error> for ReadError {
    fn from(e: io::Error) -> Self {
        ReadError::Io(e)
    }
}

/// Why a record or checkpoint could not be added to a ledger on disk. It
/// was not added.
#[derive(Debug)]
pub enum WriteError {
    /// Writing or syncing the file failed. What reached the disk is
    /// unknown, so the ledger writes nothing more.
    Io(io::Error),
    /// An earlier write or sync failed, so the ledger writes nothing more.
    /// Reopen the file with [`Ledger::open`] to carry on.
    Stopped,
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WriteError::Io(e) => write!(f, "writing the ledger file failed: {e}"),
            WriteError::Stopped => f.write_str(
                "an earlier write to the ledger file failed, so nothing more is written",
            ),
        }
    }
}

impl std::error::Error for WriteError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            WriteError::Io(e) => Some(e),
            WriteError::Stopped => None,
        }
    }
}

/// Where a ledger's lines go: the file, or a stand-in in tests.
pub(crate) trait Sink: Send + Sync {
    fn append(&mut self, bytes: &[u8]) -> io::Result<()>;
    fn sync(&mut self) -> io::Result<()>;
}

impl Sink for File {
    fn append(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.write_all(bytes)
    }

    fn sync(&mut self) -> io::Result<()> {
        self.sync_data()
    }
}

/// The file a ledger is kept in.
pub(crate) struct Storage {
    sink: Box<dyn Sink>,
    path: PathBuf,
    discarded: u64,
    /// Set once a write or sync fails: from then on, nothing is written.
    stopped: bool,
    /// Something was written since the last sync.
    unsynced: bool,
}

impl Storage {
    pub(crate) fn new(sink: Box<dyn Sink>, path: PathBuf, discarded: u64) -> Self {
        Self {
            sink,
            path,
            discarded,
            stopped: false,
            unsynced: false,
        }
    }

    /// Write `bytes` at the end of the file, without syncing.
    pub(crate) fn write(&mut self, bytes: &[u8]) -> Result<(), WriteError> {
        if self.stopped {
            return Err(WriteError::Stopped);
        }
        self.unsynced = true;
        self.sink.append(bytes).map_err(|e| {
            self.stopped = true;
            WriteError::Io(e)
        })
    }

    /// Sync everything written so far to the disk.
    pub(crate) fn sync(&mut self) -> Result<(), WriteError> {
        if self.stopped {
            return Err(WriteError::Stopped);
        }
        if self.unsynced {
            self.sink.sync().map_err(|e| {
                self.stopped = true;
                WriteError::Io(e)
            })?;
            self.unsynced = false;
        }
        Ok(())
    }
}

impl Ledger {
    /// Start a new ledger in a new file at `path`, and keep it there: every
    /// record and checkpoint is written and synced before it is added (see
    /// [`crate::durable`]). Fails if the file already exists; use
    /// [`Ledger::open`] for that.
    pub fn create(path: impl AsRef<Path>) -> Result<Ledger, ReadError> {
        let path = path.as_ref();
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(path)?;
        lock(&file)?;
        begin(file, path, 0)
    }

    /// Open the ledger in the file at `path`, written by
    /// [`Ledger::create`], and keep adding to it. Every line is read back
    /// and checked from genesis, as [`Ledger::verify`] does, and an
    /// unfinished last line left by a crash is discarded (see
    /// [Crashes](crate::durable#crashes)). The file stays locked until the
    /// ledger is dropped.
    ///
    /// Before it returns, the file is synced, so everything the ledger was
    /// read from is on disk: lines a process wrote but stopped before
    /// syncing may have been only in the operating system's cache, and a
    /// plane resumed from this ledger builds on them.
    ///
    /// Fails with [`ReadError::InUse`] if another ledger has the file open,
    /// and [`ReadError::Invalid`] if a complete line is not what floodwall
    /// writes or does not verify, in which case the file is not changed. An
    /// empty file, or one holding only part of a header, is a ledger whose
    /// creation was cut short, and is started again.
    pub fn open(path: impl AsRef<Path>) -> Result<Ledger, ReadError> {
        let path = path.as_ref();
        let mut file = OpenOptions::new().read(true).write(true).open(path)?;
        lock(&file)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        let complete = bytes.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
        let (lines, unfinished) = bytes.split_at(complete);
        if complete == 0 {
            // Nothing complete: either a ledger cut short while its header
            // was written, or not a ledger at all, which is left alone.
            let header = format!("{}\n", export::header(0));
            if !header.as_bytes().starts_with(unfinished) {
                return Err(ReadError::Invalid {
                    line: 1,
                    offset: 0,
                    problem: "not a floodwall ledger".into(),
                });
            }
            truncate(&mut file, 0)?;
            return begin(file, path, unfinished.len() as u64);
        }
        let mut ledger = load(lines)?;
        if !unfinished.is_empty() {
            file.set_len(complete as u64)?;
        }
        // What was just read may not all be on disk yet: make it so before
        // anything builds on it.
        file.sync_all()?;
        file.seek(SeekFrom::End(0))?;
        ledger.attach(Storage::new(
            Box::new(file),
            path.to_path_buf(),
            unfinished.len() as u64,
        ));
        Ok(ledger)
    }

    /// Read a whole-ledger export ([`Ledger::export_jsonl`]) back into a
    /// ledger in memory, checking every line as [`Ledger::open`] does. Every
    /// line must end with `\n`. A suffix export
    /// ([`Ledger::export_jsonl_from`]) is refused, because a ledger holds
    /// every record from genesis.
    pub fn read_jsonl(mut input: impl Read) -> Result<Ledger, ReadError> {
        let mut bytes = Vec::new();
        input.read_to_end(&mut bytes)?;
        if bytes.is_empty() {
            return Err(ReadError::Invalid {
                line: 1,
                offset: 0,
                problem: "the export is empty".into(),
            });
        }
        load(&bytes)
    }

    /// The file this ledger is kept in, if it is on disk.
    pub fn path(&self) -> Option<&Path> {
        self.storage().map(|s| s.path.as_path())
    }

    /// How many bytes of an unfinished last line [`Ledger::open`] discarded
    /// from the end of the file: 0 unless a crash cut a write short.
    pub fn discarded_on_open(&self) -> u64 {
        self.storage().map_or(0, |s| s.discarded)
    }
}

/// Lock `file` for this process alone, without waiting.
fn lock(file: &File) -> Result<(), ReadError> {
    match file.try_lock() {
        Ok(()) => Ok(()),
        Err(TryLockError::WouldBlock) => Err(ReadError::InUse),
        Err(TryLockError::Error(e)) => Err(ReadError::Io(e)),
    }
}

/// Cut `file` to `len` bytes, durably.
fn truncate(file: &mut File, len: u64) -> io::Result<()> {
    file.set_len(len)?;
    file.sync_all()
}

/// Write the header to an empty, locked `file`, make the file's existence
/// durable too, and keep a new ledger in it.
fn begin(mut file: File, path: &Path, discarded: u64) -> Result<Ledger, ReadError> {
    file.seek(SeekFrom::Start(0))?;
    file.write_all(format!("{}\n", export::header(0)).as_bytes())?;
    file.sync_all()?;
    sync_directory(path)?;
    let mut ledger = Ledger::new();
    ledger.attach(Storage::new(Box::new(file), path.to_path_buf(), discarded));
    Ok(ledger)
}

/// Sync the directory holding `path`, so a new file's name survives a
/// crash. Windows has no such call; NTFS journals the name with the file.
fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        let dir = match path.parent() {
            Some(dir) if !dir.as_os_str().is_empty() => dir,
            _ => Path::new("."),
        };
        File::open(dir)?.sync_all()?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Rebuild a ledger from complete export lines, each ending with `\n`,
/// checking every line in order.
fn load(bytes: &[u8]) -> Result<Ledger, ReadError> {
    let mut ledger = Ledger::new();
    let mut offset = 0u64;
    for (i, raw) in bytes.split_inclusive(|&b| b == b'\n').enumerate() {
        let line = i as u64 + 1;
        let invalid = |problem: String| ReadError::Invalid {
            line,
            offset,
            problem,
        };
        let Some(text) = raw.strip_suffix(b"\n") else {
            return Err(invalid("the last line is not terminated by \\n".into()));
        };
        let text =
            std::str::from_utf8(text).map_err(|_| invalid("the line is not UTF-8".into()))?;
        match (i, export::read_line(text).map_err(invalid)?) {
            (0, Line::Header { from: 0 }) => {}
            (0, Line::Header { from }) => {
                return Err(invalid(format!(
                    "a suffix export, of the records after the first {from}; a ledger holds \
                     every record from genesis"
                )))
            }
            (0, _) => return Err(invalid("the first line must be the header".into())),
            (_, Line::Header { .. }) => return Err(invalid("a second header".into())),
            (_, Line::Record(r)) => ledger.restore_record(*r).map_err(invalid)?,
            (_, Line::Checkpoint(c)) => ledger.restore_checkpoint(c).map_err(invalid)?,
        }
        offset += raw.len() as u64;
    }
    Ok(ledger)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ed25519::SigningKey;
    use crate::intent::{Action, AgentId, BlastRadius, Intent, Priority};
    use crate::ledger::{Evidence, Record};
    use crate::{Admission, Floodwall, Gate, Outcome, RateLimit, SchedulerConfig};
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    /// A fresh directory under the system's temp directory, removed when
    /// dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            static N: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir().join(format!(
                "floodwall-{name}-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn plane_key() -> SigningKey {
        SigningKey::from_seed(&[5; 32])
    }

    /// A mix of everything a ledger holds: signed intents of every kind,
    /// awkward text, plain records with and without evidence, and
    /// checkpoints cut every 3 records and by hand.
    fn fill(ledger: &mut Ledger, from: u64) {
        let key = SigningKey::from_seed(&[6; 32]);
        let actions = [
            Action::Apply {
                resource: "web".into(),
                manifest: "line 1\nline 2 \"quoted\" \\ \u{1}".into(),
            },
            Action::Scale {
                resource: "api".into(),
                replicas: u32::MAX,
            },
            Action::Destroy {
                resource: "d\u{e9}p\u{f4}t-\u{1f980}".into(),
            },
        ];
        for (n, action) in actions.into_iter().enumerate() {
            ledger.advance_clock(from + 2 * n as u64 + 1);
            let id = if n == 0 {
                u64::MAX - from
            } else {
                from + n as u64
            };
            let intent = Intent::new(
                id,
                AgentId::new("d\u{e9}ployeur"),
                action,
                Priority::Urgent,
                BlastRadius::Region,
            )
            .signed(&key);
            ledger.append_intent(
                &intent,
                "defer",
                Some("held: \"why\"\t\u{7f}".into()),
                vec![("r\u{e8}gle".into(), "defer".into())],
            );
        }
        ledger.append(from + 10, "ops", "released");
        ledger.checkpoint();
        ledger.append_with(
            from + 11,
            "ops",
            "failed",
            Evidence {
                action: "scale web to 0".into(),
                reason: None,
                policies: vec![],
                bundles: vec![],
            },
        );
    }

    fn export(ledger: &Ledger) -> Vec<u8> {
        let mut out = Vec::new();
        ledger.export_jsonl(&mut out).unwrap();
        out
    }

    /// A ledger file holding `fill`'s records, and its bytes.
    fn sample(dir: &TempDir, name: &str) -> (PathBuf, Vec<u8>) {
        let path = dir.path(name);
        let mut ledger = Ledger::create(&path)
            .unwrap()
            .with_checkpoints(3)
            .with_signer(plane_key());
        fill(&mut ledger, 0);
        let bytes = export(&ledger);
        drop(ledger);
        assert_eq!(fs::read(&path).unwrap(), bytes, "the file is the export");
        (path, bytes)
    }

    fn invalid(result: Result<Ledger, ReadError>) -> (u64, u64, String) {
        match result {
            Err(ReadError::Invalid {
                line,
                offset,
                problem,
            }) => (line, offset, problem),
            Err(e) => panic!("expected Invalid, got {e:?}"),
            Ok(l) => panic!("expected Invalid, opened {} records", l.len()),
        }
    }

    #[test]
    fn a_new_ledger_file_starts_with_the_header() {
        let dir = TempDir::new("create");
        let path = dir.path("ledger.jsonl");
        let ledger = Ledger::create(&path).unwrap();
        assert_eq!(ledger.path(), Some(path.as_path()));
        assert_eq!(ledger.discarded_on_open(), 0);
        assert!(ledger.is_empty());
        // A file that already exists is never overwritten, open or not.
        match Ledger::create(&path) {
            Err(ReadError::Io(e)) => assert_eq!(e.kind(), io::ErrorKind::AlreadyExists),
            other => panic!("{other:?}", other = other.map(|l| l.len())),
        }
        drop(ledger);
        assert!(matches!(Ledger::create(&path), Err(ReadError::Io(_))));
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            format!("{}\n", export::header(0))
        );
        // A ledger in memory has no file.
        assert_eq!(Ledger::new().path(), None);
        assert_eq!(Ledger::new().discarded_on_open(), 0);
    }

    #[test]
    fn records_and_checkpoints_survive_a_restart() {
        let dir = TempDir::new("restart");
        let (path, bytes) = sample(&dir, "ledger.jsonl");
        let first = Ledger::read_jsonl(&bytes[..]).unwrap();

        let ledger = Ledger::open(&path).unwrap();
        assert_eq!(ledger.discarded_on_open(), 0);
        assert_eq!(ledger.len(), first.len());
        assert_eq!(ledger.head(), first.head());
        assert_eq!(ledger.checkpoints(), first.checkpoints());
        // Cut at 3 records, and at 4 by hand.
        let sizes: Vec<u64> = ledger.checkpoints().iter().map(|c| c.size).collect();
        assert_eq!(sizes, [3, 4]);
        assert!(ledger.verify());
        assert_eq!(
            ledger.verify_checkpoint_signatures(&plane_key().verifying_key()),
            Ok(2)
        );
        assert_eq!(export(&ledger), bytes);

        // Keep going where it left off, with the settings set again.
        let mut ledger = ledger.with_checkpoints(3).with_signer(plane_key());
        fill(&mut ledger, 100);
        assert_eq!(ledger.records()[5].seq, 5);
        assert_eq!(ledger.records()[5].prev, first.head());
        let sizes: Vec<u64> = ledger.checkpoints().iter().map(|c| c.size).collect();
        assert_eq!(sizes, [3, 4, 6, 9]);
        let all = export(&ledger);
        drop(ledger);
        assert_eq!(fs::read(&path).unwrap(), all);
        let reopened = Ledger::open(&path).unwrap();
        assert_eq!(reopened.len(), 10);
        assert!(reopened.verify());
        assert_eq!(export(&reopened), all);
    }

    #[test]
    fn an_export_reads_back_into_the_same_ledger() {
        let mut ledger = Ledger::new().with_checkpoints(2).with_signer(plane_key());
        ledger.checkpoint(); // at 0
        fill(&mut ledger, 0);
        let bytes = export(&ledger);
        let back = Ledger::read_jsonl(&bytes[..]).unwrap();
        assert_eq!(back.path(), None);
        assert_eq!(back.head(), ledger.head());
        assert_eq!(back.checkpoints(), ledger.checkpoints());
        assert_eq!(export(&back), bytes);
        for (a, b) in back.records().iter().zip(ledger.records()) {
            assert_eq!(a.intent, b.intent);
            assert_eq!(a.evidence, b.evidence);
            assert_eq!((a.seq, a.digest), (b.seq, b.digest));
        }
        // An empty ledger is just its header.
        let empty = export(&Ledger::new());
        assert!(Ledger::read_jsonl(&empty[..]).unwrap().is_empty());

        assert_eq!(
            invalid(Ledger::read_jsonl(&b""[..])),
            (1, 0, "the export is empty".into())
        );
        let (line, _, problem) = invalid(Ledger::read_jsonl(&bytes[..bytes.len() - 1]));
        assert_eq!(problem, "the last line is not terminated by \\n");
        assert_eq!(line as usize, bytes.split(|&b| b == b'\n').count() - 1);
        // A suffix export does not start at genesis.
        let mut suffix = Vec::new();
        ledger
            .export_jsonl_from(&ledger.checkpoints()[1].clone(), &mut suffix)
            .unwrap();
        let (line, offset, problem) = invalid(Ledger::read_jsonl(&suffix[..]));
        assert_eq!((line, offset), (1, 0));
        assert!(problem.starts_with("a suffix export, of the records after the first 2;"));
    }

    /// The prefix lengths a crash could leave: every line boundary and the
    /// bytes either side, plus a sample of the rest.
    fn cut_points(bytes: &[u8]) -> Vec<usize> {
        let mut cuts: Vec<usize> = (0..=bytes.len()).step_by(17).collect();
        for (i, _) in bytes.iter().enumerate().filter(|(_, &b)| b == b'\n') {
            cuts.extend([i, i + 1, i + 2]);
        }
        cuts.extend([1, 2, bytes.len()]);
        cuts.retain(|&c| c <= bytes.len());
        cuts.sort_unstable();
        cuts.dedup();
        cuts
    }

    #[test]
    fn a_crash_mid_write_loses_only_the_unfinished_line() {
        let dir = TempDir::new("crash");
        let (_, bytes) = sample(&dir, "full.jsonl");
        let full = Ledger::read_jsonl(&bytes[..]).unwrap();
        let header_len = export::header(0).len() + 1;
        let path = dir.path("cut.jsonl");
        for (n, cut) in cut_points(&bytes).into_iter().enumerate() {
            fs::write(&path, &bytes[..cut]).unwrap();
            let ledger = Ledger::open(&path).unwrap_or_else(|e| panic!("cut at {cut}: {e}"));
            let complete = bytes[..cut]
                .iter()
                .rposition(|&b| b == b'\n')
                .map_or(0, |i| i + 1);
            assert_eq!(
                ledger.discarded_on_open(),
                (cut - complete) as u64,
                "cut at {cut}"
            );
            // Exactly the complete lines survive, as a verified prefix of
            // the full ledger.
            let kept = &bytes[..complete.max(header_len)];
            let records = kept.iter().filter(|&&b| b == b'\n').count();
            let expected = Ledger::read_jsonl(kept).unwrap();
            assert_eq!(ledger.len(), expected.len(), "cut at {cut}");
            assert!(ledger.len() <= full.len() && records > ledger.len());
            assert_eq!(ledger.head(), expected.head());
            assert_eq!(ledger.checkpoints(), expected.checkpoints());
            assert!(ledger.verify());
            // The file is cut back to those lines, and grows from there.
            let mut ledger = ledger;
            if n % 8 == 0 {
                ledger.append(99, "bot", "admit");
            }
            let now = export(&ledger);
            drop(ledger);
            assert_eq!(fs::read(&path).unwrap(), now, "cut at {cut}");
            assert!(Ledger::open(&path).unwrap().verify());
        }
    }

    #[test]
    fn complete_lines_that_do_not_verify_are_refused_and_left_alone() {
        let dir = TempDir::new("corrupt");
        let (_, bytes) = sample(&dir, "good.jsonl");
        let text = String::from_utf8(bytes.clone()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        let offset = |line: usize| -> u64 {
            lines[..line - 1]
                .iter()
                .map(|l| l.len() as u64 + 1)
                .sum::<u64>()
        };
        let join = |ls: &[String]| ls.iter().map(|l| format!("{l}\n")).collect::<String>();
        let edit = |line: usize, change: &dyn Fn(&str) -> String| {
            let mut ls: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            ls[line - 1] = change(&ls[line - 1]);
            join(&ls).into_bytes()
        };
        let path = dir.path("bad.jsonl");
        let check = |content: Vec<u8>, line: u64, problem: &str| {
            fs::write(&path, &content).unwrap();
            let (got_line, got_offset, got) = invalid(Ledger::open(&path));
            assert_eq!(got_line, line, "{problem}");
            assert!(got.contains(problem), "{got:?} should say {problem:?}");
            // The file is left exactly as it was.
            assert_eq!(fs::read(&path).unwrap(), content, "{problem}");
            if line > 1 {
                let expected: u64 = content
                    .split_inclusive(|&b| b == b'\n')
                    .take(line as usize - 1)
                    .map(|l| l.len() as u64)
                    .sum();
                assert_eq!(got_offset, expected, "{problem}");
                // Cutting the file at the offset keeps what came before.
                fs::write(&path, &content[..got_offset as usize]).unwrap();
                let kept = Ledger::open(&path).unwrap();
                assert_eq!(kept.discarded_on_open(), 0);
            }
            // read_jsonl refuses the same bytes the same way.
            assert_eq!(invalid(Ledger::read_jsonl(&content[..])).0, line);
        };
        // Line 2 is the first record, 3 the second.
        check(
            edit(3, &|l| {
                l.replace("\"verdict\":\"defer\"", "\"verdict\":\"admit\"")
            }),
            3,
            "record 1 does not match its digest",
        );
        check(
            edit(2, &|l| l.replace("\"verdict\":", "\"verdict\": ")),
            2,
            "not written as floodwall writes it",
        );
        check(
            edit(2, &|l| format!("{},\"extra\":1}}", &l[..l.len() - 1])),
            2,
            "the record has an unknown field \"extra\"",
        );
        check(
            edit(2, &|l| {
                format!("{},\"verdict\":\"defer\"}}", &l[..l.len() - 1])
            }),
            2,
            "appears twice",
        );
        check(
            edit(2, &|l| format!("{l}\r")),
            2,
            "not written as floodwall writes it",
        );
        check(edit(2, &|_| String::new()), 2, "not JSON");
        check(edit(2, &|_| export::header(0)), 2, "a second header");
        check(
            edit(1, &|l| l.replace("\"from\":0", "\"from\":3")),
            1,
            "a suffix export",
        );
        // A file in the encoding before bundles were recorded.
        check(
            edit(1, &|l| l.replace("record/v4", "record/v3")),
            1,
            "unsupported record_encoding",
        );
        check(
            lines[1..]
                .iter()
                .map(|l| format!("{l}\n"))
                .collect::<String>()
                .into_bytes(),
            1,
            "the first line must be the header",
        );
        // Records out of order, missing, or twice.
        let swapped = {
            let mut ls: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            ls.swap(1, 2);
            join(&ls).into_bytes()
        };
        check(swapped, 2, "expected record 0, found record 1");
        let dropped = {
            let mut ls: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            ls.remove(1);
            join(&ls).into_bytes()
        };
        check(dropped, 2, "expected record 0, found record 1");
        // A checkpoint repeated, even with a valid signature.
        let c = lines
            .iter()
            .position(|l| l.contains("\"type\":\"checkpoint\""))
            .unwrap();
        let repeated = {
            let mut ls: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            ls.insert(c + 1, lines[c].to_string());
            join(&ls).into_bytes()
        };
        check(repeated, c as u64 + 2, "a second checkpoint at size 3");
        let flip_head = |l: &str| {
            let at = l.find("\"head\":\"").unwrap() + 8;
            let digit = if &l[at..at + 1] == "0" { "1" } else { "0" };
            format!("{}{digit}{}", &l[..at], &l[at + 1..])
        };
        check(
            edit(c + 1, &flip_head),
            c as u64 + 1,
            "checkpoint 3 has the wrong head",
        );
        // Invalid UTF-8 in a complete line.
        let mut bad_utf8 = bytes.clone();
        let at = offset(2) as usize + 5;
        bad_utf8[at] = 0xff;
        check(bad_utf8, 2, "the line is not UTF-8");
        // A complete last line that is wrong is refused, not discarded.
        let last = lines.len();
        check(
            edit(last, &|l| l.replace("\"failed\"", "\"succeeded\"")),
            last as u64,
            "does not match its digest",
        );

        // Records edited and given the digest of their new contents: the
        // digest checks out, so only the link or the intent can tell.
        let rehash = |line: usize, change: &dyn Fn(&mut Record)| {
            edit(line, &|l| {
                let Ok(Line::Record(mut r)) = export::read_line(l) else {
                    panic!("line {line} is a record")
                };
                change(&mut r);
                r.digest = r.compute_digest();
                export::record_line(&r)
            })
        };
        check(
            rehash(3, &|r| r.prev = crate::Digest::GENESIS),
            3,
            "record 1 does not link to the record before it",
        );
        // Records 0 and 1 are at ticks 1 and 3.
        check(
            rehash(3, &|r| r.tick = 0),
            3,
            "record 1 is at tick 0, before the record before it (tick 1)",
        );
        check(
            rehash(3, &|r| r.evidence.action = "destroy everything".into()),
            3,
            "record 1 shows a different request from the intent it holds",
        );
        check(
            rehash(3, &|r| r.agent = "someone-else".into()),
            3,
            "record 1 shows a different request from the intent it holds",
        );
        // Checkpoints that do not match the records before them.
        let recheck = |change: &dyn Fn(&mut crate::Checkpoint)| {
            edit(c + 1, &|l| {
                let Ok(Line::Checkpoint(mut cp)) = export::read_line(l) else {
                    panic!("line {} is a checkpoint", c + 1)
                };
                change(&mut cp);
                export::checkpoint_line(&cp)
            })
        };
        check(
            recheck(&|cp| cp.root.0[0] ^= 1),
            c as u64 + 1,
            "checkpoint 3 has the wrong Merkle root",
        );
        check(
            recheck(&|cp| cp.frontier[0].0[0] ^= 1),
            c as u64 + 1,
            "checkpoint 3 has the wrong frontier",
        );
        check(
            recheck(&|cp| cp.frontier.push(crate::Digest::GENESIS)),
            c as u64 + 1,
            "checkpoint 3 has the wrong frontier",
        );
        // A checkpoint one record late.
        let late = {
            let mut ls: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            ls.swap(c, c + 1);
            join(&ls).into_bytes()
        };
        check(late, c as u64 + 2, "a checkpoint of size 3 after 4 records");
    }

    #[test]
    fn files_that_are_not_ledgers_are_left_alone() {
        let dir = TempDir::new("foreign");
        let path = dir.path("notes.txt");
        for content in [
            &b"some notes, no newline"[..],
            b"some notes\nmore notes\n",
            b"{\"type\":\"header\",\"format\":\"something-else\"}\n",
            &[0u8; 100][..],
        ] {
            fs::write(&path, content).unwrap();
            let (line, offset, _) = invalid(Ledger::open(&path));
            assert_eq!((line, offset), (1, 0));
            assert_eq!(fs::read(&path).unwrap(), content);
        }
        // A file that holds only the start of a header is a ledger whose
        // creation was cut short: it starts again.
        let header = format!("{}\n", export::header(0));
        for cut in [0, 1, 20, header.len() - 1] {
            fs::write(&path, &header.as_bytes()[..cut]).unwrap();
            let ledger = Ledger::open(&path).unwrap();
            assert_eq!(ledger.discarded_on_open(), cut as u64);
            drop(ledger);
            assert_eq!(fs::read_to_string(&path).unwrap(), header);
        }
        assert!(matches!(
            Ledger::open(dir.path("missing.jsonl")),
            Err(ReadError::Io(e)) if e.kind() == io::ErrorKind::NotFound
        ));
    }

    #[test]
    fn one_ledger_at_a_time_has_the_file() {
        let dir = TempDir::new("lock");
        let path = dir.path("ledger.jsonl");
        let mut first = Ledger::create(&path).unwrap();
        first.append(1, "bot", "admit");
        assert!(matches!(Ledger::open(&path), Err(ReadError::InUse)));
        assert!(matches!(Ledger::open(&path), Err(ReadError::InUse)));
        first.append(2, "bot", "admit");
        drop(first);
        let second = Ledger::open(&path).unwrap();
        assert_eq!(second.len(), 2);
        assert!(matches!(Ledger::open(&path), Err(ReadError::InUse)));
        assert_eq!(
            ReadError::InUse.to_string(),
            "the ledger file is already open"
        );
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    enum Op {
        Write(String),
        Sync,
    }

    /// A stand-in for the file: logs what is written and synced, and fails
    /// the `fail_write`th write or `fail_sync`th sync (counting from 0).
    #[derive(Clone, Default)]
    struct Log {
        ops: Arc<Mutex<Vec<Op>>>,
        writes: Arc<AtomicUsize>,
        syncs: Arc<AtomicUsize>,
        fail_write: Option<usize>,
        fail_sync: Option<usize>,
    }

    impl Log {
        fn take(&self) -> Vec<Op> {
            std::mem::take(&mut self.ops.lock().unwrap())
        }

        fn ledger(&self) -> Ledger {
            let mut ledger = Ledger::new();
            ledger.attach(Storage::new(
                Box::new(self.clone()),
                PathBuf::from("log"),
                0,
            ));
            ledger
        }
    }

    impl Sink for Log {
        fn append(&mut self, bytes: &[u8]) -> io::Result<()> {
            if Some(self.writes.fetch_add(1, Ordering::SeqCst)) == self.fail_write {
                return Err(io::Error::other("disk full"));
            }
            let text = String::from_utf8(bytes.to_vec()).unwrap();
            self.ops.lock().unwrap().push(Op::Write(text));
            Ok(())
        }

        fn sync(&mut self) -> io::Result<()> {
            if Some(self.syncs.fetch_add(1, Ordering::SeqCst)) == self.fail_sync {
                return Err(io::Error::other("I/O error"));
            }
            self.ops.lock().unwrap().push(Op::Sync);
            Ok(())
        }
    }

    #[test]
    fn every_append_is_written_and_synced_before_it_returns() {
        let log = Log::default();
        let mut ledger = log.ledger().with_checkpoints(2);
        let first = ledger.append(1, "bot", "admit").clone();
        assert_eq!(
            log.take(),
            [
                Op::Write(format!("{}\n", export::record_line(&first))),
                Op::Sync
            ]
        );
        // A record that completes a checkpoint goes out with it, in one
        // write and one sync.
        let second = ledger.append(2, "bot", "admit").clone();
        assert_eq!(
            log.take(),
            [
                Op::Write(format!(
                    "{}\n{}\n",
                    export::record_line(&second),
                    export::checkpoint_line(&ledger.checkpoints()[0])
                )),
                Op::Sync
            ]
        );
        // A checkpoint that already exists is not written again.
        ledger.checkpoint();
        assert_eq!(log.take(), []);
        ledger.append(3, "bot", "admit");
        log.take();
        let c = ledger.checkpoint();
        assert_eq!(
            log.take(),
            [
                Op::Write(format!("{}\n", export::checkpoint_line(&c))),
                Op::Sync
            ]
        );
    }

    #[test]
    fn a_failed_write_adds_nothing_and_stops_the_ledger() {
        for (fail_write, fail_sync) in [(Some(1), None), (None, Some(1))] {
            let log = Log {
                fail_write,
                fail_sync,
                ..Log::default()
            };
            let mut ledger = log.ledger().with_checkpoints(2);
            ledger.try_append(1, "bot", "admit").unwrap();
            let (len, head) = (ledger.len(), ledger.head());
            // The second record would also complete a checkpoint: neither
            // is added.
            let e = ledger.try_append(2, "bot", "admit").unwrap_err();
            assert!(matches!(e, WriteError::Io(_)), "{e:?}");
            assert_eq!((ledger.len(), ledger.head()), (len, head));
            assert!(ledger.checkpoints().is_empty());
            assert!(ledger.verify());
            // Nothing more is written, whatever is tried.
            assert!(matches!(
                ledger.try_append(3, "bot", "admit"),
                Err(WriteError::Stopped)
            ));
            let intent = Intent::new(
                4,
                AgentId::new("bot"),
                Action::Destroy {
                    resource: "web".into(),
                },
                Priority::Normal,
                BlastRadius::Cell,
            );
            assert!(matches!(
                ledger.try_append_intent(&intent, "admit", None, vec![]),
                Err(WriteError::Stopped)
            ));
            assert!(matches!(
                ledger.try_append_with(5, "bot", "admit", Evidence::default()),
                Err(WriteError::Stopped)
            ));
            assert!(matches!(ledger.try_checkpoint(), Err(WriteError::Stopped)));
            assert_eq!(ledger.len(), len);
            // Not a byte reached the file after the failure: the first
            // record and its sync, and the second record's write if only
            // its sync failed. More bytes could land after a torn line.
            let ops = log.take();
            let first = format!("{}\n", export::record_line(&ledger.records()[0]));
            assert_eq!(ops[..2], [Op::Write(first), Op::Sync]);
            assert_eq!(ops.len(), if fail_sync.is_some() { 3 } else { 2 });
            // The appends that cannot fail on their own terms panic, still
            // without writing.
            let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                ledger.append(6, "bot", "admit");
            }))
            .unwrap_err();
            assert_eq!(log.take(), []);
            assert_eq!(log.writes.load(Ordering::SeqCst), 2);
            let message = panic.downcast_ref::<String>().unwrap();
            assert!(
                message.starts_with("the ledger file could not be written"),
                "{message}"
            );
        }
        assert_eq!(
            WriteError::Stopped.to_string(),
            "an earlier write to the ledger file failed, so nothing more is written"
        );
        assert_eq!(
            WriteError::Io(io::Error::other("disk full")).to_string(),
            "writing the ledger file failed: disk full"
        );
    }

    #[test]
    fn a_failed_checkpoint_is_not_added() {
        let log = Log {
            fail_sync: Some(1),
            ..Log::default()
        };
        let mut ledger = log.ledger();
        ledger.append(1, "bot", "admit");
        assert!(matches!(ledger.try_checkpoint(), Err(WriteError::Io(_))));
        assert!(ledger.checkpoints().is_empty());
        assert!(matches!(ledger.try_checkpoint(), Err(WriteError::Stopped)));
    }

    fn plane(ledger: Ledger) -> Floodwall {
        Floodwall::new(
            Admission::new(64, RateLimit::new(100.0, 100.0)),
            Gate::new(),
        )
        .with_scheduler(SchedulerConfig::default().with_default_limit(8))
        .with_ledger(ledger)
    }

    fn scale(id: u64, resource: &str) -> Intent {
        Intent::new(
            id,
            AgentId::new("bot"),
            Action::Scale {
                resource: resource.into(),
                replicas: 2,
            },
            Priority::Normal,
            BlastRadius::Service,
        )
    }

    #[test]
    fn a_plane_syncs_its_decisions_before_reporting_them() {
        let log = Log::default();
        let mut plane = plane(log.ledger());
        for id in 0..3 {
            plane.submit(scale(id, &format!("svc-{id}")), 0).unwrap();
        }
        // Each intent that gets in is written and synced before submit
        // returns.
        let ops = log.take();
        assert_eq!(ops.len(), 6);
        for pair in ops.chunks(2) {
            assert!(matches!(pair, [Op::Write(w), Op::Sync] if w.contains("\"queued\"")));
        }
        let report = plane.tick(0);
        assert_eq!(report.decisions.len(), 3);
        // Three records written, then one sync, all before tick returned.
        let ops = log.take();
        assert_eq!(ops.len(), 4);
        assert!(ops[..3].iter().all(|o| matches!(o, Op::Write(_))));
        assert_eq!(ops[3], Op::Sync);
        // An idle tick has nothing to sync.
        plane.tick(1);
        assert_eq!(log.take(), []);
        plane
            .complete(&scale(0, "svc-0").key(), Outcome::Succeeded, 2)
            .unwrap();
        let ops = log.take();
        assert!(matches!(&ops[..], [Op::Write(w), Op::Sync] if w.contains("succeeded")));
        plane.checkpoint();
        assert!(matches!(&log.take()[..], [Op::Write(w), Op::Sync] if w.contains("checkpoint")));
    }

    #[test]
    fn releasing_and_expiring_are_synced_before_they_return() {
        let log = Log::default();
        let mut plane = Floodwall::new(
            Admission::new(64, RateLimit::new(100.0, 100.0)),
            Gate::new(),
        )
        .with_scheduler(
            SchedulerConfig::default()
                .with_default_limit(4)
                .with_conflict_window(5),
        )
        .with_ledger(log.ledger());
        // Two agents contradict each other on one resource: the second is
        // deferred and held.
        let by = |agent: &str, id: u64, replicas: u32| {
            Intent::new(
                id,
                AgentId::new(agent),
                Action::Scale {
                    resource: "web".into(),
                    replicas,
                },
                Priority::Normal,
                BlastRadius::Service,
            )
        };
        plane.submit(by("a", 1, 2), 0).unwrap();
        plane.tick(0);
        plane.submit(by("b", 1, 3), 1).unwrap();
        plane.submit(by("b", 2, 4), 1).unwrap();
        plane.tick(1);
        assert_eq!(plane.held().count(), 2);
        log.take();
        plane.release(&by("b", 1, 3).key(), "operator", 2).unwrap();
        assert!(matches!(&log.take()[..], [Op::Write(w), Op::Sync] if w.contains("released")));
        plane.expire(&by("b", 2, 4).key(), "operator", 2).unwrap();
        assert!(matches!(&log.take()[..], [Op::Write(w), Op::Sync] if w.contains("expired")));
    }

    #[test]
    fn a_plane_stops_before_acting_on_a_decision_it_could_not_keep() {
        // The three arrivals take writes and syncs 0 to 2; the tick's second
        // decision is write 4, and its sync is sync 3.
        for (fail_write, fail_sync) in [(Some(4), None), (None, Some(3))] {
            let log = Log {
                fail_write,
                fail_sync,
                ..Log::default()
            };
            let mut plane = plane(log.ledger());
            for id in 0..3 {
                plane.submit(scale(id, &format!("svc-{id}")), 0).unwrap();
            }
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| plane.tick(0)));
            let panic = result.expect_err("tick must not return a report it could not keep");
            let message = panic.downcast_ref::<String>().unwrap();
            assert!(
                message.starts_with("the ledger file could not be written"),
                "{message}"
            );
            // Where it stopped. A failed write stops at that decision: the
            // first intent is in flight, the second was not acted on, and
            // the third is still queued. A failed sync stops at the end of
            // the tick, before the report of all three is returned.
            let in_flight: Vec<u64> = plane.in_flight().map(|f| f.intent.id).collect();
            match fail_write {
                Some(_) => {
                    assert_eq!(in_flight, [0]);
                    assert_eq!(plane.pending(), 1);
                    assert_eq!(plane.ledger().len(), 4);
                }
                None => {
                    assert_eq!(in_flight, [0, 1, 2]);
                    assert_eq!(plane.pending(), 0);
                }
            }
        }
    }

    /// The real thing: a plane on a file, closed and reopened.
    #[test]
    fn a_plane_on_disk_leaves_its_whole_history_in_the_file() {
        let dir = TempDir::new("plane");
        let path = dir.path("ledger.jsonl");
        let ledger = Ledger::create(&path)
            .unwrap()
            .with_checkpoints(4)
            .with_signer(plane_key());
        let mut plane = plane(ledger);
        for now in 0..6u64 {
            for n in 0..3 {
                let id = now * 3 + n;
                plane
                    .submit(scale(id, &format!("svc-{}", id % 4)), now)
                    .unwrap();
            }
            let report = plane.tick(now);
            let admitted: Vec<_> = report.admitted().map(Intent::key).collect();
            for key in admitted {
                plane.complete(&key, Outcome::Succeeded, now).unwrap();
            }
        }
        plane.checkpoint();
        let (head, len, bytes) = (
            plane.ledger().head(),
            plane.ledger().len(),
            export(plane.ledger()),
        );
        assert!(len > 20);
        drop(plane);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let reopened = Ledger::open(&path).unwrap();
        assert_eq!((reopened.len(), reopened.head()), (len, head));
        assert!(reopened.verify());
        assert_eq!(
            reopened.verify_checkpoint_signatures(&plane_key().verifying_key()),
            Ok(reopened.checkpoints().len())
        );
    }

    /// Keeping a ledger in a file must not stop it, or a plane, from being
    /// shared across threads.
    #[test]
    fn ledgers_and_planes_stay_send_and_sync() {
        fn send_and_sync<T: Send + Sync>() {}
        send_and_sync::<Ledger>();
        send_and_sync::<Floodwall>();
        send_and_sync::<ReadError>();
        send_and_sync::<WriteError>();
    }

    #[test]
    fn errors_read_plainly() {
        let e = ReadError::Invalid {
            line: 3,
            offset: 120,
            problem: "record 1 does not match its digest".into(),
        };
        assert_eq!(
            e.to_string(),
            "line 3 (at byte 120): record 1 does not match its digest"
        );
        assert!(std::error::Error::source(&e).is_none());
        let io = ReadError::from(io::Error::other("boom"));
        assert_eq!(io.to_string(), "boom");
        assert!(std::error::Error::source(&io).is_some());
    }
}
