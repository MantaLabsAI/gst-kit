import { Pipeline } from "./";
import type { BufferData } from "./";
import { isPluginAvailable } from "./test-utils";

// attachCameraRateTimecode GUARANTEES every buffer carries a valid camera-rate
// GstVideoTimeCodeMeta before a downstream `qtmux force-create-timecode-trak`
// boxes it. Unlike attachSourceRateTimecode it does NOT relabel a
// buffer that already carries a valid meta: it keeps (and caches) the upstream
// stamper label, and only fills buffers whose meta is absent or all-zero from
// the last-good label (or the configured seed until one has been seen). These
// tests put the author element on a 60fps track, read the authored meta back off
// the downstream fakesink sink pad, and confirm (a) stamper labels pass through
// unchanged at the camera rate, (b) an absent meta is filled from the seed, and
// (c) drop-frame is carried as the NTSC fraction x/1001 at the camera rate.
const hasTimecodeStamper = isPluginAvailable("timecodestamper");

/** Collect the authored timecode metas off a downstream sink pad. */
async function collectAuthoredMeta(
  pipelineStr: string,
  authorName: string,
  attach: Parameters<
    NonNullable<ReturnType<Pipeline["getElementByName"]>>["attachCameraRateTimecode"]
  >[0]
): Promise<
  {
    hours: number;
    minutes: number;
    seconds: number;
    frames: number;
    dropFrame: boolean;
    rate: { numerator: number; denominator: number };
  }[]
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

  const detach = author.attachCameraRateTimecode(attach);

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

describe.skipIf(!hasTimecodeStamper)("attachCameraRateTimecode", () => {
  it("keeps the stamper's camera-rate labels unchanged when present", async () => {
    // 60fps video with an upstream internal stamper counting 0,1,2,… at the
    // camera rate. The author must pass those labels through untouched — no
    // source-rate divide — so the frame field reaches the 30..59 camera range.
    const metas = await collectAuthoredMeta(
      "videotestsrc num-buffers=40 ! video/x-raw,format=I420,width=160,height=90,framerate=60/1 " +
        "! timecodestamper source=internal set-internal-timecode=10:00:00:00 drop-frame=false " +
        "! identity name=author ! fakesink name=sink sync=false",
      "author",
      {
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
        rate: { numerator: 60, denominator: 1 },
      }
    );

    expect(metas.length).toBeGreaterThan(0);
    for (const tc of metas) {
      expect(tc.hours).toBe(10);
      expect(tc.minutes).toBe(0);
      expect(tc.seconds).toBe(0);
    }
    // Camera-rate labels advance one per buffer (0,1,2,…), so with 40 buffers the
    // frame field reaches into the 30..59 camera range — proving the stamper's
    // own labels passed through and were NOT divided to a source rate.
    const maxFrame = Math.max(...metas.map(m => m.frames));
    expect(maxFrame).toBeGreaterThan(29);
  });

  it("fills an absent meta from the seed on the first buffer, then holds last-good", async () => {
    // No upstream stamper: every buffer arrives with an absent meta. The author
    // must fill the first buffer from the seed and keep re-asserting it (there is
    // never a valid upstream meta to adopt, so last-good stays the seed).
    const metas = await collectAuthoredMeta(
      "videotestsrc num-buffers=10 ! video/x-raw,format=I420,width=160,height=90,framerate=60/1 " +
        "! identity name=author ! fakesink name=sink sync=false",
      "author",
      {
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
        rate: { numerator: 60, denominator: 1 },
      }
    );
    expect(metas.length).toBeGreaterThan(0);
    for (const tc of metas) {
      expect(tc.hours).toBe(10);
      expect(tc.minutes).toBe(0);
      expect(tc.seconds).toBe(0);
      expect(tc.frames).toBe(0);
    }
  });

  it("carries drop-frame as the NTSC fraction x/1001 at the camera rate", async () => {
    // 59.94 camera: pass the real NTSC rational. A hand-built x/1 is invalid for
    // drop-frame and would make gst_video_time_code_new reject it — the author
    // must use GStreamer's own DF arithmetic. With no upstream meta every buffer
    // is filled from the seed, so the DF flag and rate must round-trip.
    const metas = await collectAuthoredMeta(
      "videotestsrc num-buffers=12 ! video/x-raw,format=I420,width=160,height=90,framerate=60000/1001 " +
        "! identity name=author ! fakesink name=sink sync=false",
      "author",
      {
        timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: true },
        rate: { numerator: 60000, denominator: 1001 },
      }
    );
    expect(metas.length).toBeGreaterThan(0);
    for (const tc of metas) {
      expect(tc.dropFrame).toBe(true);
      expect(tc.rate).toEqual({ numerator: 60000, denominator: 1001 });
    }
  });

  it("throws when options.timecode is missing", () => {
    const p = new Pipeline("videotestsrc num-buffers=1 ! identity name=author ! fakesink");
    const author = p.getElementByName("author");
    if (!author) throw new Error("author element not found");
    expect(() =>
      // @ts-expect-error — intentionally omit the required timecode option
      author.attachCameraRateTimecode({ rate: { numerator: 60, denominator: 1 } })
    ).toThrow();
    p.dispose();
  });
});
