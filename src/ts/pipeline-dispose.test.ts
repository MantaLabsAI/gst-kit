import { describe, expect, it } from "vitest";
import { Pipeline } from ".";

describe("Pipeline dispose()", () => {
  it("should dispose a pipeline that was never played", () => {
    const pipeline = new Pipeline("videotestsrc ! fakesink");

    // Disposing a freshly constructed (never played) pipeline is valid and
    // should not throw.
    expect(() => pipeline.dispose()).not.toThrow();
  });

  it("should dispose a pipeline after play and stop", async () => {
    const pipeline = new Pipeline("videotestsrc ! fakesink");

    await pipeline.play();
    expect(pipeline.playing()).toBe(true);
    await pipeline.stop();

    expect(() => pipeline.dispose()).not.toThrow();
  });

  it("should not throw when disposing a still-playing pipeline", async () => {
    const pipeline = new Pipeline("videotestsrc ! fakesink");

    await pipeline.play();
    expect(pipeline.playing()).toBe(true);

    // Callers are expected to stop() first, but dispose() must not blow up if
    // they don't: it drops the native reference without issuing a state change,
    // and GStreamer tears the pipeline down when the last reference is released.
    expect(() => pipeline.dispose()).not.toThrow();
  });

  it("should be idempotent — a second dispose() is a no-op", async () => {
    const pipeline = new Pipeline("videotestsrc ! fakesink");

    await pipeline.play();
    await pipeline.stop();

    pipeline.dispose();
    // Calling dispose() again must not throw.
    expect(() => pipeline.dispose()).not.toThrow();
  });

  it("should throw on synchronous method calls after dispose()", async () => {
    const pipeline = new Pipeline("videotestsrc ! fakesink");

    await pipeline.play();
    await pipeline.stop();
    pipeline.dispose();

    // Every driver-delegating method routes through the native disposed guard,
    // so a use-after-dispose is a loud error rather than a native null-deref.
    expect(() => pipeline.playing()).toThrow(/used after dispose/);
    expect(() => pipeline.queryPosition()).toThrow(/used after dispose/);
    expect(() => pipeline.queryDuration()).toThrow(/used after dispose/);
    expect(() => pipeline.getElementByName("sink")).toThrow(/used after dispose/);
    expect(() => pipeline.seek(0)).toThrow(/used after dispose/);
    expect(() => pipeline.endOfStream()).toThrow(/used after dispose/);
  });

  it("should throw on async method calls after dispose()", async () => {
    const pipeline = new Pipeline("videotestsrc ! fakesink");

    await pipeline.play();
    await pipeline.stop();
    pipeline.dispose();

    // Async methods throw synchronously (at call time) because the disposed
    // guard runs before the worker is queued.
    expect(() => pipeline.play()).toThrow(/used after dispose/);
    expect(() => pipeline.pause()).toThrow(/used after dispose/);
    expect(() => pipeline.stop()).toThrow(/used after dispose/);
    expect(() => pipeline.busPop(0)).toThrow(/used after dispose/);
  });
});
