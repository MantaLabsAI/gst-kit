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

  it("should dispose a still-playing pipeline by forcing it to NULL first", async () => {
    const pipeline = new Pipeline("videotestsrc ! fakesink");

    await pipeline.play();
    expect(pipeline.playing()).toBe(true);

    // Callers are expected to stop() first, but dispose() must not leak if they
    // don't: rather than throw (which would skip the unref and leak the native
    // pipeline), dispose() drives the pipeline to NULL synchronously and then
    // releases it. So disposing a still-playing pipeline is safe and does not
    // throw.
    expect(() => pipeline.dispose()).not.toThrow();

    // After dispose() the pipeline is released; any further use throws.
    expect(() => pipeline.playing()).toThrow(/used after dispose/);
  });

  it("should be safe to dispose after a worker started against the pipeline resolves", async () => {
    const pipeline = new Pipeline("videotestsrc ! fakesink");

    await pipeline.play();

    // Start an async worker (busPop) that holds its own gst_object_ref while it
    // runs. The pipeline is stopped and the worker awaited before dispose(), so
    // the reference the worker held is already released.
    const pending = pipeline.busPop(1000);
    await pipeline.stop();
    await pending;

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
