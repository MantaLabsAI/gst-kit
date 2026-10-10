#pragma once

#include <gst/app/gstappsink.h>
#include <gst/app/gstappsrc.h>
#include <gst/gst.h>
#include <memory>
#include <napi.h>
#include <string>

class Element : public Napi::ObjectWrap<Element> {
public:
  static Napi::Object CreateFromGstElement(const Napi::Env &env, GstElement *element);

  Element(const Napi::CallbackInfo &info);
  virtual ~Element() = default;

  Napi::Value get_element_property(const Napi::CallbackInfo &info);
  Napi::Value set_element_property(const Napi::CallbackInfo &info);
  Napi::Value add_pad_probe(const Napi::CallbackInfo &info);
  Napi::Value sample_first_frame_clock(const Napi::CallbackInfo &info);
  Napi::Value set_first_frame_timecode(const Napi::CallbackInfo &info);
  // Attach a persistent sink-pad buffer probe that, synchronously on the
  // streaming thread, sets this element's `text` property to the source-rate
  // sub-frame burn-in label `HH:MM:SS:FF.n` for each buffer before it is
  // rendered. Zero JS round-trip, so no frame lag. Returns a detach function.
  Napi::Value attach_sub_frame_overlay(const Napi::CallbackInfo &info);
  // Attach a persistent sink-pad buffer probe that, synchronously on the
  // streaming thread, authors a SOURCE-rate GstVideoTimeCodeMeta on each buffer
  // via label-repeat: the same source-rate label is carried across the N video
  // frames that map to one LTC frame (advance one source frame every `repeat`
  // buffers). Drop-frame-correct via GstVideoTimeCode. Placed just before
  // `qtmux force-create-timecode-trak` so the muxed `tmcd` track rolls at the
  // LTC source rate on a camera-rate video track. Returns a detach function.
  // (ADR-0038a / ARKP-1549.)
  Napi::Value attach_source_rate_timecode(const Napi::CallbackInfo &info);
  // Attach a persistent sink-pad buffer probe that, synchronously on the
  // streaming thread, GUARANTEES every buffer carries a valid camera-rate
  // GstVideoTimeCodeMeta before it reaches a downstream `qtmux
  // force-create-timecode-trak`. Unlike attach_source_rate_timecode this is a
  // hold-last-good + seed-fallback re-assert: a buffer that already carries a
  // valid (present, non-all-zero) meta is left untouched and cached as the
  // last-good; a buffer with an absent or all-zero meta is overwritten with the
  // last-good (or, until a good meta has been seen, with the configured seed).
  // This closes the camera-rate audio-ON defect where qtmux boxes a default
  // `tmcd=00:00:00:00` because the first boxed buffer reaches the muxer with no
  // meta, WITHOUT advancing frame 0 off the stamper's own label (so it cannot
  // drift from the burn-in / tcIn). One frame per buffer = camera rate; no
  // `repeat`. Returns a detach function.
  Napi::Value attach_camera_rate_timecode(const Napi::CallbackInfo &info);
  // Unwrap an optional { baseTimeElement } JS Element to a borrowed GstElement*,
  // or nullptr when absent/invalid. Static member so it may read the wrapped
  // Element's private handle. The caller takes an owning ref.
  static GstElement *unwrap_base_time_element(const Napi::Object &opts);
  Napi::Value set_pad(const Napi::CallbackInfo &info);
  Napi::Value get_pad(const Napi::CallbackInfo &info);

  Napi::Value get_sample(const Napi::CallbackInfo &info);
  Napi::Value on_sample(const Napi::CallbackInfo &info);

  Napi::Value push(const Napi::CallbackInfo &info);
  Napi::Value end_of_stream(const Napi::CallbackInfo &info);

private:
  std::unique_ptr<GstElement, decltype(&gst_object_unref)> element;
};
