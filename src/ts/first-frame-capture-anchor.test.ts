import { describe, it, expect } from "vitest";
import { Pipeline } from "./";
import { isPluginAvailable } from "./test-utils";

// setFirstFrameTimecode can advance the stamped label from the seed to the
// frame's true capture instant when a captureAnchor is supplied: the label is
// moved forward by the frames elapsed between the anchor instant and the first
// buffer's capture instant (mapped through the clock bridge). Without an anchor
// the seed is stamped verbatim.
const hasTimecodeStamper = isPluginAvailable("timecodestamper");

// Parse "HH:MM:SS:FF" / "HH:MM:SS;FF" to total frames at `fps`.
function toFrames(tc: string, fps: number): number {
  const m = tc.match(/^(\d\d):(\d\d):(\d\d)[:;](\d\d)$/);
  if (!m) throw new Error(`unparseable timecode: ${tc}`);
  const [, hh, mm, ss, ff] = m.map(Number) as unknown as number[];
  return ((hh * 60 + mm) * 60 + ss) * fps + ff;
}

const nowMonotonicNs = (): number => Number(process.hrtime.bigint());

describe.skipIf(!hasTimecodeStamper)("setFirstFrameTimecode captureAnchor (ARKP-1535)", () => {
  const SEED = { hours: 10, minutes: 0, seconds: 0, frames: 0 };
  const FPS = 60;
  const pipelineStr = () =>
    "videotestsrc is-live=true num-buffers=8 ! " +
    `video/x-raw,format=I420,width=320,height=240,framerate=${FPS}/1 ! ` +
    "timecodestamper name=tc_stamper source=internal ! fakesink name=sink";

  it("stamps the seed verbatim when no captureAnchor is supplied", async () => {
    const rec = new Pipeline(pipelineStr());
    const stamper = rec.getElementByName("tc_stamper");
    if (!stamper) throw new Error("stamper not found");

    const prom = stamper.setFirstFrameTimecode({ timecode: SEED });
    await rec.play(5000);
    const result = await prom;

    expect(result).not.toBeNull();
    expect(result?.timecode).toBe("10:00:00:00");
    expect(result?.advancedFrames).toBe(0);

    await rec.stop();
    rec.dispose();
  });

  it("advances the label by the frames elapsed since the capture anchor", async () => {
    const rec = new Pipeline(pipelineStr());
    const stamper = rec.getElementByName("tc_stamper");
    if (!stamper) throw new Error("stamper not found");

    // Anchor the seed 2 seconds in the past. The first buffer is captured ~now,
    // so the label should be advanced by ~2s worth of frames (2 * 60 = 120),
    // plus the small real capture latency (a handful of frames).
    const ANCHOR_BACK_NS = 2_000_000_000;
    const anchoredAtNs = nowMonotonicNs() - ANCHOR_BACK_NS;

    const prom = stamper.setFirstFrameTimecode({
      timecode: SEED,
      captureAnchor: { anchoredAtNs },
    });
    await rec.play(5000);
    const result = await prom;

    expect(result).not.toBeNull();
    const advanced = toFrames(result!.timecode, FPS);
    const seedFrames = toFrames("10:00:00:00", FPS);
    const deltaFrames = advanced - seedFrames;

    // At least ~2s of frames (120), and not wildly more — capture latency adds
    // only a few frames, so bound generously at 2s + 1s slack.
    expect(deltaFrames).toBeGreaterThanOrEqual(FPS * 2 - 2);
    expect(deltaFrames).toBeLessThanOrEqual(FPS * 3);
    // advancedFrames the native side reported must match the label delta.
    expect(result!.advancedFrames).toBe(deltaFrames);

    await rec.stop();
    rec.dispose();
  });

  it("does not advance for an anchor in the future (negative elapsed)", async () => {
    const rec = new Pipeline(pipelineStr());
    const stamper = rec.getElementByName("tc_stamper");
    if (!stamper) throw new Error("stamper not found");

    // Anchor 10 s in the FUTURE → elapsed is negative → refuse the advance and
    // stamp the seed verbatim rather than rewind the label.
    const anchoredAtNs = nowMonotonicNs() + 10_000_000_000;

    const prom = stamper.setFirstFrameTimecode({
      timecode: SEED,
      captureAnchor: { anchoredAtNs },
    });
    await rec.play(5000);
    const result = await prom;

    expect(result?.timecode).toBe("10:00:00:00");
    expect(result?.advancedFrames).toBe(0);

    await rec.stop();
    rec.dispose();
  });
});
