import { describe, it, expect } from "vitest";
import { Pipeline } from "./";
import { isPluginAvailable } from "./test-utils";

// setFirstFrameTimecode can read its clock-bridge base_time from a
// caller-supplied element instead of the stamper. This lets a caller whose frame
// running-time is relative to a DIFFERENT pipeline (interpipe passthrough-ts)
// keep `runningTimeNs + baseTimeNs` in one domain.
const hasTimecodeStamper = isPluginAvailable("timecodestamper");

describe.skipIf(!hasTimecodeStamper)("setFirstFrameTimecode baseTimeElement", () => {
  it("stamps frame 0 and returns a base time when baseTimeElement is supplied", async () => {
    const rec = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! timecodestamper name=tc_stamper ! fakesink",
    );
    const ext = new Pipeline("videotestsrc is-live=true ! fakesink name=fsExt");
    const stamper = rec.getElementByName("tc_stamper");
    const extEl = ext.getElementByName("fsExt");
    if (!stamper || !extEl) throw new Error("elements not found");

    await ext.play(5000);
    const prom = stamper.setFirstFrameTimecode({
      timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
      baseTimeElement: extEl,
    });
    await rec.play(5000);
    const result = await prom;

    expect(result).not.toBeNull();
    expect(result?.timecode).toBe("10:00:00:00");
    expect(typeof result?.clockBridge.baseTimeNs).toBe("number");

    await rec.stop();
    await ext.stop();
    rec.dispose();
    ext.dispose();
  });

  it("reads base_time from the SUPPLIED element, not the stamper", async () => {
    // Two recording pipelines with identical structure. In pipe1 we pass its OWN
    // stamper's pipeline element as base (equivalent to default); in pipe2 we pass
    // an element from a SEPARATE pipeline started ~400ms earlier, so its base time
    // is a materially smaller (earlier) clock value. The reported baseTimeNs must
    // reflect the supplied element's pipeline in each case.
    const early = new Pipeline("videotestsrc is-live=true ! fakesink name=fsEarly");
    const earlyEl = early.getElementByName("fsEarly");
    if (!earlyEl) throw new Error("early element not found");
    await early.play(5000);
    await new Promise((r) => setTimeout(r, 400)); // early base is ~400ms before rec

    const rec = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! timecodestamper name=tc_stamper ! fakesink name=fsRec",
    );
    const stamper = rec.getElementByName("tc_stamper");
    const recEl = rec.getElementByName("fsRec");
    if (!stamper || !recEl) throw new Error("rec elements not found");

    // Control: base from the recording pipeline itself.
    const controlProm = stamper.setFirstFrameTimecode({
      timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
      baseTimeElement: recEl,
    });
    await rec.play(5000);
    const control = await controlProm;

    await rec.stop();
    rec.dispose();

    // Second run: same recording structure, but base from the EARLIER pipeline.
    const rec2 = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! timecodestamper name=tc_stamper2 ! fakesink",
    );
    const stamper2 = rec2.getElementByName("tc_stamper2");
    if (!stamper2) throw new Error("stamper2 not found");
    const extProm = stamper2.setFirstFrameTimecode({
      timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
      baseTimeElement: earlyEl,
    });
    await rec2.play(5000);
    const withEarly = await extProm;

    await rec2.stop();
    await early.stop();
    rec2.dispose();
    early.dispose();

    const controlBase = control?.clockBridge.baseTimeNs;
    const earlyBase = withEarly?.clockBridge.baseTimeNs;
    expect(typeof controlBase).toBe("number");
    expect(typeof earlyBase).toBe("number");
    // The earlier pipeline's base time is set ~400ms+ before the second recording
    // pipeline's — so if the supplied element is honored, earlyBase must be
    // clearly SMALLER than controlBase (which came from a later-started pipeline).
    expect(earlyBase!).toBeLessThan(controlBase!);
  });

  it("reports baseClockMatched when no baseTimeElement is supplied (defaults to the stamper)", async () => {
    const rec = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! timecodestamper name=tc_stamper ! fakesink",
    );
    const stamper = rec.getElementByName("tc_stamper");
    if (!stamper) throw new Error("stamper not found");
    const prom = stamper.setFirstFrameTimecode({
      timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
    });
    await rec.play(5000);
    const result = await prom;
    // No base element → base and clock both come from the stamper, so they match.
    expect(result?.clockBridge.baseClockMatched).toBe(true);
    await rec.stop();
    rec.dispose();
  });

  it("reports baseClockMatched=true when the base element shares the stamper's clock (separate pipelines on the system clock)", async () => {
    // ARK's real case: ingest and recording pipelines both run on the global
    // GstSystemClock, so a base element from the other pipeline still shares the
    // stamper's clock and the base-time subtraction is valid.
    const rec = new Pipeline(
      "videotestsrc num-buffers=10 is-live=true ! timecodestamper name=tc_stamper ! fakesink",
    );
    const ext = new Pipeline("videotestsrc is-live=true ! fakesink name=fsExt");
    const stamper = rec.getElementByName("tc_stamper");
    const extEl = ext.getElementByName("fsExt");
    if (!stamper || !extEl) throw new Error("elements not found");
    await ext.play(5000);
    const prom = stamper.setFirstFrameTimecode({
      timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
      baseTimeElement: extEl,
    });
    await rec.play(5000);
    const result = await prom;
    expect(result?.clockBridge.baseClockMatched).toBe(true);
    await rec.stop();
    await ext.stop();
    rec.dispose();
    ext.dispose();
  });
});
