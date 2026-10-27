// The console's in-memory plane. Every event here is a stand-in for a call
// into the Rust plane (submit, tick, release, expire, complete).

import { MOCK_INTENTS, MOCK_LEDGER_EVENTS, MOCK_START_TICK } from "../constants/console-mock";
import type { Intent, LedgerEvent, LedgerRecord, PlaneEvent, PlaneState } from "../types/console";
import { describeAction, mockCombine, mockGate } from "./gate";
import { mockAppend } from "./ledger";

/** The seed intents with their verdicts filled in, and a ledger that matches them. */
export const INITIAL_PLANE: PlaneState = {
  tick: MOCK_START_TICK,
  intents: MOCK_INTENTS.map((intent) => (intent.status === "queued" ? intent : { ...intent, verdicts: mockGate(intent) })),
  ledger: MOCK_LEDGER_EVENTS.reduce(mockAppend, [] as LedgerRecord[]),
};

/** The id the plane gives the next submitted intent. */
export function nextIntentId(state: PlaneState) {
  return Math.max(0, ...state.intents.map((i) => i.id)) + 1;
}

function patchIntent(state: PlaneState, id: number, patch: Partial<Intent>): Intent[] {
  return state.intents.map((intent) => (intent.id === id ? { ...intent, ...patch } : intent));
}

function record(state: PlaneState, intent: Intent, event: Pick<LedgerEvent, "kind" | "verdict" | "summary">) {
  return mockAppend(state.ledger, { tick: state.tick, intentId: intent.id, agent: intent.agent, ...event });
}

function gateOne(state: PlaneState, intent: Intent, releasedBy?: string): PlaneState {
  const verdicts = mockGate(intent, Boolean(releasedBy));
  const verdict = mockCombine(verdicts);
  const status = verdict === "admit" ? "in-flight" : verdict === "defer" ? "held" : "rejected";
  const summary = verdicts.find((v) => v.verdict === verdict && v.reason)?.reason ?? describeAction(intent.action);
  return {
    ...state,
    intents: patchIntent(state, intent.id, { status, verdicts, releasedBy }),
    ledger: record(state, intent, { kind: "decision", verdict, summary }),
  };
}

export function planeReducer(state: PlaneState, event: PlaneEvent): PlaneState {
  switch (event.type) {
    case "submit": {
      const intent: Intent = { ...event.intent, id: event.id, status: "queued", submittedAt: state.tick };
      return { ...state, intents: [...state.intents, intent] };
    }
    case "tick": {
      const queued = state.intents.filter((i) => i.status === "queued");
      const next = queued.reduce((s, intent) => gateOne(s, intent), state);
      return { ...next, tick: state.tick + 1 };
    }
    case "release": {
      const intent = state.intents.find((i) => i.id === event.id);
      if (!intent || intent.status !== "held") return state;
      const released = { ...state, ledger: record(state, intent, { kind: "release", summary: `released by ${event.by}` }) };
      return gateOne(released, intent, event.by);
    }
    case "expire": {
      const intent = state.intents.find((i) => i.id === event.id);
      if (!intent || intent.status !== "held") return state;
      return {
        ...state,
        intents: patchIntent(state, intent.id, { status: "expired" }),
        ledger: record(state, intent, { kind: "expiry", summary: `expired by ${event.by}` }),
      };
    }
    case "complete": {
      const intent = state.intents.find((i) => i.id === event.id);
      if (!intent || intent.status !== "in-flight") return state;
      return {
        ...state,
        intents: patchIntent(state, intent.id, { status: event.outcome }),
        ledger: record(state, intent, { kind: "outcome", summary: event.outcome }),
      };
    }
  }
}
