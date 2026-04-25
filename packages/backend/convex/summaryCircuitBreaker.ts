/**
 * Process-local circuit breaker for summary generation LLM calls.
 *
 * Motivation: in a sustained OpenAI outage, thousands of users hitting the
 * "Generate summary" button simultaneously would each queue a 30-90 second
 * retry ladder before surfacing failure. That wastes capacity, amplifies
 * 429s, and eats quota. The circuit breaker short-circuits further LLM
 * attempts for a cool-down window after a failure burst, letting callers
 * fall back to the deterministic summary immediately.
 *
 * State transitions (classic 3-state breaker):
 *   closed   → normal operation, failures counted in a rolling window
 *   open     → short-circuit every call for COOL_DOWN_MS
 *   half-open → after cool-down, allow a single probe; success closes,
 *               failure re-opens
 *
 * State lives in module scope (one per Convex server process). That is
 * acceptable because:
 *   - Each process independently observes its own failure rate.
 *   - When upstream is healthy for any process, requests sent to it go
 *     through — the breaker degrades gracefully rather than hard-gating
 *     the whole fleet.
 *   - No persistence is needed; on process restart the breaker starts
 *     closed, which is the safe default.
 */

const FAILURE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 10;
const COOL_DOWN_MS = 30_000;

type BreakerState = "closed" | "open" | "half_open";

type BreakerSnapshot = {
  state: BreakerState;
  failuresInWindow: number;
  openUntilMs: number | null;
  halfOpenProbeInFlight: boolean;
};

const recentFailureTimestampsMs: number[] = [];
let openUntilMs: number | null = null;
let halfOpenProbeInFlight = false;

export class CircuitOpenError extends Error {
  readonly openUntilMs: number;

  constructor(openUntilMs: number) {
    super("Summary generation circuit breaker is open.");
    this.name = "CircuitOpenError";
    this.openUntilMs = openUntilMs;
  }
}

function pruneWindow(nowMs: number): void {
  const cutoff = nowMs - FAILURE_WINDOW_MS;
  while (recentFailureTimestampsMs.length > 0) {
    const first = recentFailureTimestampsMs[0];

    if (first === undefined || first >= cutoff) break;

    recentFailureTimestampsMs.shift();
  }
}

function currentState(nowMs: number): BreakerState {
  if (openUntilMs !== null) {
    if (nowMs < openUntilMs) return "open";
    return "half_open";
  }
  return "closed";
}

/**
 * Call before every outbound LLM request. Throws `CircuitOpenError` if the
 * breaker is open. In half-open state, only one probe is allowed at a time.
 */
export function assertCircuitPermitsCall(nowMs: number = Date.now()): void {
  pruneWindow(nowMs);
  const state = currentState(nowMs);

  if (state === "open" && openUntilMs !== null) {
    throw new CircuitOpenError(openUntilMs);
  }

  if (state === "half_open") {
    if (halfOpenProbeInFlight) {
      throw new CircuitOpenError(nowMs + COOL_DOWN_MS);
    }
    halfOpenProbeInFlight = true;
  }
}

/**
 * Call after a successful LLM request. Closes the circuit if it was
 * half-open, clears recent failures so a single flake doesn't linger.
 */
export function recordCircuitSuccess(): void {
  openUntilMs = null;
  halfOpenProbeInFlight = false;
  recentFailureTimestampsMs.length = 0;
}

/**
 * Call after a failed LLM request. Increments the failure counter and
 * opens the breaker if the threshold is crossed within the rolling window.
 * Also handles the half-open probe failure path.
 */
export function recordCircuitFailure(nowMs: number = Date.now()): void {
  pruneWindow(nowMs);

  if (halfOpenProbeInFlight) {
    halfOpenProbeInFlight = false;
    openUntilMs = nowMs + COOL_DOWN_MS;
    return;
  }

  recentFailureTimestampsMs.push(nowMs);

  if (recentFailureTimestampsMs.length >= FAILURE_THRESHOLD) {
    openUntilMs = nowMs + COOL_DOWN_MS;
  }
}

/**
 * Inspection helper. Test-only: read-only snapshot of current breaker state.
 */
export function getCircuitSnapshot(
  nowMs: number = Date.now(),
): BreakerSnapshot {
  pruneWindow(nowMs);
  return {
    state: currentState(nowMs),
    failuresInWindow: recentFailureTimestampsMs.length,
    openUntilMs,
    halfOpenProbeInFlight,
  };
}

/**
 * Reset breaker to closed state. Test-only. Must be called in test setup
 * to avoid cross-test contamination because the state is module-scoped.
 */
export function __resetCircuitBreakerForTests(): void {
  recentFailureTimestampsMs.length = 0;
  openUntilMs = null;
  halfOpenProbeInFlight = false;
}

export const CIRCUIT_BREAKER_FAILURE_WINDOW_MS = FAILURE_WINDOW_MS;
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = FAILURE_THRESHOLD;
export const CIRCUIT_BREAKER_COOL_DOWN_MS = COOL_DOWN_MS;
