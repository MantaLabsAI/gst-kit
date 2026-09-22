#!/usr/bin/env node
/**
 * First-Frame Timecode Seeding Example
 *
 * Seeds timecodestamper's start timecode from a sink-pad probe on the first
 * buffer so frame 0 carries the label, and reads back the applied value.
 * Also shows setElementProperty accepting a boxed GstVideoTimeCode.
 */
import { Pipeline } from "../dist/esm/index.mjs";

const SEED = { hours: 10, minutes: 0, seconds: 0, frames: 30, dropFrame: false };
const pipelineStr = `
  videotestsrc is-live=true num-buffers=8 !
  video/x-raw,format=I420,width=320,height=240,framerate=60/1,interlace-mode=progressive !
  timecodestamper name=tc_stamper source=internal set=always drop-frame=false !
  fakesink name=sink
`;

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
};

const pipeline = new Pipeline(pipelineStr);
const stamper = pipeline.getElementByName("tc_stamper");
check("getElementByName(tc_stamper)", !!stamper);

// Boxed GstVideoTimeCode marshalling via setElementProperty (object form).
let boxedOk = false;
try {
  stamper.setElementProperty("set-internal-timecode", SEED);
  boxedOk = true;
} catch (err) {
  console.log("   setElementProperty(boxed) threw:", err.message);
}
check("setElementProperty accepts boxed GstVideoTimeCode object", boxedOk);

// String form.
let strOk = false;
try {
  stamper.setElementProperty("set-internal-timecode", "10:00:00:30");
  strOk = true;
} catch (err) {
  console.log("   setElementProperty(string) threw:", err.message);
}
check("setElementProperty accepts HH:MM:SS:FF string", strOk);

// setFirstFrameTimecode: arms the seed synchronously, resolves once frame 0 is
// stamped. Capture the promise before play(); await it once buffers have flowed.
const resultPromise = stamper.setFirstFrameTimecode({
  timecode: SEED,
  rate: { numerator: 60, denominator: 1 },
});

await pipeline.play(3000);

const result = await resultPromise;
console.log("   result:", JSON.stringify(result));
check("frame-0 label == 10:00:00:30", result && result.timecode === "10:00:00:30");
check("framerate numerator == 60", result && result.framerate?.numerator === 60);

pipeline.dispose();

console.log(failures === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
