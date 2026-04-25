import { beforeEach, describe, expect, it } from "vitest";
import {
  CIRCUIT_BREAKER_COOL_DOWN_MS,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CircuitOpenError,
  __resetCircuitBreakerForTests,
  assertCircuitPermitsCall,
  getCircuitSnapshot,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "./summaryCircuitBreaker";

describe("summaryCircuitBreaker", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
  });

  it("permits calls when closed", () => {
    expect(() => assertCircuitPermitsCall(1_000)).not.toThrow();
    expect(getCircuitSnapshot(1_000).state).toBe("closed");
  });

  it("opens after threshold failures within window and short-circuits", () => {
    const now = 1_000;
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) {
      recordCircuitFailure(now + i);
    }
    expect(getCircuitSnapshot(now).state).toBe("open");
    expect(() => assertCircuitPermitsCall(now)).toThrow(CircuitOpenError);
  });

  it("transitions to half-open after cool-down, allows one probe, and re-opens on failure", () => {
    const now = 1_000;
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) {
      recordCircuitFailure(now + i);
    }

    // openUntilMs was set at the last recorded failure time + cool-down.
    // Push "now" well past both to guarantee we're in half-open territory.
    const afterCoolDown =
      now +
      CIRCUIT_BREAKER_FAILURE_THRESHOLD +
      CIRCUIT_BREAKER_COOL_DOWN_MS +
      1;
    expect(getCircuitSnapshot(afterCoolDown).state).toBe("half_open");

    expect(() => assertCircuitPermitsCall(afterCoolDown)).not.toThrow();
    // Second concurrent probe is rejected while first is still in-flight.
    expect(() => assertCircuitPermitsCall(afterCoolDown)).toThrow(
      CircuitOpenError,
    );

    recordCircuitFailure(afterCoolDown);
    expect(getCircuitSnapshot(afterCoolDown).state).toBe("open");
  });

  it("closes on success from half-open state", () => {
    const now = 1_000;
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) {
      recordCircuitFailure(now + i);
    }
    const afterCoolDown =
      now +
      CIRCUIT_BREAKER_FAILURE_THRESHOLD +
      CIRCUIT_BREAKER_COOL_DOWN_MS +
      1;
    assertCircuitPermitsCall(afterCoolDown);
    recordCircuitSuccess();
    expect(getCircuitSnapshot(afterCoolDown).state).toBe("closed");
    expect(() => assertCircuitPermitsCall(afterCoolDown)).not.toThrow();
  });

  it("isolated failures outside the window do not open the breaker", () => {
    const base = 1_000;
    // Single failure every 10s; spread well beyond the 60s window.
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) {
      recordCircuitFailure(base + i * 10_000);
    }
    expect(getCircuitSnapshot(base + 1_000_000).state).toBe("closed");
  });
});
