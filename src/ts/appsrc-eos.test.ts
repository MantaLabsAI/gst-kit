import { describe, expect, it } from "vitest";
import { Pipeline } from ".";
import { waitForEos } from "./test-utils";

describe("AppSrc End-of-Stream", () => {
  it("should send EOS signal through endOfStream method", async () => {
    const pipeline = new Pipeline("appsrc name=source ! fakesink");
    const source = pipeline.getElementByName("source");

    expect(source?.type).toBe("app-src-element");

    if (source?.type === "app-src-element") {
      // Set up caps for the source
      source.setElementProperty(
        "caps",
        "video/x-raw,format=RGB,width=320,height=240,framerate=30/1"
      );

      await pipeline.play();

      // Push a few buffers
      const buffer = Buffer.alloc(320 * 240 * 3);
      buffer.fill(0xff); // Fill with white pixels

      for (let i = 0; i < 3; i++) {
        source.push(buffer);
      }

      // Send end-of-stream
      source.endOfStream();

      // Wait for EOS to reach the bus before stopping, so the source loop
      // unwinds cleanly instead of racing the state teardown.
      const eosReceived = await waitForEos(pipeline, { attempts: 20, timeoutMs: 1000 });

      await pipeline.stop();

      expect(eosReceived).toBe(true);
    }
  });

  it("should reject endOfStream on non-AppSrc elements", async () => {
    const pipeline = new Pipeline("videotestsrc name=source ! fakesink");
    const source = pipeline.getElementByName("source");

    expect(source?.type).toBe("element");

    if (source?.type === "element") {
      // Attempting to call endOfStream on a non-AppSrc element should throw
      expect(() => {
        // @ts-expect-error - Testing runtime error for non-AppSrc element
        source.endOfStream();
      }).toThrow();
    }

    await pipeline.stop();
  });

  it("should handle multiple endOfStream calls gracefully", async () => {
    const pipeline = new Pipeline("appsrc name=source ! fakesink");
    const source = pipeline.getElementByName("source");

    if (source?.type === "app-src-element") {
      source.setElementProperty(
        "caps",
        "video/x-raw,format=RGB,width=320,height=240,framerate=30/1"
      );

      await pipeline.play();

      // Send first EOS
      source.endOfStream();

      // Try to send second EOS - should handle gracefully
      try {
        source.endOfStream();
        // Second call might succeed or fail depending on GStreamer state,
        // but it shouldn't crash the application
      } catch (error) {
        // It's acceptable for the second call to fail
        expect(error).toBeDefined();
      }

      // Drain to EOS before stopping so the source streaming thread has finished
      // its loop; stopping mid-loop races GStreamer's internal EOS handling.
      await waitForEos(pipeline, { attempts: 20, timeoutMs: 1000 });

      await pipeline.stop();
    }
  });
});
