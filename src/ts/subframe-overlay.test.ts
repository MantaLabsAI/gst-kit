import { Pipeline } from "./";
import { isPluginAvailable } from "./test-utils";

// attachSubFrameOverlay sets a textoverlay's `text` property per buffer,
// synchronously on the streaming thread, to the source-rate sub-frame label
// `HH:MM:SS:FF.n` — so there is no frame lag (the JS appsrc/probe feeder it
// replaces rendered the first frame blank). These tests drive a bounded
// textoverlay pipeline and read the `text` property back to confirm the label
// advanced at the source rate, and that detach stops the updates.
const hasTextOverlay = isPluginAvailable("textoverlay");

const readText = (el: {
  getElementProperty: (k: string) => unknown;
}): string | null => {
  const r = el.getElementProperty("text") as { value?: unknown } | string | null;
  if (r && typeof r === "object" && "value" in r) {
    return typeof r.value === "string" ? r.value : null;
  }
  return typeof r === "string" ? r : null;
};

describe.skipIf(!hasTextOverlay)("attachSubFrameOverlay", () => {
  it("sets a sub-frame label and advances it at the source rate", async () => {
    // 60fps video, 30fps source → repeat 2. 20 buffers = 10 source frames.
    const p = new Pipeline(
      "videotestsrc num-buffers=20 ! video/x-raw,format=I420,width=160,height=90,framerate=60/1 " +
        "! textoverlay name=ov ! fakesink sync=false",
    );
    const ov = p.getElementByName("ov");
    if (!ov) throw new Error("overlay not found");
    expect(typeof ov.attachSubFrameOverlay).toBe("function");

    const detach = ov.attachSubFrameOverlay({
      timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
      rate: { numerator: 30, denominator: 1 },
      repeat: 2,
    });

    await p.play(5000);
    // Let all buffers flow to EOS.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const m = await p.busPop(300);
      if (m && (m.type === "eos" || m.type === "error")) break;
    }

    // After ~20 frames the label is near 10:00:00:09.x — a source-rate value
    // (frame field 0..29), with the sub-frame suffix .0 or .1.
    const text = readText(ov);
    expect(text).toMatch(/^10:00:00:\d{2}\.[01]$/);
    const ff = Number(text!.slice(9, 11));
    expect(ff).toBeLessThanOrEqual(29);

    detach();
    await p.stop();
    p.dispose();
  });

  it("counts the frame field up to :29 then rolls the second (never :30+)", async () => {
    // Start at :28 so the field crosses :29 → next second within a few frames.
    const p = new Pipeline(
      "videotestsrc num-buffers=12 ! video/x-raw,format=I420,width=160,height=90,framerate=60/1 " +
        "! textoverlay name=ov ! fakesink sync=false",
    );
    const ov = p.getElementByName("ov");
    if (!ov) throw new Error("overlay not found");

    const seen = new Set<string>();
    const detach = ov.attachSubFrameOverlay({
      timecode: { hours: 10, minutes: 0, seconds: 0, frames: 28 },
      rate: { numerator: 30, denominator: 1 },
      repeat: 2,
    });
    await p.play(5000);
    // Poll the text a few times while frames flow to collect labels.
    for (let i = 0; i < 24; i++) {
      const t = readText(ov);
      if (t) seen.add(t);
      await new Promise((r) => setTimeout(r, 5));
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const m = await p.busPop(300);
      if (m && (m.type === "eos" || m.type === "error")) break;
    }
    detach();
    await p.stop();
    p.dispose();

    // Every collected frame field must be <= 29 (no :30..:59 at a 30fps source).
    for (const t of seen) {
      const ff = Number(t.slice(9, 11));
      expect(ff).toBeLessThanOrEqual(29);
    }
  });

  it("derives the source label from the upstream timecodestamper meta (ARKP-1549)", async () => {
    // With a `timecodestamper` upstream, each buffer carries a camera-rate
    // GstVideoTimeCodeMeta. The probe must read that meta and divide the
    // camera-rate frame field down to the source label (floor(FF/repeat)) with
    // the remainder as the `.n` suffix — NOT count from the seed. At 60fps the
    // stamper counts 0..59; repeat 2 → source field 0..29.
    const p = new Pipeline(
      "videotestsrc num-buffers=20 ! video/x-raw,format=I420,width=160,height=90,framerate=60/1 " +
        "! timecodestamper source=internal set-internal-timecode=10:00:00:00 drop-frame=false " +
        "! textoverlay name=ov ! fakesink sync=false",
    );
    const ov = p.getElementByName("ov");
    if (!ov) throw new Error("overlay not found");
    const seen = new Set<string>();
    const detach = ov.attachSubFrameOverlay({
      // The seed here is deliberately a DIFFERENT value than the stamper's; if
      // the probe wrongly counted from the seed, the labels would start at
      // 11:... — the meta path must win and show 10:00:00:FF.n.
      timecode: { hours: 11, minutes: 0, seconds: 0, frames: 0 },
      rate: { numerator: 30, denominator: 1 },
      repeat: 2,
    });
    await p.play(5000);
    for (let i = 0; i < 24; i++) {
      const t = readText(ov);
      if (t) seen.add(t);
      await new Promise((r) => setTimeout(r, 5));
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const m = await p.busPop(300);
      if (m && (m.type === "eos" || m.type === "error")) break;
    }
    detach();
    await p.stop();
    p.dispose();
    expect(seen.size).toBeGreaterThan(0);
    for (const t of seen) {
      // Hour comes from the stamper's meta (10), not the seed (11), and the
      // source frame field never exceeds 29.
      expect(t).toMatch(/^10:00:00:\d{2}\.[01]$/);
      expect(Number(t.slice(9, 11))).toBeLessThanOrEqual(29);
    }
  });

  it("rejects repeat < 2", () => {
    const p = new Pipeline("videotestsrc num-buffers=1 ! textoverlay name=ov ! fakesink");
    const ov = p.getElementByName("ov");
    if (!ov) throw new Error("overlay not found");
    expect(() =>
      ov.attachSubFrameOverlay({
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
        rate: { numerator: 60, denominator: 1 },
        repeat: 1,
      }),
    ).toThrow();
    p.dispose();
  });
});
