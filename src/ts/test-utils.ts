import { Pipeline } from ".";

/**
 * Check if a GStreamer element/plugin is available
 */
export const isPluginAvailable = (elementName: string): boolean => {
  try {
    // Try to create a simple pipeline with the element
    new Pipeline(`videotestsrc num-buffers=1 ! ${elementName} ! fakesink`);
    return true;
  } catch (error: unknown) {
    return !(
      error instanceof Error &&
      (error.message.includes("no element") || error.message.includes("no such element"))
    );
  }
};

export const arePluginsAvailable = (plugins: string[]) =>
  plugins.every(plugin => isPluginAvailable(plugin));

export const isWindows = process.platform === "win32";

/**
 * Drain the pipeline bus until an EOS (or error) message is seen, or the budget
 * is exhausted.
 *
 * After sending EOS to a source, the source's streaming thread finishes its
 * current loop and posts EOS on the bus. Calling stop() before that settles can
 * race GStreamer's internal basesrc EOS handling (observed on Windows as a
 * `has_pending_eos` assertion abort). Waiting for EOS to reach the bus lets the
 * source loop unwind cleanly before the state teardown.
 *
 * Returns true if EOS was observed, false otherwise.
 */
export const waitForEos = async (
  pipeline: Pipeline,
  { attempts = 20, timeoutMs = 500 }: { attempts?: number; timeoutMs?: number } = {}
): Promise<boolean> => {
  for (let i = 0; i < attempts; i++) {
    const message = await pipeline.busPop(timeoutMs);
    if (message?.type === "eos") return true;
    if (message?.type === "error") return false;
  }
  return false;
};
