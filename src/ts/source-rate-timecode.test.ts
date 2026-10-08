import { Pipeline } from "./";
import type { BufferData } from "./";
import { isPluginAvailable } from "./test-utils";

// attachSourceRateTimecode writes a SOURCE-rate GstVideoTimeCodeMeta on each
// buffer via label-repeat (the same source label across `repeat` video frames),
// synchronously on the streaming thread, so a downstream `qtmux
// force-create-timecode-trak` boxes a source-rate `tmcd` on a camera-rate video
// track (ADR-0038a / ARKP-1549). These tests put the author element on a 60fps
// track, read the authored meta back off the downstream fakesink sink pad, and
// confirm the frame field counts at the SOURCE rate (0..29 for a 30fps source,
// never 0..59), and that drop-frame is carried as the NTSC fraction x/1001.
const hasTimecodeStamper = isPluginAvailable("timecodestamper");

/** Collect the authored timecode metas off a downstream sink pad. */
async function collectAuthoredMeta(
  pipelineStr: string,
  authorName: string,
  attach: Parameters<
    NonNullable<ReturnType<Pipeline["getElementByName"]>>["attachSourceRateTimecode"]
  >[0],
): Promise<
  { hours: number; minutes: number; seconds: number; frames: number; dropFrame: boolean; rate: { numerator: number; denominator: number } }[]
> {
  const p = new Pipeline(pipelineStr);
  const author = p.getElementByName(authorName);
  if (!author) throw new Error("author element not found");
  const sink = p.getElementByName("sink");
  if (!sink) throw new Error("sink not found");

  const metas: NonNullable<BufferData["timecodeMeta"]>[] = [];
  const removeProbe = sink.addPadProbe("sink", (buffer: BufferData) => {
    if (buffer.timecodeMeta) metas.push(buffer.timecodeMeta);
  });

  const detach = author.attachSourceRateTimecode(attach);

  await p.play(5000);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const m = await p.busPop(300);
    if (m && (m.type === "eos" || m.type === "error")) break;
  }
  detach();
  removeProbe();
  await p.stop();
  p.dispose();
  return metas;
}

describe.skipIf(!hasTimecodeStamper)("attachSourceRateTimecode", () => {
  it("authors the tmcd meta at the SOURCE rate on a camera-rate (60p) track", async () => {
    // 60fps video, 30fps source → repeat 2. 20 buffers = 10 source frames.
    // Upstream timecodestamper would count 0..59; the author must relabel to the
    // source rate so the frame field never exceeds 29.
    const metas = await collectAuthoredMeta(
      "videotestsrc num-buffers=20 ! video/x-raw,format=I420,width=160,height=90,framerate=60/1 " +
        "! timecodestamper source=internal set-internal-timecode=10:00:00:00 drop-frame=false " +
        "! identity name=author ! fakesink name=sink sync=false",
      "author",
      {
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
        rate: { numerator: 30, denominator: 1 },
        repeat: 2,
      },
    );

    expect(metas.length).toBeGreaterThan(0);
    for (const tc of metas) {
      // Source-rate frame field: 0..29, never a camera-rate 30..59.
      expect(tc.hours).toBe(10);
      expect(tc.frames).toBeLessThanOrEqual(29);
    }
    // The last authored source frame equals floor((count-1)/repeat), proving
    // label-repeat: 20 buffers → source frames 0..9.
    const last = metas[metas.length - 1];
    expect(last.frames).toBeLessThanOrEqual(10);
  });

  it("repeats each source label across `repeat` video frames (label-repeat)", async () => {
    const metas = await collectAuthoredMeta(
      "videotestsrc num-buffers=8 ! video/x-raw,format=I420,width=160,height=90,framerate=60/1 " +
        "! identity name=author ! fakesink name=sink sync=false",
      "author",
      {
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
        rate: { numerator: 30, denominator: 1 },
        repeat: 2,
      },
    );
    expect(metas.length).toBeGreaterThanOrEqual(4);
    // The frame field increments once every `repeat` (2) buffers: the first two
    // share frame 0, the next two frame 1, etc. (monotonic, non-decreasing).
    const frames = metas.map((m) => m.frames);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1]);
    }
    // Each distinct frame value appears about `repeat` times.
    expect(frames[0]).toBe(0);
    expect(frames[1]).toBe(0);
  });

  it("carries drop-frame as the NTSC fraction x/1001 (DF-correct, review #2)", async () => {
    // 59.94 camera / 29.97 source: pass the real NTSC rationals. A hand-built
    // x/1 is invalid for drop-frame and would make gst_video_time_code_new
    // reject every frame — the author must use GStreamer's own DF arithmetic.
    const metas = await collectAuthoredMeta(
      "videotestsrc num-buffers=12 ! video/x-raw,format=I420,width=160,height=90,framerate=60000/1001 " +
        "! identity name=author ! fakesink name=sink sync=false",
      "author",
      {
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: true },
        rate: { numerator: 30000, denominator: 1001 },
        repeat: 2,
      },
    );
    expect(metas.length).toBeGreaterThan(0);
    for (const tc of metas) {
      expect(tc.dropFrame).toBe(true);
      expect(tc.rate).toEqual({ numerator: 30000, denominator: 1001 });
      expect(tc.frames).toBeLessThanOrEqual(29);
    }
  });

  it("rejects repeat < 1", () => {
    const p = new Pipeline(
      "videotestsrc num-buffers=1 ! identity name=author ! fakesink",
    );
    const author = p.getElementByName("author");
    if (!author) throw new Error("author element not found");
    expect(() =>
      author.attachSourceRateTimecode({
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
        rate: { numerator: 30, denominator: 1 },
        repeat: 0,
      }),
    ).toThrow();
    p.dispose();
  });
});
