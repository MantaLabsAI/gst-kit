import { describe, it, expect } from "vitest";
import { Pipeline } from "./";

// sampleFirstFrameClock captures the clock bridge (running-time, base_time, and a
// gstClock/monotonic epoch bridge) at the first buffer to cross a sink pad. It
// works on any element and does no stamping.
describe("sampleFirstFrameClock", () => {
  it("resolves a clock-bridge sample at the first buffer", async () => {
    const pipeline = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! fakesink name=sink",
    );
    const sink = pipeline.getElementByName("sink");
    if (!sink) throw new Error("sink not found");

    // Arm before play, await after — the whole point of a first-buffer sample.
    const prom = sink.sampleFirstFrameClock();
    await pipeline.play(5000);
    const sample = await prom;

    expect(sample).not.toBeNull();
    expect(typeof sample?.runningTimeNs).toBe("number");
    expect(typeof sample?.baseTimeNs).toBe("number");
    expect(typeof sample?.gstClockNs).toBe("number");
    expect(typeof sample?.monotonicNs).toBe("number");
    // No base element supplied → base and clock both come from this element.
    expect(sample?.baseClockMatched).toBe(true);

    await pipeline.stop();
    pipeline.dispose();
  });

  it("resolves null when the stream ends before any buffer", async () => {
    // num-buffers=0 → EOS with no buffer ever crossing the pad. The sample must
    // resolve null rather than hang.
    const pipeline = new Pipeline(
      "videotestsrc num-buffers=0 is-live=true ! fakesink name=sink",
    );
    const sink = pipeline.getElementByName("sink");
    if (!sink) throw new Error("sink not found");

    const prom = sink.sampleFirstFrameClock();
    await pipeline.play(5000);
    const sample = await prom;

    expect(sample).toBeNull();

    await pipeline.stop();
    pipeline.dispose();
  });

  it("reads base_time from a supplied element of another pipeline", async () => {
    // A separate pipeline started ~400ms earlier has a materially smaller
    // (earlier) base time. When we sample the recording pipeline but point the
    // base at the earlier pipeline's element, the reported baseTimeNs must reflect
    // the SUPPLIED element, not the sampled one.
    const early = new Pipeline("videotestsrc is-live=true ! fakesink name=fsEarly");
    const earlyEl = early.getElementByName("fsEarly");
    if (!earlyEl) throw new Error("early element not found");
    await early.play(5000);
    await new Promise((r) => setTimeout(r, 400));

    const rec = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! fakesink name=fsRec",
    );
    const recEl = rec.getElementByName("fsRec");
    if (!recEl) throw new Error("rec element not found");

    // Control: base from the recording pipeline itself.
    const controlProm = recEl.sampleFirstFrameClock({ baseTimeElement: recEl });
    await rec.play(5000);
    const control = await controlProm;

    await rec.stop();
    rec.dispose();

    // Second run: same structure, but base from the EARLIER pipeline.
    const rec2 = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! fakesink name=fsRec2",
    );
    const rec2El = rec2.getElementByName("fsRec2");
    if (!rec2El) throw new Error("rec2 element not found");
    const earlyProm = rec2El.sampleFirstFrameClock({ baseTimeElement: earlyEl });
    await rec2.play(5000);
    const withEarly = await earlyProm;

    await rec2.stop();
    await early.stop();
    rec2.dispose();
    early.dispose();

    const controlBase = control?.baseTimeNs;
    const earlyBase = withEarly?.baseTimeNs;
    expect(typeof controlBase).toBe("number");
    expect(typeof earlyBase).toBe("number");
    // The earlier pipeline's base time is set ~400ms+ before the second recording
    // pipeline's — so if the supplied element is honored, earlyBase must be
    // clearly SMALLER than controlBase.
    expect(earlyBase!).toBeLessThan(controlBase!);
  });

  it("reports baseClockMatched=true for elements sharing the system clock", async () => {
    // Two independent pipelines both run on the global GstSystemClock, so an
    // element from one shares the other's clock and the base-time subtraction is
    // valid.
    const rec = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! fakesink name=fsRec",
    );
    const ext = new Pipeline("videotestsrc is-live=true ! fakesink name=fsExt");
    const recEl = rec.getElementByName("fsRec");
    const extEl = ext.getElementByName("fsExt");
    if (!recEl || !extEl) throw new Error("elements not found");

    await ext.play(5000);
    const prom = recEl.sampleFirstFrameClock({ baseTimeElement: extEl });
    await rec.play(5000);
    const sample = await prom;

    expect(sample?.baseClockMatched).toBe(true);

    await rec.stop();
    await ext.stop();
    rec.dispose();
    ext.dispose();
  });
});
