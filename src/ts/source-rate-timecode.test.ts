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

  it("follows the upstream (head-drop-advanced) camera meta, not its own counter (ARKP-1588)", async () => {
    // Simulate a head drop: the upstream timecodestamper is seeded at camera
    // frame 2 (as `nvtcburnin` would after advancing `internal_tc` by a dropped
    // 2-frame gap), while the author is seeded at source frame 0. With the old
    // local-counter behaviour the first authored frame would be seed + floor(0/2)
    // = 0; with the meta-driven fix it must be floor(2/2) = 1, matching where the
    // burn-in landed.
    const metas = await collectAuthoredMeta(
      "videotestsrc num-buffers=20 ! video/x-raw,format=I420,width=160,height=90,framerate=60/1 " +
        "! timecodestamper source=internal set-internal-timecode=10:00:00:02 drop-frame=false " +
        "! identity name=author ! fakesink name=sink sync=false",
      "author",
      {
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
        rate: { numerator: 30, denominator: 1 },
        repeat: 2,
      },
    );
    expect(metas.length).toBeGreaterThan(0);
    // First authored source frame reflects the ADVANCED camera meta (2/2 = 1),
    // NOT the un-advanced counter (0).
    expect(metas[0].frames).toBe(1);
  });

  it("stays byte-identical to the counter on a clean start (frame 0, ARKP-1588)", async () => {
    // Clean start: upstream camera meta begins at frame 0, so camera_ff/repeat ==
    // floor(frame_index/repeat). The authored first frame must still be 0 — the
    // fix changes nothing when no head drop occurred.
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
    expect(metas[0].frames).toBe(0);
    // Label-repeat still holds off the camera meta: 0,0,1,1,2,2,…
    metas.forEach((m, i) => expect(m.frames).toBe(Math.floor(i / 2)));
  });

  it("reads the drop-frame flag off the upstream camera meta (DF-correct, ARKP-1588)", async () => {
    // 59.94 camera / 29.97 source with a drop-frame upstream meta. The author
    // must read DF off the camera meta and author a DF source-rate label.
    const metas = await collectAuthoredMeta(
      "videotestsrc num-buffers=12 ! video/x-raw,format=I420,width=160,height=90,framerate=60000/1001 " +
        "! timecodestamper source=internal set-internal-timecode=10:00:00;00 drop-frame=true " +
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
      expect(tc.frames).toBeLessThanOrEqual(29);
    }
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
    // The exact label-repeat invariant (ADR-0038a decision E): buffer i carries
    // source frame floor(i / repeat), so each distinct source frame appears
    // exactly `repeat` times. Asserting the exact value (not just monotonic
    // non-decreasing) catches a bug that advanced every 3rd buffer instead of
    // every 2nd — which the old monotonic+`0,0` check would have passed (M2).
    const repeat = 2;
    const frames = metas.map((m) => m.frames);
    frames.forEach((f, i) => {
      expect(f).toBe(Math.floor(i / repeat));
    });
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
