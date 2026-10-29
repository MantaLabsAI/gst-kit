import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Pipeline } from ".";
// attachBufferGapMonitor is a native streaming-thread probe that counts PTS
// anomalies at a pad. Determinism comes from an appsrc: we push tiny buffers
// with explicit PTS values, so the exact step between buffers is ours to choose
// (no clock, no videorate). 60000/1001 fps => frame duration 16_683_333 ns.
const FRAME_NS = Math.floor((1001 * 1e9) / 60000);
async function runPushed(ptsList: number[]) {
  const p = new Pipeline("appsrc name=source format=time ! identity name=mon ! fakesink sync=false");
  const source = p.getElementByName("source");
  if (source?.type !== "app-src-element") throw new Error("Expected app source element");
  const mon = p.getElementByName("mon");
  if (!mon) throw new Error("mon not found");
  const monitor = mon.attachBufferGapMonitor({ stage: "test", fpsNum: 60000, fpsDen: 1001 });
  await p.play(5000);
  for (const pts of ptsList) source.push(Buffer.alloc(16), pts);
  source.endOfStream();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const m = await p.busPop(300);
    if (m && (m.type === "eos" || m.type === "error")) break;
  }
  const stats = monitor.stats();
  monitor.detach();
  await p.stop();
  p.dispose();
  return stats;
}
const steps = (n: number, skipAt?: number) => {
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (i === skipAt) k++; // one whole frame missing before buffer `skipAt`
    out.push((i + k) * FRAME_NS);
  }
  return out;
};
describe("attachBufferGapMonitor", () => {
  it("reports 0 gaps for a clean stream", async () => {
    const s = await runPushed(steps(30));
    expect(s.buffers).toBe(30);
    expect(s.gaps).toBe(0);
    expect(s.backwards).toBe(0);
    expect(s.early).toBe(0);
    expect(s.maxGapNs).toBe(0);
  });
  it("reports exactly one gap when one frame is missing (2.00x step)", async () => {
    const s = await runPushed(steps(30, 10));
    expect(s.buffers).toBe(30);
    expect(s.gaps).toBe(1);
    expect(s.backwards).toBe(0);
    expect(s.early).toBe(0);
    expect(s.lastGapPtsNs).toBe(11 * FRAME_NS);
    expect(s.lastGapNs).toBe(2 * FRAME_NS);
    expect(s.maxGapNs).toBe(2 * FRAME_NS);
  });
  it("counts backwards and early steps separately", async () => {
    const s = await runPushed([
      0,
      FRAME_NS,
      2 * FRAME_NS,
      2 * FRAME_NS, // delta 0 => backwards
      2 * FRAME_NS + FRAME_NS / 4, // 0.25x => early
      3 * FRAME_NS + FRAME_NS / 4,
    ]);
    expect(s.buffers).toBe(6);
    expect(s.backwards).toBe(1);
    expect(s.early).toBe(1);
    expect(s.gaps).toBe(0);
  });
  it("rejects invalid options and missing pads", () => {
    const p = new Pipeline("videotestsrc num-buffers=1 ! fakesink name=sink");
    const sink = p.getElementByName("sink");
    if (!sink) throw new Error("sink not found");
    expect(() => sink.attachBufferGapMonitor({ stage: "x", fpsNum: 0, fpsDen: 1 })).toThrow();
    expect(() =>
      sink.attachBufferGapMonitor({ stage: "x", fpsNum: 30, fpsDen: 1, pad: "src" }),
    ).toThrow();
    p.dispose();
  });
});
// g_message goes to stderr via the GLib default handler. Capture it from a
// child process (in-process fd 2 cannot be intercepted from JS). Needs the
// built ESM bundle, so skip when dist/ has not been built.
const distEsm = fileURLToPath(new URL("../../dist/esm/index.mjs", import.meta.url));
describe.skipIf(!existsSync(distEsm))("attachBufferGapMonitor log lines", () => {
  const script = (skip: boolean) => `
    import { Pipeline } from ${JSON.stringify(distEsm)};
    const F = ${FRAME_NS};
    const p = new Pipeline("appsrc name=source format=time ! identity name=mon ! fakesink sync=false");
    const src = p.getElementByName("source");
    const mon = p.getElementByName("mon").attachBufferGapMonitor({ stage: "child", fpsNum: 60000, fpsDen: 1001 });
    await p.play(5000);
    for (let i = 0; i < 20; i++) src.push(Buffer.alloc(16), (i + (${skip} && i >= 10 ? 1 : 0)) * F);
    src.endOfStream();
    for (let i = 0; i < 20; i++) { const m = await p.busPop(300); if (m && m.type === "eos") break; }
    console.log("STATS " + JSON.stringify(mon.stats()));
    await p.stop(); p.dispose();
  `;
  const run = (skip: boolean) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", script(skip)], { encoding: "utf8" });
  it("logs one buffer.first and no buffer.gap on a clean stream", () => {
    const r = run(false);
    expect(r.status).toBe(0);
    expect(r.stderr.match(/buffer\.first stage=child/g)).toHaveLength(1);
    expect(r.stderr).not.toContain("buffer.gap");
  });
  it("logs one greppable buffer.gap line for the dropped frame", () => {
    const r = run(true);
    expect(r.status).toBe(0);
    expect(r.stderr.match(/buffer\.first stage=child/g)).toHaveLength(1);
    const lines = r.stderr.split("\n").filter((l) => l.includes("buffer.gap"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /buffer\.gap stage=child kind=gap n=10 prev_pts_ns=\d+ pts_ns=\d+ delta_ns=\d+ x_step=2\.00 mono_us=\d+ buf_offset=-?\d+ flags=0x[0-9a-f]+ dts_ns=\S+/,
    );
  });
});
