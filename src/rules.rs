//! Policies as data: gate rules written in a small declarative language
//! instead of Rust.
//!
//! A rules file holds one or more policies. Each policy is a named list of
//! rules, and each rule rejects or defers the intents its condition holds
//! for, with a reason:
//!
//! ```text
//! format 1
//!
//! # Keep the fleet to the core services; anything else waits for a human.
//! policy "resource-allowlist" {
//!   defer "resource '{resource}' is not on the allowlist"
//!     when resource not in ["web", "api", "cache"]
//! }
//!
//! policy "freeze-billing" {
//!   reject "billing is frozen until the audit closes"
//!     when resource matches "billing*" and kind != scale
//!   defer "{agent} may only scale billing during the audit"
//!     when resource matches "billing*" and kind == scale and agent != "autoscaler"
//! }
//! ```
//!
//! [`parse`] reads a file into [`RulePolicy`]s, each a [`Policy`] like any
//! other, and [`Gate::with_rules`] adds them all to a gate. A rules file is
//! checked when it is read: an unknown field, a value of the wrong type, or
//! anything else out of place is a [`ParseError`] naming the line and
//! column, never a rule that silently never matches.
//!
//! # The format
//!
//! A file starts with `format 1`. `#` starts a comment that runs to the end
//! of the line; spaces, tabs and line breaks separate words and are
//! otherwise ignored.
//!
//! **Policies.** `policy "<name>" { <rules> }`. A name is 1 to 64 lowercase
//! letters, digits and `-`, starting with a letter, like the built-in
//! policies' names, and it is what the gate's breakdown and the ledger
//! show. Names are unique within a file, and the plane's own checks'
//! names ([`SIGNATURE_CHECK`], [`CONFLICT_CHECK`]) are reserved. A policy has at
//! least one rule.
//!
//! **Rules.** `reject "<reason>" when <condition>` or
//! `defer "<reason>" when <condition>`. A policy's verdict on an intent is
//! the harshest of the rules whose conditions hold for it (`reject` over
//! `defer`), with the reason of the first such rule; when no rule holds, it
//! admits. That is the gate's deny-overrides, within one policy.
//!
//! **Reasons.** A reason may name the intent's fields in braces, filled in
//! when the rule applies: `{agent}`, `{kind}`, `{resource}`, `{manifest}`,
//! `{replicas}`, `{priority}`, `{blast_radius}`, and `{action}` (the action's
//! summary, as in the ledger: `scale web to 5`). `{{` and `}}` stand for
//! literal braces. A reason may not be empty.
//!
//! **Conditions.** These fields of an intent can be tested:
//!
//! | Field          | Type                                       | Tests                          |
//! |----------------|--------------------------------------------|--------------------------------|
//! | `agent`        | string                                     | `==` `!=` `in` `matches`       |
//! | `resource`     | string                                     | `==` `!=` `in` `matches`       |
//! | `manifest`     | string, for `apply` only                   | `==` `!=` `in` `matches`       |
//! | `kind`         | `apply`, `scale` or `destroy`              | `==` `!=` `in`                 |
//! | `replicas`     | whole number, for `scale` only             | `==` `!=` `<` `<=` `>` `>=` `in` |
//! | `priority`     | `bulk` < `normal` < `urgent` < `pager`     | `==` `!=` `<` `<=` `>` `>=` `in` |
//! | `blast_radius` | `cell` < `service` < `region` < `global`   | `==` `!=` `<` `<=` `>` `>=` `in` |
//!
//! `field in [v1, v2, ...]` holds when the field equals one of the values,
//! and `field not in [...]` when it equals none of them. `field matches
//! "pattern"` holds when the whole string matches the pattern, in which `*`
//! stands for any run of characters (`"billing*"`, `"*-db"`). Strings are
//! written in double quotes, with `\"`, `\\`, `\n` and `\t` as escapes.
//!
//! `destructive` holds for a destroy, or a scale to zero replicas (see
//! [`Action::is_destructive`](crate::intent::Action::is_destructive)).
//! `true` and `false` are what they say. Conditions combine with `not`,
//! `and` and `or`, in that order of precedence, and with parentheses.
//!
//! `manifest` is only defined for an `apply`, and `replicas` only for a
//! `scale`. A test of a field the intent does not have is false, whatever
//! the test, so `replicas < 2` never holds for a destroy; and `not` of it
//! is true.
//!
//! # Determinism
//!
//! A rule's verdict depends only on the intent, never on the time, the
//! order of other intents, or anything outside the file, so a gate built
//! from a rules file decides the same way every time it sees the same
//! intent, as the built-in policies do.

use std::fmt;

use crate::gate::Gate;
use crate::intent::{Action, BlastRadius, Intent, Priority};
use crate::policy::{Policy, Verdict};
use crate::{CONFLICT_CHECK, SIGNATURE_CHECK};

/// The format version this module reads: a file starts with `format 1`.
pub const FORMAT: u64 = 1;

/// How deeply `not`s and parentheses may nest in one condition.
const MAX_DEPTH: usize = 64;

/// Why a rules file was refused: the line and column (both from 1, the
/// column counted in characters) of the first problem, and what it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    pub line: usize,
    pub column: usize,
    pub problem: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "line {}, column {}: {}",
            self.line, self.column, self.problem
        )
    }
}

impl std::error::Error for ParseError {}

/// A policy read from a rules file (see [`crate::rules`]).
#[derive(Clone, Debug)]
pub struct RulePolicy {
    name: String,
    rules: Vec<Rule>,
}

impl RulePolicy {
    /// How many rules the policy has.
    pub fn len(&self) -> usize {
        self.rules.len()
    }

    /// Whether the policy has no rules. Never true for a parsed policy.
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }
}

impl Policy for RulePolicy {
    fn name(&self) -> &str {
        &self.name
    }

    /// The harshest verdict of the rules that hold for `intent`, with the
    /// first such rule's reason; admit if none does.
    fn evaluate(&self, intent: &Intent) -> Verdict {
        let mut verdict = Verdict::Admit;
        for rule in &self.rules {
            if rule.when.holds(intent) {
                let ruling = rule.verdict(intent);
                if ruling.rank() > verdict.rank() {
                    verdict = ruling;
                }
                if matches!(verdict, Verdict::Reject(_)) {
                    break; // nothing is harsher, and ties keep the first
                }
            }
        }
        verdict
    }
}

impl Gate {
    /// Add every policy in a rules file to the stack, in the file's order
    /// (see [`crate::rules`]). Fails, adding nothing, if the file does not
    /// parse.
    pub fn with_rules(self, text: &str) -> Result<Gate, ParseError> {
        Ok(parse(text)?
            .into_iter()
            .fold(self, |gate, policy| gate.with(policy)))
    }
}

/// Read the policies in a rules file (see [`crate::rules`]), in order.
pub fn parse(text: &str) -> Result<Vec<RulePolicy>, ParseError> {
    let tokens = lex(text)?;
    let mut p = Parser {
        tokens,
        next: 0,
        end: end_of(text),
    };
    p.file()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Severity {
    Reject,
    Defer,
}

#[derive(Clone, Debug)]
struct Rule {
    severity: Severity,
    reason: Vec<Piece>,
    when: Cond,
}

impl Rule {
    fn verdict(&self, intent: &Intent) -> Verdict {
        let mut reason = String::new();
        for piece in &self.reason {
            match piece {
                Piece::Text(text) => reason.push_str(text),
                Piece::Field(field) => reason.push_str(&field.render(intent)),
            }
        }
        match self.severity {
            Severity::Reject => Verdict::Reject(reason),
            Severity::Defer => Verdict::Defer(reason),
        }
    }
}

/// Part of a reason: text, or a field filled in from the intent.
#[derive(Clone, Debug)]
enum Piece {
    Text(String),
    Field(Field),
}

/// Something about an intent a rule can test or a reason can show.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Field {
    Agent,
    Resource,
    Manifest,
    Kind,
    Replicas,
    Priority,
    BlastRadius,
    /// The action's summary: reasons only.
    Action,
}

/// What a field holds, for type checking.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Type {
    Str,
    Kind,
    Number,
    Priority,
    Blast,
}

impl Field {
    fn named(name: &str) -> Option<Field> {
        Some(match name {
            "agent" => Field::Agent,
            "resource" => Field::Resource,
            "manifest" => Field::Manifest,
            "kind" => Field::Kind,
            "replicas" => Field::Replicas,
            "priority" => Field::Priority,
            "blast_radius" => Field::BlastRadius,
            "action" => Field::Action,
            _ => return None,
        })
    }

    fn ty(self) -> Type {
        match self {
            Field::Agent | Field::Resource | Field::Manifest | Field::Action => Type::Str,
            Field::Kind => Type::Kind,
            Field::Replicas => Type::Number,
            Field::Priority => Type::Priority,
            Field::BlastRadius => Type::Blast,
        }
    }

    /// The field's value for `intent`, or `None` if the intent has no
    /// such field (a manifest for anything but an apply, replicas for
    /// anything but a scale).
    fn value(self, intent: &Intent) -> Option<Value> {
        Some(match (self, &intent.action) {
            (Field::Agent, _) => Value::Str(intent.agent.as_str().to_string()),
            (Field::Resource, action) => Value::Str(action.resource().to_string()),
            (Field::Manifest, Action::Apply { manifest, .. }) => Value::Str(manifest.clone()),
            (Field::Manifest, _) => return None,
            (Field::Kind, action) => Value::Kind(Kind::of(action)),
            (Field::Replicas, Action::Scale { replicas, .. }) => Value::Number(*replicas),
            (Field::Replicas, _) => return None,
            (Field::Priority, _) => Value::Priority(intent.priority),
            (Field::BlastRadius, _) => Value::Blast(intent.blast_radius),
            (Field::Action, action) => Value::Str(action.to_string()),
        })
    }

    /// The field as a reason shows it: empty if the intent has no such
    /// field.
    fn render(self, intent: &Intent) -> String {
        match self.value(intent) {
            None => String::new(),
            Some(Value::Str(s)) => s,
            Some(Value::Number(n)) => n.to_string(),
            Some(Value::Kind(k)) => k.name().to_string(),
            Some(Value::Priority(p)) => priority_name(p).to_string(),
            Some(Value::Blast(b)) => blast_name(b).to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    Apply,
    Scale,
    Destroy,
}

impl Kind {
    fn of(action: &Action) -> Kind {
        match action {
            Action::Apply { .. } => Kind::Apply,
            Action::Scale { .. } => Kind::Scale,
            Action::Destroy { .. } => Kind::Destroy,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Kind::Apply => "apply",
            Kind::Scale => "scale",
            Kind::Destroy => "destroy",
        }
    }
}

fn priority_name(p: Priority) -> &'static str {
    match p {
        Priority::Bulk => "bulk",
        Priority::Normal => "normal",
        Priority::Urgent => "urgent",
        Priority::Pager => "pager",
    }
}

fn blast_name(b: BlastRadius) -> &'static str {
    match b {
        BlastRadius::Cell => "cell",
        BlastRadius::Service => "service",
        BlastRadius::Region => "region",
        BlastRadius::Global => "global",
    }
}

/// A value in a condition, or a field's value for an intent.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Value {
    Str(String),
    Number(u32),
    Kind(Kind),
    Priority(Priority),
    Blast(BlastRadius),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl Op {
    fn ordering(self) -> bool {
        !matches!(self, Op::Eq | Op::Ne)
    }

    fn test(self, actual: &Value, expected: &Value) -> bool {
        match self {
            Op::Eq => actual == expected,
            Op::Ne => actual != expected,
            Op::Lt => actual < expected,
            Op::Le => actual <= expected,
            Op::Gt => actual > expected,
            Op::Ge => actual >= expected,
        }
    }
}

/// A condition, checked against the field types when it was parsed.
#[derive(Clone, Debug)]
enum Cond {
    Const(bool),
    Destructive,
    Not(Box<Cond>),
    And(Vec<Cond>),
    Or(Vec<Cond>),
    Compare(Field, Op, Value),
    In(Field, Vec<Value>),
    Matches(Field, String),
}

impl Cond {
    fn holds(&self, intent: &Intent) -> bool {
        match self {
            Cond::Const(b) => *b,
            Cond::Destructive => intent.action.is_destructive(),
            Cond::Not(c) => !c.holds(intent),
            Cond::And(cs) => cs.iter().all(|c| c.holds(intent)),
            Cond::Or(cs) => cs.iter().any(|c| c.holds(intent)),
            Cond::Compare(field, op, expected) => field
                .value(intent)
                .is_some_and(|actual| op.test(&actual, expected)),
            Cond::In(field, values) => field
                .value(intent)
                .is_some_and(|actual| values.contains(&actual)),
            Cond::Matches(field, pattern) => match field.value(intent) {
                Some(Value::Str(s)) => glob(pattern, &s),
                _ => false,
            },
        }
    }
}

/// Whether `text` matches `pattern` as a whole, `*` standing for any run of
/// characters.
fn glob(pattern: &str, text: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == text;
    }
    let (first, last) = (parts[0], parts[parts.len() - 1]);
    if text.len() < first.len() + last.len() || !text.starts_with(first) || !text.ends_with(last) {
        return false;
    }
    let mut rest = &text[first.len()..text.len() - last.len()];
    for part in &parts[1..parts.len() - 1] {
        match rest.find(part) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }
    true
}

// ---------------------------------------------------------------- lexing

#[derive(Clone, Debug, PartialEq, Eq)]
enum Tok {
    Word(String),
    Str(String),
    Number(u64),
    Op(Op),
    Open(char),
    Close(char),
    Comma,
}

#[derive(Clone, Debug)]
struct Token {
    tok: Tok,
    line: usize,
    column: usize,
}

fn error(line: usize, column: usize, problem: impl Into<String>) -> ParseError {
    ParseError {
        line,
        column,
        problem: problem.into(),
    }
}

/// Where the text ends, for "expected ... at the end" errors.
fn end_of(text: &str) -> (usize, usize) {
    let line = text.matches('\n').count() + 1;
    let column = text.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    (line, column)
}

/// The characters of a rules file, with the line and column of the next.
struct Cursor<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
    line: usize,
    column: usize,
}

impl Cursor<'_> {
    fn peek(&mut self) -> Option<char> {
        self.chars.peek().copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.chars.next()?;
        if c == '\n' {
            self.line += 1;
            self.column = 1;
        } else {
            self.column += 1;
        }
        Some(c)
    }
}

fn lex(text: &str) -> Result<Vec<Token>, ParseError> {
    let mut tokens = Vec::new();
    let mut at = Cursor {
        chars: text.chars().peekable(),
        line: 1,
        column: 1,
    };
    while let Some(c) = at.peek() {
        let (line, column) = (at.line, at.column);
        let tok = match c {
            ' ' | '\t' | '\r' | '\n' => {
                at.bump();
                continue;
            }
            '#' => {
                while at.peek().is_some_and(|c| c != '\n') {
                    at.bump();
                }
                continue;
            }
            '{' | '[' | '(' => {
                at.bump();
                Tok::Open(c)
            }
            '}' | ']' | ')' => {
                at.bump();
                Tok::Close(c)
            }
            ',' => {
                at.bump();
                Tok::Comma
            }
            '=' | '!' | '<' | '>' => {
                at.bump();
                let eq = at.peek() == Some('=');
                if eq {
                    at.bump();
                }
                Tok::Op(match (c, eq) {
                    ('=', true) => Op::Eq,
                    ('!', true) => Op::Ne,
                    ('<', false) => Op::Lt,
                    ('<', true) => Op::Le,
                    ('>', false) => Op::Gt,
                    ('>', true) => Op::Ge,
                    _ => {
                        return Err(error(
                            line,
                            column,
                            format!("unknown operator '{c}' (did you mean '{c}='?)"),
                        ))
                    }
                })
            }
            '"' => {
                at.bump();
                let mut s = String::new();
                loop {
                    let (l, col) = (at.line, at.column);
                    match at.bump() {
                        None => return Err(error(line, column, "the string is not closed")),
                        Some('"') => break,
                        Some('\n') => {
                            return Err(error(line, column, "a string cannot span lines"))
                        }
                        Some('\\') => match at.bump() {
                            Some('"') => s.push('"'),
                            Some('\\') => s.push('\\'),
                            Some('n') => s.push('\n'),
                            Some('t') => s.push('\t'),
                            _ => {
                                return Err(error(
                                    l,
                                    col,
                                    "unknown escape (use \\\", \\\\, \\n or \\t)",
                                ))
                            }
                        },
                        Some(c) if c.is_control() && c != '\t' => {
                            return Err(error(l, col, "a control character in a string"))
                        }
                        Some(c) => s.push(c),
                    }
                }
                Tok::Str(s)
            }
            '0'..='9' => {
                let mut digits = String::new();
                while let Some(d) = at.peek().filter(char::is_ascii_digit) {
                    digits.push(d);
                    at.bump();
                }
                if digits.len() > 1 && digits.starts_with('0') {
                    return Err(error(line, column, "a number may not start with 0"));
                }
                match digits.parse::<u64>() {
                    Ok(n) => Tok::Number(n),
                    Err(_) => return Err(error(line, column, "the number is too large")),
                }
            }
            c if c.is_ascii_alphabetic() || c == '_' => {
                let mut word = String::new();
                while let Some(w) = at.peek().filter(|w| w.is_ascii_alphanumeric() || *w == '_') {
                    word.push(w);
                    at.bump();
                }
                Tok::Word(word)
            }
            c => return Err(error(line, column, format!("unexpected character {c:?}"))),
        };
        tokens.push(Token { tok, line, column });
    }
    Ok(tokens)
}

// --------------------------------------------------------------- parsing

struct Parser {
    tokens: Vec<Token>,
    next: usize,
    end: (usize, usize),
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.next)
    }

    /// The position of the next token, or of the end of the text.
    fn here(&self) -> (usize, usize) {
        self.peek().map_or(self.end, |t| (t.line, t.column))
    }

    fn fail<T>(&self, problem: impl Into<String>) -> Result<T, ParseError> {
        let (line, column) = self.here();
        Err(error(line, column, problem))
    }

    fn found(&self) -> String {
        match self.peek().map(|t| &t.tok) {
            None => "the end of the file".into(),
            Some(Tok::Word(w)) => format!("'{w}'"),
            Some(Tok::Str(s)) => format!("the string {s:?}"),
            Some(Tok::Number(n)) => format!("the number {n}"),
            Some(Tok::Op(op)) => format!("'{}'", op_text(*op)),
            Some(Tok::Open(c) | Tok::Close(c)) => format!("'{c}'"),
            Some(Tok::Comma) => "','".into(),
        }
    }

    fn take(&mut self) -> Option<Token> {
        let t = self.tokens.get(self.next).cloned();
        self.next += 1;
        t
    }

    fn at_word(&self, word: &str) -> bool {
        matches!(self.peek(), Some(Token { tok: Tok::Word(w), .. }) if w == word)
    }

    fn expect_word(&mut self, word: &str) -> Result<(), ParseError> {
        if self.at_word(word) {
            self.next += 1;
            Ok(())
        } else {
            self.fail(format!("expected '{word}', found {}", self.found()))
        }
    }

    fn expect(&mut self, tok: Tok, what: &str) -> Result<(), ParseError> {
        if self.peek().map(|t| &t.tok) == Some(&tok) {
            self.next += 1;
            Ok(())
        } else {
            self.fail(format!("expected {what}, found {}", self.found()))
        }
    }

    fn string(&mut self, what: &str) -> Result<(String, usize, usize), ParseError> {
        match self.peek().cloned() {
            Some(Token {
                tok: Tok::Str(s),
                line,
                column,
            }) => {
                self.next += 1;
                Ok((s, line, column))
            }
            _ => self.fail(format!(
                "expected {what} (a string), found {}",
                self.found()
            )),
        }
    }

    fn file(&mut self) -> Result<Vec<RulePolicy>, ParseError> {
        if !self.at_word("format") {
            return self.fail(format!(
                "a rules file starts with 'format {FORMAT}', found {}",
                self.found()
            ));
        }
        self.next += 1;
        match self.peek().map(|t| &t.tok) {
            Some(Tok::Number(n)) if *n == FORMAT => self.next += 1,
            Some(Tok::Number(n)) => {
                let n = *n;
                return self.fail(format!(
                    "this is rules format {n}; only format {FORMAT} is understood"
                ));
            }
            _ => {
                return self.fail(format!(
                    "expected the format number, found {}",
                    self.found()
                ))
            }
        }
        let mut policies: Vec<RulePolicy> = Vec::new();
        while self.peek().is_some() {
            let (line, column) = self.here();
            let policy = self.policy()?;
            if policies.iter().any(|p| p.name == policy.name) {
                return Err(error(
                    line,
                    column,
                    format!("a second policy named {:?}", policy.name),
                ));
            }
            policies.push(policy);
        }
        Ok(policies)
    }

    fn policy(&mut self) -> Result<RulePolicy, ParseError> {
        self.expect_word("policy")?;
        let (name, line, column) = self.string("the policy's name")?;
        let valid = (1..=64).contains(&name.len())
            && name.starts_with(|c: char| c.is_ascii_lowercase())
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !valid {
            return Err(error(
                line,
                column,
                format!(
                    "the policy name {name:?} is not 1 to 64 lowercase letters, digits and \
                     '-', starting with a letter"
                ),
            ));
        }
        if name == SIGNATURE_CHECK || name == CONFLICT_CHECK {
            return Err(error(
                line,
                column,
                format!("the policy name {name:?} is reserved for the plane's own check"),
            ));
        }
        self.expect(Tok::Open('{'), "'{' to open the policy")?;
        let mut rules = Vec::new();
        while !matches!(self.peek().map(|t| &t.tok), Some(Tok::Close('}')) | None) {
            rules.push(self.rule()?);
        }
        if rules.is_empty() {
            return self.fail(format!(
                "the policy {name:?} has no rules (expected 'reject' or 'defer')"
            ));
        }
        self.expect(Tok::Close('}'), "'}' to close the policy")?;
        Ok(RulePolicy { name, rules })
    }

    fn rule(&mut self) -> Result<Rule, ParseError> {
        let severity = if self.at_word("reject") {
            Severity::Reject
        } else if self.at_word("defer") {
            Severity::Defer
        } else {
            return self.fail(format!(
                "expected a rule ('reject' or 'defer') or '}}', found {}",
                self.found()
            ));
        };
        self.next += 1;
        let (text, line, column) = self.string("the rule's reason")?;
        let reason = template(&text).map_err(|problem| error(line, column, problem))?;
        self.expect_word("when")?;
        let when = self.or(0)?;
        Ok(Rule {
            severity,
            reason,
            when,
        })
    }

    fn or(&mut self, depth: usize) -> Result<Cond, ParseError> {
        let mut terms = vec![self.and(depth)?];
        while self.at_word("or") {
            self.next += 1;
            terms.push(self.and(depth)?);
        }
        Ok(if terms.len() == 1 {
            terms.pop().expect("one term")
        } else {
            Cond::Or(terms)
        })
    }

    fn and(&mut self, depth: usize) -> Result<Cond, ParseError> {
        let mut terms = vec![self.unary(depth)?];
        while self.at_word("and") {
            self.next += 1;
            terms.push(self.unary(depth)?);
        }
        Ok(if terms.len() == 1 {
            terms.pop().expect("one term")
        } else {
            Cond::And(terms)
        })
    }

    fn unary(&mut self, depth: usize) -> Result<Cond, ParseError> {
        if depth >= MAX_DEPTH {
            return self.fail(format!(
                "the condition nests more than {MAX_DEPTH} levels deep"
            ));
        }
        if self.at_word("not") {
            self.next += 1;
            return Ok(Cond::Not(Box::new(self.unary(depth + 1)?)));
        }
        if self.peek().map(|t| &t.tok) == Some(&Tok::Open('(')) {
            self.next += 1;
            let inner = self.or(depth + 1)?;
            self.expect(Tok::Close(')'), "')'")?;
            return Ok(inner);
        }
        self.atom()
    }

    fn atom(&mut self) -> Result<Cond, ParseError> {
        let Some(Token {
            tok: Tok::Word(word),
            line,
            column,
        }) = self.peek().cloned()
        else {
            return self.fail(format!("expected a condition, found {}", self.found()));
        };
        self.next += 1;
        match word.as_str() {
            "true" => return Ok(Cond::Const(true)),
            "false" => return Ok(Cond::Const(false)),
            "destructive" => return Ok(Cond::Destructive),
            _ => {}
        }
        let field = match Field::named(&word) {
            Some(Field::Action) | None => {
                return Err(error(
                    line,
                    column,
                    format!(
                        "unknown field '{word}' (a condition tests agent, resource, manifest, \
                         kind, replicas, priority or blast_radius, or is destructive, true or \
                         false)"
                    ),
                ))
            }
            Some(field) => field,
        };
        let ty = field.ty();
        // `not in` / `in`
        let negated = self.at_word("not");
        if negated {
            self.next += 1;
            if !self.at_word("in") {
                return self.fail(format!(
                    "expected 'in' after '{word} not', found {}",
                    self.found()
                ));
            }
        }
        if self.at_word("in") {
            self.next += 1;
            let values = self.list(field, &word)?;
            let test = Cond::In(field, values);
            return Ok(if negated {
                // A field the intent does not have stays false: `replicas
                // not in [..]` does not hold for a destroy.
                Cond::And(vec![Cond::Not(Box::new(test)), defined(field)])
            } else {
                test
            });
        }
        if self.at_word("matches") {
            self.next += 1;
            if ty != Type::Str {
                return Err(error(
                    line,
                    column,
                    format!("'{word}' is not a string, so it cannot be matched"),
                ));
            }
            let (pattern, _, _) = self.string("a pattern")?;
            return Ok(Cond::Matches(field, pattern));
        }
        let op = match self.peek().map(|t| t.tok.clone()) {
            Some(Tok::Op(op)) => op,
            _ => {
                return self.fail(format!(
                    "expected a comparison ('==', '!=', '<', '<=', '>', '>='), 'in', 'not in' \
                     or 'matches' after '{word}', found {}",
                    self.found()
                ))
            }
        };
        if op.ordering() && matches!(ty, Type::Str | Type::Kind) {
            return self.fail(format!(
                "'{word}' has no order, so it can only be compared with '==' or '!='"
            ));
        }
        self.next += 1;
        let value = self.value(field, &word)?;
        // A field the intent does not have fails every comparison, `!=`
        // included.
        Ok(Cond::Compare(field, op, value))
    }

    fn list(&mut self, field: Field, word: &str) -> Result<Vec<Value>, ParseError> {
        self.expect(Tok::Open('['), "'[' to open the list")?;
        let mut values = Vec::new();
        loop {
            if self.peek().map(|t| &t.tok) == Some(&Tok::Close(']')) {
                if values.is_empty() {
                    return self.fail("an empty list");
                }
                self.next += 1;
                return Ok(values);
            }
            values.push(self.value(field, word)?);
            match self.peek().map(|t| &t.tok) {
                Some(Tok::Comma) => self.next += 1,
                Some(Tok::Close(']')) => {}
                _ => {
                    return self.fail(format!(
                        "expected ',' or ']' in the list, found {}",
                        self.found()
                    ))
                }
            }
        }
    }

    /// A literal of `field`'s type.
    fn value(&mut self, field: Field, word: &str) -> Result<Value, ParseError> {
        let (line, column) = self.here();
        let wrong = |what: &str| Err(error(line, column, format!("'{word}' is {what}")));
        let token = self.take().map(|t| t.tok);
        match (field.ty(), token) {
            (Type::Str, Some(Tok::Str(s))) => Ok(Value::Str(s)),
            (Type::Str, _) => wrong("a string, so compare it with a string in double quotes"),
            (Type::Number, Some(Tok::Number(n))) => match u32::try_from(n) {
                Ok(n) => Ok(Value::Number(n)),
                Err(_) => wrong("a number of replicas, at most 4294967295"),
            },
            (Type::Number, _) => wrong("a whole number"),
            (Type::Kind, Some(Tok::Word(w))) => match w.as_str() {
                "apply" => Ok(Value::Kind(Kind::Apply)),
                "scale" => Ok(Value::Kind(Kind::Scale)),
                "destroy" => Ok(Value::Kind(Kind::Destroy)),
                _ => wrong("apply, scale or destroy"),
            },
            (Type::Kind, _) => wrong("apply, scale or destroy"),
            (Type::Priority, Some(Tok::Word(w))) => match w.as_str() {
                "bulk" => Ok(Value::Priority(Priority::Bulk)),
                "normal" => Ok(Value::Priority(Priority::Normal)),
                "urgent" => Ok(Value::Priority(Priority::Urgent)),
                "pager" => Ok(Value::Priority(Priority::Pager)),
                _ => wrong("bulk, normal, urgent or pager"),
            },
            (Type::Priority, _) => wrong("bulk, normal, urgent or pager"),
            (Type::Blast, Some(Tok::Word(w))) => match w.as_str() {
                "cell" => Ok(Value::Blast(BlastRadius::Cell)),
                "service" => Ok(Value::Blast(BlastRadius::Service)),
                "region" => Ok(Value::Blast(BlastRadius::Region)),
                "global" => Ok(Value::Blast(BlastRadius::Global)),
                _ => wrong("cell, service, region or global"),
            },
            (Type::Blast, _) => wrong("cell, service, region or global"),
        }
    }
}

/// A condition that holds when the intent has `field`.
fn defined(field: Field) -> Cond {
    match field {
        Field::Manifest => Cond::Compare(Field::Kind, Op::Eq, Value::Kind(Kind::Apply)),
        Field::Replicas => Cond::Compare(Field::Kind, Op::Eq, Value::Kind(Kind::Scale)),
        _ => Cond::Const(true),
    }
}

fn op_text(op: Op) -> &'static str {
    match op {
        Op::Eq => "==",
        Op::Ne => "!=",
        Op::Lt => "<",
        Op::Le => "<=",
        Op::Gt => ">",
        Op::Ge => ">=",
    }
}

/// A reason's text and the fields it names in braces.
fn template(text: &str) -> Result<Vec<Piece>, String> {
    if text.trim().is_empty() {
        return Err("a rule's reason may not be empty".into());
    }
    let mut pieces = Vec::new();
    let mut literal = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '{' if chars.peek() == Some(&'{') => {
                chars.next();
                literal.push('{');
            }
            '}' if chars.peek() == Some(&'}') => {
                chars.next();
                literal.push('}');
            }
            '}' => return Err("a '}' in a reason must be written '}}'".into()),
            '{' => {
                let mut name = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some(c) => name.push(c),
                        None => {
                            return Err(format!(
                                "the reason's '{{{name}' is not closed (a literal '{{' is \
                                 written '{{{{')"
                            ))
                        }
                    }
                }
                let field = Field::named(&name).ok_or_else(|| {
                    format!(
                        "the reason names '{{{name}}}', which is not agent, kind, resource, \
                         manifest, replicas, priority, blast_radius or action"
                    )
                })?;
                if !literal.is_empty() {
                    pieces.push(Piece::Text(std::mem::take(&mut literal)));
                }
                pieces.push(Piece::Field(field));
            }
            c => literal.push(c),
        }
    }
    if !literal.is_empty() {
        pieces.push(Piece::Text(literal));
    }
    Ok(pieces)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intent::{AgentId, IntentKey};
    use crate::policy::{BlastNeedsPriority, NoGlobalDestroy, ResourceAllowlist};
    use crate::{Admission, Floodwall, RateLimit, Verdict};

    const STANDARD: &str = include_str!("../policies/standard.rules");

    const PRIORITIES: [Priority; 4] = [
        Priority::Bulk,
        Priority::Normal,
        Priority::Urgent,
        Priority::Pager,
    ];
    const BLASTS: [BlastRadius; 4] = [
        BlastRadius::Cell,
        BlastRadius::Service,
        BlastRadius::Region,
        BlastRadius::Global,
    ];

    fn intent(agent: &str, action: Action, priority: Priority, blast: BlastRadius) -> Intent {
        Intent::new(1, AgentId::new(agent), action, priority, blast)
    }

    fn apply(resource: &str, manifest: &str) -> Action {
        Action::Apply {
            resource: resource.into(),
            manifest: manifest.into(),
        }
    }

    fn scale(resource: &str, replicas: u32) -> Action {
        Action::Scale {
            resource: resource.into(),
            replicas,
        }
    }

    fn destroy(resource: &str) -> Action {
        Action::Destroy {
            resource: resource.into(),
        }
    }

    /// Every action this module's tests rule on.
    fn actions() -> Vec<Action> {
        let mut all = Vec::new();
        for resource in ["web", "api", "cache", "billing", "ledger-db", ""] {
            all.push(apply(resource, "v2"));
            all.push(scale(resource, 0));
            all.push(scale(resource, 3));
            all.push(destroy(resource));
        }
        all
    }

    fn one(text: &str) -> RulePolicy {
        let mut policies = parse(text).unwrap_or_else(|e| panic!("{text}\n{e}"));
        assert_eq!(policies.len(), 1);
        policies.pop().unwrap()
    }

    /// Whether `condition` holds for `intent`.
    fn holds(condition: &str, intent: &Intent) -> bool {
        let policy = one(&format!(
            "format 1 policy \"p\" {{ reject \"r\" when {condition} }}"
        ));
        !policy.evaluate(intent).is_admit()
    }

    #[test]
    fn the_standard_rules_are_the_built_in_policies() {
        let policies = parse(STANDARD).unwrap();
        let names: Vec<&str> = policies.iter().map(|p| p.name()).collect();
        assert_eq!(
            names,
            [
                "no-global-destroy",
                "blast-needs-priority",
                "resource-allowlist"
            ]
        );
        let built_in: Vec<Box<dyn Policy>> = vec![
            Box::new(NoGlobalDestroy),
            Box::new(BlastNeedsPriority),
            Box::new(ResourceAllowlist::new(["web", "api", "cache"])),
        ];
        let mut checked = 0;
        for action in actions() {
            for priority in PRIORITIES {
                for blast in BLASTS {
                    let i = intent("bot", action.clone(), priority, blast);
                    for (rules, rust) in policies.iter().zip(&built_in) {
                        assert_eq!(rules.name(), rust.name());
                        let (got, want) = (rules.evaluate(&i), rust.evaluate(&i));
                        assert_eq!(got.label(), want.label(), "{} on {i:?}", rust.name());
                        // The same reasons, but that BlastNeedsPriority
                        // writes its enums capitalized ("Global", "Bulk").
                        let want_reason = match rust.name() {
                            "blast-needs-priority" => want.reason().map(str::to_lowercase),
                            _ => want.reason().map(str::to_string),
                        };
                        assert_eq!(
                            got.reason().map(str::to_string),
                            want_reason,
                            "{} on {i:?}",
                            rust.name()
                        );
                        checked += 1;
                    }
                }
            }
        }
        assert_eq!(checked, 24 * 16 * 3);
        // And a gate built from them decides as the built-in gate does.
        let rules_gate = Gate::new().with_rules(STANDARD).unwrap();
        let rust_gate = Gate::new()
            .with(NoGlobalDestroy)
            .with(BlastNeedsPriority)
            .with(ResourceAllowlist::new(["web", "api", "cache"]));
        assert_eq!(rules_gate.len(), 3);
        for action in actions() {
            for priority in PRIORITIES {
                for blast in BLASTS {
                    let i = intent("bot", action.clone(), priority, blast);
                    assert_eq!(
                        rules_gate.evaluate(&i).verdict.label(),
                        rust_gate.evaluate(&i).verdict.label()
                    );
                }
            }
        }
    }

    #[test]
    fn every_field_can_be_tested() {
        let web = intent(
            "deployer",
            apply("web", "v2"),
            Priority::Normal,
            BlastRadius::Service,
        );
        let five = intent(
            "autoscaler",
            scale("billing-eu", 5),
            Priority::Urgent,
            BlastRadius::Region,
        );
        let zero = intent(
            "autoscaler",
            scale("api", 0),
            Priority::Bulk,
            BlastRadius::Cell,
        );
        let gone = intent(
            "reaper",
            destroy("ledger-db"),
            Priority::Pager,
            BlastRadius::Global,
        );
        let cases: &[(&str, &Intent, bool)] = &[
            // Strings: equality, lists and patterns.
            ("agent == \"deployer\"", &web, true),
            ("agent != \"deployer\"", &web, false),
            ("agent in [\"reaper\", \"deployer\"]", &web, true),
            ("agent not in [\"reaper\", \"deployer\"]", &web, false),
            ("agent not in [\"reaper\"]", &web, true),
            ("resource matches \"billing*\"", &five, true),
            ("resource matches \"*-eu\"", &five, true),
            ("resource matches \"*ll*eu\"", &five, true),
            ("resource matches \"billing\"", &five, false),
            ("resource matches \"*\"", &gone, true),
            ("resource == \"Web\"", &web, false),
            // A manifest only for an apply; a test of one a scale lacks is
            // false, whatever the test.
            ("manifest == \"v2\"", &web, true),
            ("manifest matches \"v*\"", &web, true),
            ("manifest == \"v2\"", &five, false),
            ("manifest != \"v2\"", &five, false),
            ("manifest not in [\"v1\"]", &five, false),
            ("manifest matches \"*\"", &five, false),
            ("not manifest == \"v2\"", &five, true),
            // Kinds.
            ("kind == apply", &web, true),
            ("kind != apply", &web, false),
            ("kind in [scale, destroy]", &gone, true),
            ("kind not in [scale, destroy]", &gone, false),
            // Replicas only for a scale, and ordered.
            ("replicas == 5", &five, true),
            ("replicas != 5", &five, false),
            ("replicas < 5", &five, false),
            ("replicas <= 5", &five, true),
            ("replicas > 4", &five, true),
            ("replicas >= 6", &five, false),
            ("replicas in [1, 5]", &five, true),
            ("replicas == 0", &zero, true),
            ("replicas < 100", &gone, false),
            ("replicas != 3", &gone, false),
            ("replicas not in [3]", &gone, false),
            ("replicas not in [3]", &five, true),
            ("not replicas < 100", &gone, true),
            // Priority and blast radius, ordered.
            ("priority == normal", &web, true),
            ("priority < urgent", &web, true),
            ("priority >= urgent", &five, true),
            ("priority > pager", &gone, false),
            ("priority <= bulk", &zero, true),
            ("priority in [urgent, pager]", &gone, true),
            ("blast_radius == global", &gone, true),
            ("blast_radius >= region", &five, true),
            ("blast_radius < service", &zero, true),
            ("blast_radius != cell", &zero, false),
            ("blast_radius not in [cell, service]", &five, true),
            // Destructive: a destroy, or a scale to zero.
            ("destructive", &gone, true),
            ("destructive", &zero, true),
            ("destructive", &five, false),
            ("destructive", &web, false),
            ("true", &web, true),
            ("false", &web, false),
            // `not` binds tightest, then `and`, then `or`.
            ("true or false and false", &web, true),
            ("(true or false) and false", &web, false),
            ("not true or true", &web, true),
            ("not (true or true)", &web, false),
            ("not not true", &web, true),
            (
                "kind == apply and agent == \"deployer\" or destructive",
                &zero,
                true,
            ),
            (
                "kind == apply and (agent == \"deployer\" or destructive)",
                &zero,
                false,
            ),
        ];
        for (condition, i, want) in cases {
            assert_eq!(holds(condition, i), *want, "{condition} on {i:?}");
        }
    }

    #[test]
    fn patterns_match_whole_strings() {
        for (pattern, text, want) in [
            ("", "", true),
            ("", "a", false),
            ("*", "", true),
            ("*", "anything", true),
            ("a*", "a", true),
            ("a*", "ba", false),
            ("*a", "ba", true),
            ("*a", "ab", false),
            ("a*a", "a", false),
            ("a*a", "aa", true),
            ("ab*b", "abb", true),
            ("a**b", "ab", true),
            ("*b*b*", "abcb", true),
            ("*b*b*", "abc", false),
            ("a*b*c", "a-c-b-c", true),
            ("a*b*c", "a-c-c", false),
            ("dé*", "déployeur", true),
        ] {
            assert_eq!(glob(pattern, text), want, "{pattern:?} on {text:?}");
        }
    }

    #[test]
    fn the_harshest_rule_holds_and_the_first_reason_breaks_ties() {
        let policy = one("format 1
             policy \"p\" {
               defer \"first defer\" when true
               defer \"second defer\" when true
               reject \"first reject\" when kind == destroy
               reject \"second reject\" when kind == destroy
               defer \"never\" when false
             }");
        assert_eq!(policy.len(), 5);
        let web = intent("a", apply("web", ""), Priority::Normal, BlastRadius::Cell);
        let gone = intent("a", destroy("web"), Priority::Normal, BlastRadius::Cell);
        assert_eq!(policy.evaluate(&web), Verdict::Defer("first defer".into()));
        assert_eq!(
            policy.evaluate(&gone),
            Verdict::Reject("first reject".into())
        );
        let quiet = one("format 1 policy \"p\" { reject \"r\" when false }");
        assert_eq!(quiet.evaluate(&web), Verdict::Admit);
    }

    #[test]
    fn reasons_name_the_intents_fields() {
        let policy = one("format 1 policy \"p\" {
               reject \"{agent} {kind} {resource} [{manifest}] [{replicas}] {priority} \
{blast_radius} ({action}) {{literal}} \\\"q\\\"\\tt\" when true
             }");
        let five = intent(
            "autoscaler",
            scale("web", 5),
            Priority::Urgent,
            BlastRadius::Region,
        );
        assert_eq!(
            policy.evaluate(&five),
            Verdict::Reject(
                "autoscaler scale web [] [5] urgent region (scale web to 5) {literal} \"q\"\tt"
                    .into()
            )
        );
        let web = intent("d", apply("api", "v9"), Priority::Bulk, BlastRadius::Cell);
        assert_eq!(
            policy.evaluate(&web).reason(),
            Some("d apply api [v9] [] bulk cell (apply api) {literal} \"q\"\tt")
        );
    }

    #[test]
    fn malformed_files_are_refused_saying_where_and_why() {
        let p = |body: &str| format!("format 1\npolicy \"p\" {{\n  {body}\n}}\n");
        let cases: Vec<(String, usize, usize, &str)> = vec![
            ("".into(), 1, 1, "a rules file starts with 'format 1', found the end of the file"),
            ("policy \"p\" {}".into(), 1, 1, "a rules file starts with 'format 1'"),
            ("format 2".into(), 1, 8, "this is rules format 2; only format 1 is understood"),
            ("format x".into(), 1, 8, "expected the format number, found 'x'"),
            ("format 1 rule".into(), 1, 10, "expected 'policy', found 'rule'"),
            ("format 1 policy p {}".into(), 1, 17, "expected the policy's name (a string), found 'p'"),
            ("format 1 policy \"Bad Name\" { reject \"r\" when true }".into(), 1, 17, "is not 1 to 64 lowercase letters"),
            ("format 1 policy \"\" { reject \"r\" when true }".into(), 1, 17, "is not 1 to 64 lowercase letters"),
            ("format 1 policy \"conflict-window\" { reject \"r\" when true }".into(), 1, 17, "reserved for the plane's own check"),
            ("format 1 policy \"agent-signature\" { reject \"r\" when true }".into(), 1, 17, "reserved for the plane's own check"),
            ("format 1 policy \"p\" reject".into(), 1, 21, "expected '{' to open the policy, found 'reject'"),
            ("format 1 policy \"p\" { }".into(), 1, 23, "the policy \"p\" has no rules"),
            ("format 1 policy \"p\" { reject \"r\" when true".into(), 1, 43, "expected '}' to close the policy, found the end of the file"),
            ("format 1 policy \"p\" { reject \"r\" when true }\npolicy \"p\" { defer \"d\" when true }".into(), 2, 1, "a second policy named \"p\""),
            (p("admit \"r\" when true"), 3, 3, "expected a rule ('reject' or 'defer') or '}', found 'admit'"),
            (p("reject when true"), 3, 10, "expected the rule's reason (a string), found 'when'"),
            (p("reject \"r\" if true"), 3, 14, "expected 'when', found 'if'"),
            (p("reject \"\" when true"), 3, 10, "a rule's reason may not be empty"),
            (p("reject \"{who}\" when true"), 3, 10, "the reason names '{who}'"),
            (p("reject \"{agent\" when true"), 3, 10, "is not closed"),
            (p("reject \"a } b\" when true"), 3, 10, "a '}' in a reason must be written '}}'"),
            (p("reject \"r\" when"), 4, 1, "expected a condition, found '}'"),
            (p("reject \"r\" when owner == \"x\""), 3, 19, "unknown field 'owner'"),
            (p("reject \"r\" when action == \"x\""), 3, 19, "unknown field 'action'"),
            (p("reject \"r\" when agent < \"x\""), 3, 25, "'agent' has no order"),
            (p("reject \"r\" when kind >= apply"), 3, 24, "'kind' has no order"),
            (p("reject \"r\" when agent == deployer"), 3, 28, "'agent' is a string"),
            (p("reject \"r\" when priority == \"high\""), 3, 31, "'priority' is bulk, normal, urgent or pager"),
            (p("reject \"r\" when priority == high"), 3, 31, "'priority' is bulk, normal, urgent or pager"),
            (p("reject \"r\" when blast_radius == planet"), 3, 35, "'blast_radius' is cell, service, region or global"),
            (p("reject \"r\" when kind == restart"), 3, 27, "'kind' is apply, scale or destroy"),
            (p("reject \"r\" when replicas == \"3\""), 3, 31, "'replicas' is a whole number"),
            (p("reject \"r\" when replicas == 4294967296"), 3, 31, "at most 4294967295"),
            (p("reject \"r\" when replicas == 99999999999999999999999"), 3, 31, "the number is too large"),
            (p("reject \"r\" when replicas == 03"), 3, 31, "a number may not start with 0"),
            (p("reject \"r\" when priority matches \"u*\""), 3, 19, "'priority' is not a string"),
            (p("reject \"r\" when agent"), 4, 1, "expected a comparison"),
            (p("reject \"r\" when agent not == \"x\""), 3, 29, "expected 'in' after 'agent not'"),
            (p("reject \"r\" when agent in []"), 3, 29, "an empty list"),
            (p("reject \"r\" when agent in [\"a\" \"b\"]"), 3, 33, "expected ',' or ']' in the list"),
            (p("reject \"r\" when agent in \"a\""), 3, 28, "expected '[' to open the list"),
            (p("reject \"r\" when (true"), 4, 1, "expected ')'"),
            (p("reject \"r\" when true and"), 4, 1, "expected a condition"),
            (p("reject \"r\" when agent = \"x\""), 3, 25, "unknown operator '='"),
            (p("reject \"r\" when agent == \"x"), 3, 28, "a string cannot span lines"),
            (p("reject \"r\" when agent == \"x\\q\""), 3, 30, "unknown escape"),
            (p("reject \"r\" when agent == \"x\" ; true"), 3, 32, "unexpected character ';'"),
            ("format 1 policy \"p\" { reject \"r\" when true } }".into(), 1, 46, "expected 'policy', found '}'"),
            ("format 1 policy \"p\" { reject \"r\u{1}\" when true }".into(), 1, 32, "a control character in a string"),
        ];
        for (text, line, column, problem) in cases {
            match parse(&text) {
                Ok(_) => panic!("{text:?} parsed"),
                Err(e) => {
                    assert!(e.problem.contains(problem), "{text:?}: {e}");
                    assert_eq!((e.line, e.column), (line, column), "{text:?}: {e}");
                }
            }
        }
        let e = parse("format 2").unwrap_err();
        assert_eq!(
            e.to_string(),
            "line 1, column 8: this is rules format 2; only format 1 is understood"
        );
        // Comments and layout are free.
        assert!(parse("# rules\n\tformat 1 # the version\n")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn deep_nesting_is_refused_without_exhausting_the_stack() {
        let nested = |n: usize| {
            format!(
                "format 1 policy \"p\" {{ reject \"r\" when {}true{} }}",
                "(".repeat(n),
                ")".repeat(n)
            )
        };
        assert!(parse(&nested(MAX_DEPTH - 1)).is_ok());
        assert!(parse(&nested(MAX_DEPTH + 1))
            .unwrap_err()
            .problem
            .starts_with("the condition nests more than"));
        assert!(parse(&nested(100_000)).is_err());
        let nots = format!(
            "format 1 policy \"p\" {{ reject \"r\" when {}true }}",
            "not ".repeat(100_000)
        );
        assert!(parse(&nots).is_err());
    }

    #[test]
    fn a_gate_built_from_rules_rules_at_the_wall() {
        assert_eq!(
            Gate::new()
                .with_rules("format 1 policy")
                .err()
                .map(|e| e.line),
            Some(1)
        );
        let gate = Gate::new()
            .with_rules(
                "format 1
                 policy \"freeze-billing\" {
                   reject \"billing is frozen\" when resource matches \"billing*\" and kind != scale
                   defer \"only the autoscaler scales billing\"
                     when resource matches \"billing*\" and agent != \"autoscaler\"
                 }",
            )
            .unwrap()
            .with_rules(STANDARD)
            .unwrap();
        let mut plane = Floodwall::new(Admission::new(64, RateLimit::new(8.0, 1.0)), gate);
        let submit = |plane: &mut Floodwall, id, agent: &str, action| {
            plane
                .submit(
                    intent(agent, action, Priority::Normal, BlastRadius::Service),
                    0,
                )
                .unwrap();
            IntentKey::new(agent, id)
        };
        submit(&mut plane, 1, "deployer", apply("billing", "v2"));
        submit(&mut plane, 1, "ops", scale("billing-eu", 3));
        submit(&mut plane, 1, "autoscaler", scale("billing", 4));
        submit(&mut plane, 1, "reaper", destroy("web"));
        let report = plane.tick(0);
        let got: Vec<(String, &str)> = report
            .decisions
            .iter()
            .map(|d| (d.intent.agent.to_string(), d.verdict.label()))
            .collect();
        assert_eq!(
            got,
            [
                ("deployer".into(), "reject"),
                ("ops".into(), "defer"),
                ("autoscaler".into(), "defer"), // off the allowlist
                ("reaper".into(), "admit"),
            ]
        );
        // The breakdown names each policy from the file.
        let names: Vec<&str> = report.decisions[0]
            .breakdown
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(
            names,
            [
                "freeze-billing",
                "no-global-destroy",
                "blast-needs-priority",
                "resource-allowlist",
                crate::CONFLICT_CHECK
            ]
        );
        assert_eq!(
            report.decisions[0].verdict.reason(),
            Some("billing is frozen")
        );
    }

    /// Mangled versions of the standard file never panic.
    #[test]
    fn arbitrary_input_never_panics() {
        const SPICE: &[u8] = b"{}[]()\",=!<>#*\\ \n\tnotandorinmatches";
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut parsed = 0;
        for _ in 0..5_000 {
            let mut b = STANDARD.as_bytes().to_vec();
            for _ in 0..1 + next() % 3 {
                let i = (next() % b.len() as u64) as usize;
                match next() % 3 {
                    0 => b[i] = SPICE[(next() % SPICE.len() as u64) as usize],
                    1 => {
                        b.remove(i);
                    }
                    _ => b.insert(i, SPICE[(next() % SPICE.len() as u64) as usize]),
                }
                if b.is_empty() {
                    break;
                }
            }
            if let Ok(text) = std::str::from_utf8(&b) {
                if let Ok(policies) = parse(text) {
                    parsed += 1;
                    let i = intent("x", destroy("y"), Priority::Bulk, BlastRadius::Global);
                    for p in policies {
                        let _ = p.evaluate(&i);
                    }
                }
            }
        }
        assert!(parsed > 50, "{parsed}");
    }
}
