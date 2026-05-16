import { describe, it, expect } from "vitest";
import { Agent } from "../src/agent/agent";

describe("Agent", () => {
  it("should create an agent instance", () => {
    const agent = new Agent();
    expect(agent).toBeInstanceOf(Agent);
  });

  it("should clear context", () => {
    const agent = new Agent();
    agent.clearContext();
    // No error means success
  });

  it("should have runStream method", () => {
    const agent = new Agent();
    expect(typeof agent.runStream).toBe("function");
  });

  it("should have run method", () => {
    const agent = new Agent();
    expect(typeof agent.run).toBe("function");
  });
});
