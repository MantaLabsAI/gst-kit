#include "element.hpp"
#include "async-workers.hpp"
#include "type-conversion.hpp"
#include <chrono>
#include <cstring>
#include <functional>
#include <gst/rtp/gstrtpbuffer.h>
#include <gst/video/video.h>
#include <memory>
#include <string>
#include <thread>

Napi::Object Element::CreateFromGstElement(const Napi::Env &env, GstElement *element) {
  Napi::Function func = DefineClass(env, "Element", {});
  return func.New({Napi::External<GstElement>::New(env, element)});
}

Element::Element(const Napi::CallbackInfo &info) :
    Napi::ObjectWrap<Element>(info), element(nullptr, gst_object_unref) {
  std::string element_type = "element";
  if (info.Length() > 0 && info[0].IsExternal()) {
    GstElement *elem = info[0].As<Napi::External<GstElement>>().Data();
    element.reset(elem);

    // Set element type based on GStreamer element type
    if (GST_IS_APP_SINK(elem))
      element_type = "app-sink-element";
    else if (GST_IS_APP_SRC(elem))
      element_type = "app-src-element";
  }

  // Set properties as enumerable instance properties
  Napi::Env env = info.Env();
  Napi::Object thisObj = info.This().As<Napi::Object>();

  auto get_sample_method = Napi::Function::New(
    env, [this](const Napi::CallbackInfo &info) -> Napi::Value { return this->get_sample(info); },
    "getSample"
  );
  auto on_sample_method = Napi::Function::New(
    env, [this](const Napi::CallbackInfo &info) -> Napi::Value { return this->on_sample(info); },
    "onSample"
  );
  auto get_element_property_method = Napi::Function::New(
    env,
    [this](const Napi::CallbackInfo &info) -> Napi::Value {
      return this->get_element_property(info);
    },
    "getElementProperty"
  );
  auto set_element_property_method = Napi::Function::New(
    env,
    [this](const Napi::CallbackInfo &info) -> Napi::Value {
      return this->set_element_property(info);
    },
    "setElementProperty"
  );
  auto add_pad_probe_method = Napi::Function::New(
    env,
    [this](const Napi::CallbackInfo &info) -> Napi::Value { return this->add_pad_probe(info); },
    "addPadProbe"
  );
  auto sample_first_frame_clock_method = Napi::Function::New(
    env,
    [this](const Napi::CallbackInfo &info) -> Napi::Value {
      return this->sample_first_frame_clock(info);
    },
    "sampleFirstFrameClock"
  );
  auto set_first_frame_timecode_method = Napi::Function::New(
    env,
    [this](const Napi::CallbackInfo &info) -> Napi::Value {
      return this->set_first_frame_timecode(info);
    },
    "setFirstFrameTimecode"
  );
  auto set_pad_method = Napi::Function::New(
    env, [this](const Napi::CallbackInfo &info) -> Napi::Value { return this->set_pad(info); },
    "setPad"
  );
  auto get_pad_method = Napi::Function::New(
    env, [this](const Napi::CallbackInfo &info) -> Napi::Value { return this->get_pad(info); },
    "getPad"
  );
  auto push_method = Napi::Function::New(
    env, [this](const Napi::CallbackInfo &info) -> Napi::Value { return this->push(info); }, "push"
  );
  auto end_of_stream_method = Napi::Function::New(
    env,
    [this](const Napi::CallbackInfo &info) -> Napi::Value { return this->end_of_stream(info); },
    "endOfStream"
  );

  std::vector property_descriptors = {
    Napi::PropertyDescriptor::Value("type", Napi::String::New(env, element_type), napi_enumerable),
    Napi::PropertyDescriptor::Value(
      "getElementProperty", get_element_property_method, napi_enumerable
    ),
    Napi::PropertyDescriptor::Value(
      "setElementProperty", set_element_property_method, napi_enumerable
    ),
    Napi::PropertyDescriptor::Value("addPadProbe", add_pad_probe_method, napi_enumerable),
    Napi::PropertyDescriptor::Value(
      "sampleFirstFrameClock", sample_first_frame_clock_method, napi_enumerable
    ),
    Napi::PropertyDescriptor::Value(
      "setFirstFrameTimecode", set_first_frame_timecode_method, napi_enumerable
    ),
    Napi::PropertyDescriptor::Value("setPad", set_pad_method, napi_enumerable),
    Napi::PropertyDescriptor::Value("getPad", get_pad_method, napi_enumerable)
  };

  if (element || GST_IS_APP_SINK(element.get())) {
    property_descriptors.push_back(
      Napi::PropertyDescriptor::Value("getSample", get_sample_method, napi_enumerable)
    );
    property_descriptors.push_back(
      Napi::PropertyDescriptor::Value("onSample", on_sample_method, napi_enumerable)
    );
  }

  if (element && GST_IS_APP_SRC(element.get())) {
    property_descriptors.push_back(
      Napi::PropertyDescriptor::Value("push", push_method, napi_enumerable)
    );
    property_descriptors.push_back(
      Napi::PropertyDescriptor::Value("endOfStream", end_of_stream_method, napi_enumerable)
    );
  }

  thisObj.DefineProperties(property_descriptors);
}

Napi::Value Element::get_element_property(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Property name must be a string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!element.get()) {
    Napi::TypeError::New(env, "Element is null or not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string property_name = info[0].As<Napi::String>().Utf8Value();

  GParamSpec *spec =
    g_object_class_find_property(G_OBJECT_GET_CLASS(element.get()), property_name.c_str());

  if (!spec) {
    return env.Null();
  }

  GValue value = G_VALUE_INIT;
  g_value_init(&value, G_PARAM_SPEC_VALUE_TYPE(spec));
  g_object_get_property(G_OBJECT(element.get()), property_name.c_str(), &value);

  Napi::Value result = TypeConversion::gvalue_to_js_with_type(env, &value);

  g_value_unset(&value);
  return result;
}

Napi::Value Element::set_element_property(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "setElementProperty requires property name and value")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!info[0].IsString()) {
    Napi::TypeError::New(env, "Property name must be a string").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!element.get()) {
    Napi::TypeError::New(env, "Element is null or not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string property_name = info[0].As<Napi::String>().Utf8Value();
  Napi::Value property_value = info[1];

  GParamSpec *spec =
    g_object_class_find_property(G_OBJECT_GET_CLASS(element.get()), property_name.c_str());

  if (!spec) {
    Napi::TypeError::New(env, ("Property '" + property_name + "' not found").c_str())
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Check if property is writable
  if (!(spec->flags & G_PARAM_WRITABLE)) {
    Napi::TypeError::New(env, ("Property '" + property_name + "' is not writable").c_str())
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  GValue value = G_VALUE_INIT;
  GType prop_type = G_PARAM_SPEC_VALUE_TYPE(spec);

  // Convert JavaScript value to GValue
  if (!TypeConversion::js_to_gvalue(env, property_value, prop_type, &value)) {
    std::string error_msg = TypeConversion::get_conversion_error_message(prop_type, property_value);

    // Handle special error cases
    if (prop_type == gst_caps_get_type() && property_value.IsString()) {
      error_msg = "Invalid caps string";
    } else if (G_TYPE_IS_ENUM(prop_type) && property_value.IsString()) {
      std::string enum_str = property_value.As<Napi::String>().Utf8Value();
      error_msg = "Invalid enum value: " + enum_str;
    }

    Napi::TypeError::New(env, error_msg.c_str()).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Set the property
  g_object_set_property(G_OBJECT(element.get()), property_name.c_str(), &value);
  g_value_unset(&value);

  return env.Undefined();
}

Napi::Value Element::get_sample(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Validate that we have an app sink element
  if (!element || !GST_IS_APP_SINK(element.get())) {
    Napi::TypeError::New(env, "getSample() can only be called on app-sink-element")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Default timeout is 1000ms (1 second)
  guint64 timeout_ms = 1000;

  // Check if timeout parameter is provided
  if (info.Length() > 0 && info[0].IsNumber()) {
    timeout_ms = info[0].As<Napi::Number>().Uint32Value();
  }

  // Create worker and get its promise
  // Note: N-API AsyncWorker manages its own memory - it will be automatically
  // deleted when the work completes (OnOK or OnError is called)
  PullSampleWorker *worker = new PullSampleWorker(env, GST_APP_SINK(element.get()), timeout_ms);
  Napi::Promise promise = worker->GetPromise().Promise();
  worker->Queue();

  return promise;
}

// Structure to hold sample callback data
struct SampleCallbackContext {
  Napi::ThreadSafeFunction callback;
  gulong signal_id;
  GstAppSink *app_sink;
};

// Signal callback for new-sample
static void new_sample_callback(GstAppSink *app_sink, gpointer user_data) {
  SampleCallbackContext *context = static_cast<SampleCallbackContext *>(user_data);

  // Try to pull the sample
  GstSample *sample = gst_app_sink_try_pull_sample(app_sink, 0); // Non-blocking

  if (sample) {
    // Call the JavaScript callback with the sample
    context->callback.NonBlockingCall([=](Napi::Env env, Napi::Function js_callback) {
      Napi::Object sampleData = TypeConversion::gst_sample_to_js(env, sample);
      js_callback.Call({sampleData});

      // Unref the sample when done
      gst_sample_unref(sample);
    });
  }
}

Napi::Value Element::on_sample(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Validate that we have an app sink element
  if (!element || !GST_IS_APP_SINK(element.get())) {
    Napi::TypeError::New(env, "onSample() can only be called on app-sink-element")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected 1 argument: callback function")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Function callback = info[0].As<Napi::Function>();

  // Enable signal emission on the appsink
  g_object_set(element.get(), "emit-signals", TRUE, NULL);

  // Create a thread-safe function for the callback
  Napi::ThreadSafeFunction tsfn =
    Napi::ThreadSafeFunction::New(env, callback, "SampleCallback", 0, 1);

  // Create context for the signal
  SampleCallbackContext *context = new SampleCallbackContext{tsfn, 0, GST_APP_SINK(element.get())};

  // Connect to the "new-sample" signal
  context->signal_id =
    g_signal_connect(element.get(), "new-sample", G_CALLBACK(new_sample_callback), context);

  // Return an unsubscribe function
  return Napi::Function::New(env, [context](const Napi::CallbackInfo &info) -> Napi::Value {
    // Disconnect the signal (this will stop the callbacks)
    g_signal_handler_disconnect(context->app_sink, context->signal_id);

    // Clean up the thread-safe function
    context->callback.Release();
    delete context;

    return info.Env().Undefined();
  });
}

// Structure to hold probe data
struct PadProbeContext {
  Napi::ThreadSafeFunction callback;
  gulong probe_id;
  GstPad *pad;
  GstElement *element;
};

// Pad probe callback for comprehensive buffer data extraction
static GstPadProbeReturn
pad_probe_callback(GstPad *pad, GstPadProbeInfo *info, gpointer user_data) {
  PadProbeContext *context = static_cast<PadProbeContext *>(user_data);

  if (GST_PAD_PROBE_INFO_TYPE(info) & GST_PAD_PROBE_TYPE_BUFFER) {
    GstBuffer *buffer = GST_PAD_PROBE_INFO_BUFFER(info);

    if (buffer) {
      // Copy buffer data immediately to avoid lifetime issues
      GstMapInfo map;
      uint8_t *buffer_data_copy = nullptr;
      gsize buffer_data_size = 0;
      if (gst_buffer_map(buffer, &map, GST_MAP_READ)) {
        buffer_data_copy = new uint8_t[map.size];
        std::memcpy(buffer_data_copy, map.data, map.size);
        buffer_data_size = map.size;
        gst_buffer_unmap(buffer, &map);
      }

      // Copy buffer metadata immediately
      guint64 pts = GST_BUFFER_PTS_IS_VALID(buffer) ? GST_BUFFER_PTS(buffer) : GST_CLOCK_TIME_NONE;
      guint64 dts = GST_BUFFER_DTS_IS_VALID(buffer) ? GST_BUFFER_DTS(buffer) : GST_CLOCK_TIME_NONE;
      guint64 duration =
        GST_BUFFER_DURATION_IS_VALID(buffer) ? GST_BUFFER_DURATION(buffer) : GST_CLOCK_TIME_NONE;
      guint64 offset =
        GST_BUFFER_OFFSET_IS_VALID(buffer) ? GST_BUFFER_OFFSET(buffer) : GST_BUFFER_OFFSET_NONE;
      guint64 offset_end = GST_BUFFER_OFFSET_END_IS_VALID(buffer) ? GST_BUFFER_OFFSET_END(buffer)
                                                                  : GST_BUFFER_OFFSET_NONE;
      guint32 flags = GST_BUFFER_FLAGS(buffer);

      // Copy caps data immediately
      GstCaps *caps = gst_pad_get_current_caps(pad);
      gchar *caps_string = caps ? gst_caps_to_string(caps) : nullptr;
      if (caps) {
        gst_caps_unref(caps);
      }

      // Copy RTP data if available
      bool has_rtp = false;
      guint32 rtp_timestamp = 0;
      guint16 rtp_sequence = 0;
      guint32 rtp_ssrc = 0;
      guint8 rtp_payload_type = 0;

      GstRTPBuffer rtp_buffer = GST_RTP_BUFFER_INIT;
      if (gst_rtp_buffer_map(buffer, GST_MAP_READ, &rtp_buffer)) {
        has_rtp = true;
        rtp_timestamp = gst_rtp_buffer_get_timestamp(&rtp_buffer);
        rtp_sequence = gst_rtp_buffer_get_seq(&rtp_buffer);
        rtp_ssrc = gst_rtp_buffer_get_ssrc(&rtp_buffer);
        rtp_payload_type = gst_rtp_buffer_get_payload_type(&rtp_buffer);
        gst_rtp_buffer_unmap(&rtp_buffer);
      }

      // Call the JavaScript callback with copied data
      context->callback.NonBlockingCall([=](Napi::Env env, Napi::Function js_callback) {
        Napi::Object buffer_data = Napi::Object::New(env);

        // Raw buffer data
        if (buffer_data_copy) {
          buffer_data.Set(
            "buffer", Napi::Buffer<uint8_t>::Copy(env, buffer_data_copy, buffer_data_size)
          );
          delete[] buffer_data_copy; // Clean up copied data
        }

        // Timing information
        if (pts != GST_CLOCK_TIME_NONE) {
          buffer_data.Set("pts", Napi::Number::New(env, static_cast<double>(pts)));
        }
        if (dts != GST_CLOCK_TIME_NONE) {
          buffer_data.Set("dts", Napi::Number::New(env, static_cast<double>(dts)));
        }
        if (duration != GST_CLOCK_TIME_NONE) {
          buffer_data.Set("duration", Napi::Number::New(env, static_cast<double>(duration)));
        }
        if (offset != GST_BUFFER_OFFSET_NONE) {
          buffer_data.Set("offset", Napi::Number::New(env, static_cast<double>(offset)));
        }
        if (offset_end != GST_BUFFER_OFFSET_NONE) {
          buffer_data.Set("offsetEnd", Napi::Number::New(env, static_cast<double>(offset_end)));
        }

        // Buffer flags
        buffer_data.Set("flags", Napi::Number::New(env, flags));

        // Caps information
        if (caps_string) {
          Napi::Object caps_obj = Napi::Object::New(env);
          caps_obj.Set("name", Napi::String::New(env, caps_string));
          buffer_data.Set("caps", caps_obj);
          g_free(caps_string); // Clean up caps string
        }

        // RTP data if available
        if (has_rtp) {
          Napi::Object rtpData = Napi::Object::New(env);
          rtpData.Set("timestamp", Napi::Number::New(env, rtp_timestamp));
          rtpData.Set("sequence", Napi::Number::New(env, rtp_sequence));
          rtpData.Set("ssrc", Napi::Number::New(env, rtp_ssrc));
          rtpData.Set("payloadType", Napi::Number::New(env, rtp_payload_type));

          buffer_data.Set("rtp", rtpData);
        }

        js_callback.Call({buffer_data});
      });
    }
  }

  return GST_PAD_PROBE_OK;
}

Napi::Value Element::add_pad_probe(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected 2 arguments: padName and callback")
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  if (!info[0].IsString()) {
    Napi::TypeError::New(env, "First argument must be a string (pad name)")
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  if (!info[1].IsFunction()) {
    Napi::TypeError::New(env, "Second argument must be a function (callback)")
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string pad_name = info[0].As<Napi::String>().Utf8Value();
  Napi::Function callback = info[1].As<Napi::Function>();

  // Get the pad from the element
  GstPad *pad = gst_element_get_static_pad(element.get(), pad_name.c_str());
  if (!pad) {
    Napi::Error::New(env, "Failed to get pad: " + pad_name).ThrowAsJavaScriptException();
    return env.Null();
  }

  // Create a thread-safe function for the callback
  Napi::ThreadSafeFunction tsfn =
    Napi::ThreadSafeFunction::New(env, callback, "PadProbeCallback", 0, 1);

  // Create context for the probe
  PadProbeContext *context = new PadProbeContext{tsfn, 0, pad, element.get()};

  // Add the probe
  context->probe_id = gst_pad_add_probe(
    pad, GST_PAD_PROBE_TYPE_BUFFER, pad_probe_callback, context, [](gpointer data) {
      // Cleanup callback
      PadProbeContext *context = static_cast<PadProbeContext *>(data);
      context->callback.Release();
      gst_object_unref(context->pad);
      delete context;
    }
  );

  // Return an unsubscribe function
  return Napi::Function::New(env, [context](const Napi::CallbackInfo &info) -> Napi::Value {
    // Remove the probe (this will trigger the destructor callback which cleans up)
    gst_pad_remove_probe(context->pad, context->probe_id);

    return info.Env().Undefined();
  });
}

// Single-shot sink-pad probe: sample the clock bridge at the first buffer, read
// together on the streaming thread and delivered to JS via a Promise. Self-removes
// after one buffer; resolves null on EOS/flush or pad removal before any buffer.
struct FirstFrameClockContext {
  std::mutex mutex;
  GstElement *element = nullptr; // borrowed (owned by the Element/pipeline)
  // Optional base-time source: read its base_time instead of this element's, so a
  // frame timestamped by a different pipeline still maps in one domain. Owned:
  // gst_object_ref'd on register, unref'd in the destroy notify.
  GstElement *base_time_source = nullptr;
  bool settled = false; // resolve exactly once
  Napi::ThreadSafeFunction tsfn;

  // Optional first-frame stamp (setFirstFrameTimecode): when set, seed `element`
  // (a timecodestamper) with these fields before it transforms the first buffer.
  // fps 0/1 → read the negotiated caps rate.
  bool has_stamp = false;
  guint stamp_fps_n = 0, stamp_fps_d = 1;
  bool stamp_drop = false;
  guint stamp_hh = 0, stamp_mm = 0, stamp_ss = 0, stamp_ff = 0;

  // Optional capture anchor (ARKP-1535): the caller's reference-clock anchor in
  // the same monotonic domain as the clock bridge's `monotonic` field. When set,
  // the stamp is advanced from the seed by the frames elapsed between this anchor
  // and the first frame's capture instant, so the label describes the frame that
  // was actually captured rather than the request-time seed. The seed
  // (stamp_hh..ff) must already be the anchor's value expressed at the camera
  // rate (the caller reconciles it), so the advance is a plain frame add.
  bool has_capture_anchor = false;
  guint64 capture_anchor_ns = 0;
};

// Clock-bridge sample carried to the JS resolver. All ns; GST_CLOCK_TIME_NONE
// marks an unavailable field. captureGstClock = running_time + base_time;
// (gst_clock, monotonic) is the epoch bridge sampled at the same instant.
struct FirstFrameClockSample {
  bool ok = false; // false → resolve with null
  guint64 running_time = GST_CLOCK_TIME_NONE;
  guint64 base_time = GST_CLOCK_TIME_NONE;
  guint64 gst_clock = GST_CLOCK_TIME_NONE;
  guint64 monotonic = GST_CLOCK_TIME_NONE;
  bool base_clock_matched = true; // false ⇒ base_time_source on a different clock
  // Stamp result (setFirstFrameTimecode only): the label applied to frame 0, at
  // the negotiated rate.
  bool stamped = false;
  std::string applied_tc;
  guint64 first_pts = GST_CLOCK_TIME_NONE;
  guint applied_fps_n = 0, applied_fps_d = 1;
  bool applied_drop = false;
  // Frames the seed was advanced by (ARKP-1535 capture-anchor path); 0 when no
  // anchor was supplied or the advance could not be computed (seed stamped as-is).
  gint64 advanced_frames = 0;
};

// Resolve the Promise once, from the JS thread, then release the TSFN. Idempotent
// via `settled` — safe from both the probe path and the destroy path.
static void first_frame_clock_settle(
  FirstFrameClockContext *ctx, FirstFrameClockSample *sample
) {
  {
    std::lock_guard<std::mutex> lock(ctx->mutex);
    if (ctx->settled) {
      delete sample;
      return;
    }
    ctx->settled = true;
  }
  napi_status status = ctx->tsfn.NonBlockingCall(
    sample, [](Napi::Env env, Napi::Function jsCallback, FirstFrameClockSample *s) {
      jsCallback.Call({Napi::External<FirstFrameClockSample>::New(env, s)});
    }
  );
  if (status != napi_ok) {
    delete sample;
  }
  ctx->tsfn.Release();
}

static GstPadProbeReturn
first_frame_clock_probe(GstPad *pad, GstPadProbeInfo *info, gpointer user_data) {
  FirstFrameClockContext *ctx = static_cast<FirstFrameClockContext *>(user_data);

  // EOS/flush before any buffer: no frame will ever arrive, so settle null and
  // remove the probe. Delivered on the serialized streaming path, unlike the
  // destroy notify which doesn't fire deterministically on dispose from NULL.
  if (GST_PAD_PROBE_INFO_TYPE(info) & GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM) {
    GstEvent *event = GST_PAD_PROBE_INFO_EVENT(info);
    if (event && (GST_EVENT_TYPE(event) == GST_EVENT_EOS ||
                  GST_EVENT_TYPE(event) == GST_EVENT_FLUSH_STOP)) {
      first_frame_clock_settle(ctx, new FirstFrameClockSample()); // ok=false → null
      return GST_PAD_PROBE_REMOVE;
    }
    return GST_PAD_PROBE_OK;
  }

  if (!(GST_PAD_PROBE_INFO_TYPE(info) & GST_PAD_PROBE_TYPE_BUFFER))
    return GST_PAD_PROBE_OK;

  GstBuffer *buffer = GST_PAD_PROBE_INFO_BUFFER(info);

  FirstFrameClockSample *sample = new FirstFrameClockSample();
  sample->ok = true;

  // Sample the clock bridge FIRST — the stamp's capture-anchor advance (ARKP-1535)
  // needs it. running-time = segment-mapped PTS; fall back to the raw PTS
  // (identity segment) when there is no TIME segment.
  if (GST_BUFFER_PTS_IS_VALID(buffer)) {
    GstEvent *seg_event = gst_pad_get_sticky_event(pad, GST_EVENT_SEGMENT, 0);
    if (seg_event) {
      const GstSegment *seg = NULL;
      gst_event_parse_segment(seg_event, &seg);
      if (seg && seg->format == GST_FORMAT_TIME) {
        sample->running_time =
          gst_segment_to_running_time(seg, GST_FORMAT_TIME, GST_BUFFER_PTS(buffer));
      }
      gst_event_unref(seg_event);
    }
    if (sample->running_time == GST_CLOCK_TIME_NONE)
      sample->running_time = GST_BUFFER_PTS(buffer);
  }

  // Read base_time from the supplied source (else this element); the clock always
  // comes from this element, so the mapping holds only when they share a GstClock.
  GstElement *base_src = ctx->base_time_source ? ctx->base_time_source : ctx->element;
  sample->base_time = gst_element_get_base_time(base_src);

  GstClock *clock = gst_element_get_clock(ctx->element);
  if (clock) {
    // Read GstClock and CLOCK_MONOTONIC adjacent so their difference is the epoch
    // offset (steady_clock == CLOCK_MONOTONIC == Node hrtime on Linux).
    sample->gst_clock = gst_clock_get_time(clock);
    sample->monotonic = (guint64)std::chrono::duration_cast<std::chrono::nanoseconds>(
                          std::chrono::steady_clock::now().time_since_epoch())
                          .count();

    // Verify the base source shares this clock by object identity — checked, not
    // assumed, so a base element that later runs on its own clock is caught.
    if (ctx->base_time_source && ctx->base_time_source != ctx->element) {
      GstClock *base_clock = gst_element_get_clock(base_src);
      sample->base_clock_matched = (base_clock == clock);
      if (base_clock) gst_object_unref(base_clock);
    }

    gst_object_unref(clock);
  }

  // Optional first-frame stamp: seed the stamper synchronously here, before it
  // transforms this buffer. Prefer the negotiated caps rate over the requested one
  // so the applied label matches what the stamper counts at.
  if (ctx->has_stamp) {
    guint use_fps_n = ctx->stamp_fps_n, use_fps_d = ctx->stamp_fps_d;
    bool use_drop = ctx->stamp_drop;
    GstCaps *caps = gst_pad_get_current_caps(pad);
    if (caps) {
      GstVideoInfo vinfo;
      gst_video_info_init(&vinfo);
      if (gst_video_info_from_caps(&vinfo, caps) && GST_VIDEO_INFO_FPS_N(&vinfo) > 0) {
        use_fps_n = GST_VIDEO_INFO_FPS_N(&vinfo);
        use_fps_d = GST_VIDEO_INFO_FPS_D(&vinfo);
      }
      gst_caps_unref(caps);
    }
    GstVideoTimeCodeFlags flags =
      use_drop ? GST_VIDEO_TIME_CODE_FLAGS_DROP_FRAME : GST_VIDEO_TIME_CODE_FLAGS_NONE;
    GstVideoTimeCode *tc = gst_video_time_code_new(
      use_fps_n, use_fps_d, NULL, flags,
      ctx->stamp_hh, ctx->stamp_mm, ctx->stamp_ss, ctx->stamp_ff, 0);
    if (tc) {
      // ARKP-1535: advance the seed to the frame's true capture instant. The seed
      // is the caller's reference-clock anchor value at the camera rate; the
      // buffer's capture instant, mapped into the anchor's monotonic domain, is
      //   captureMonotonic = (running_time + base_time) + (monotonic - gst_clock)
      // (the same bridge ARK's firstFrameCaptureMonotonicNs computes). The frames
      // between the anchor and that instant are added with GStreamer's own
      // drop-frame-correct advance, so burn-in / tmcd / reported label all carry
      // the captured frame's value, not the request-time seed. Skipped (seed
      // stamped as-is) when no anchor was supplied, a bridge field is missing, or
      // the elapsed span is negative — matching today's behaviour on refuse.
      if (ctx->has_capture_anchor &&
          sample->running_time != GST_CLOCK_TIME_NONE &&
          sample->base_time != GST_CLOCK_TIME_NONE &&
          sample->gst_clock != GST_CLOCK_TIME_NONE &&
          sample->monotonic != GST_CLOCK_TIME_NONE && use_fps_n > 0) {
        // All in the monotonic (CLOCK_MONOTONIC) domain, signed so a slightly
        // early anchor is representable; guard against a negative result.
        gint64 capture_gst = (gint64)sample->running_time + (gint64)sample->base_time;
        gint64 gst_to_monotonic = (gint64)sample->monotonic - (gint64)sample->gst_clock;
        gint64 capture_monotonic = capture_gst + gst_to_monotonic;
        gint64 elapsed_ns = capture_monotonic - (gint64)ctx->capture_anchor_ns;
        if (elapsed_ns > 0) {
          // frames = floor(elapsed_ns * fps / 1e9); 64-bit to avoid overflow.
          // Floor (not round) so the label lands on the frame the buffer falls
          // IN — the same truncate-toward-earlier rule SMPTE advance uses
          // (ARKP-1497). The anchor is the instant the seed's frame began, so the
          // elapsed span is a true frame count; rounding could push the label one
          // frame past the captured buffer.
          gint64 frames =
            (elapsed_ns * (gint64)use_fps_n) /
            ((gint64)use_fps_d * 1000000000LL);
          if (frames > 0) {
            gst_video_time_code_add_frames(tc, frames);
            sample->advanced_frames = frames;
          }
        }
      }
      g_object_set(ctx->element, "set-internal-timecode", tc, NULL);
      gchar *s = gst_video_time_code_to_string(tc);
      sample->applied_tc = s ? s : "";
      if (s) g_free(s);
      gst_video_time_code_free(tc);
      sample->stamped = true;
      sample->applied_fps_n = use_fps_n;
      sample->applied_fps_d = use_fps_d;
      sample->applied_drop = use_drop;
      sample->first_pts =
        GST_BUFFER_PTS_IS_VALID(buffer) ? GST_BUFFER_PTS(buffer) : GST_CLOCK_TIME_NONE;
    }
  }

  first_frame_clock_settle(ctx, sample);
  return GST_PAD_PROBE_REMOVE; // one buffer only
}

// Build the clock-bridge JS object from a sample, omitting fields that were
// unavailable. Shared by both first-frame entry points.
static Napi::Object first_frame_build_clock_bridge(
  Napi::Env env, const FirstFrameClockSample *s
) {
  Napi::Object cb = Napi::Object::New(env);
  if (s->running_time != GST_CLOCK_TIME_NONE)
    cb.Set("runningTimeNs", Napi::Number::New(env, static_cast<double>(s->running_time)));
  if (s->base_time != GST_CLOCK_TIME_NONE)
    cb.Set("baseTimeNs", Napi::Number::New(env, static_cast<double>(s->base_time)));
  if (s->gst_clock != GST_CLOCK_TIME_NONE)
    cb.Set("gstClockNs", Napi::Number::New(env, static_cast<double>(s->gst_clock)));
  if (s->monotonic != GST_CLOCK_TIME_NONE)
    cb.Set("monotonicNs", Napi::Number::New(env, static_cast<double>(s->monotonic)));
  cb.Set("baseClockMatched", Napi::Boolean::New(env, s->base_clock_matched));
  return cb;
}

// Register the single-shot probe and wire its TSFN resolver. Shared by both entry
// points; `resolve_ok` builds each API's result shape from the same sample.
// Returns the Promise, or throws (and frees ctx) when there is no sink pad.
static Napi::Value first_frame_register_probe(
  Napi::Env env,
  GstElement *element,
  const char *method_name,
  FirstFrameClockContext *ctx,
  std::function<void(Napi::Env, Napi::Promise::Deferred &, const FirstFrameClockSample *)>
    resolve_ok
) {
  GstPad *sink_pad = gst_element_get_static_pad(element, "sink");
  if (!sink_pad) {
    if (ctx->base_time_source) gst_object_unref(ctx->base_time_source);
    delete ctx;
    Napi::Error::New(env, std::string(method_name) + ": element has no 'sink' pad")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto deferred = std::make_shared<Napi::Promise::Deferred>(Napi::Promise::Deferred::New(env));
  auto resolve_ok_ptr =
    std::make_shared<decltype(resolve_ok)>(std::move(resolve_ok));

  ctx->tsfn = Napi::ThreadSafeFunction::New(
    env,
    Napi::Function::New(
      env,
      [deferred, resolve_ok_ptr](const Napi::CallbackInfo &cbinfo) {
        Napi::Env env = cbinfo.Env();
        auto *s = reinterpret_cast<FirstFrameClockSample *>(
          cbinfo[0].As<Napi::External<FirstFrameClockSample>>().Data()
        );
        if (!s || !s->ok) {
          deferred->Resolve(env.Null());
        } else {
          (*resolve_ok_ptr)(env, *deferred, s);
        }
        delete s;
      },
      "FirstFrameResolver"
    ),
    method_name, 0, 1
  );

  gst_pad_add_probe(
    sink_pad,
    static_cast<GstPadProbeType>(GST_PAD_PROBE_TYPE_BUFFER | GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM),
    first_frame_clock_probe, ctx, [](gpointer data) {
      // Destroy notify: settle null if the probe was removed before any buffer, so
      // the Promise never hangs.
      FirstFrameClockContext *c = static_cast<FirstFrameClockContext *>(data);
      first_frame_clock_settle(c, new FirstFrameClockSample()); // ok=false → null
      if (c->base_time_source) gst_object_unref(c->base_time_source);
      delete c;
    }
  );
  // Drop our pad reference (the probe keeps the pad reachable); an extra ref would
  // block finalization on dispose, which is what fires the destroy notify above.
  gst_object_unref(sink_pad);

  return deferred->Promise();
}

GstElement *Element::unwrap_base_time_element(const Napi::Object &opts) {
  if (opts.Has("baseTimeElement") && opts.Get("baseTimeElement").IsObject()) {
    Napi::Object beObj = opts.Get("baseTimeElement").As<Napi::Object>();
    Element *beWrap = Napi::ObjectWrap<Element>::Unwrap(beObj);
    if (beWrap && beWrap->element.get()) {
      return beWrap->element.get();
    }
  }
  return nullptr;
}

Napi::Value Element::sample_first_frame_clock(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!element.get()) {
    Napi::TypeError::New(env, "Element is null or not initialized")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  FirstFrameClockContext *ctx = new FirstFrameClockContext();
  ctx->element = element.get();

  // Optional base-time source; take an owning ref for the probe's lifetime
  // (released in the destroy notify).
  if (info.Length() >= 1 && info[0].IsObject()) {
    GstElement *base = unwrap_base_time_element(info[0].As<Napi::Object>());
    if (base) ctx->base_time_source = static_cast<GstElement *>(gst_object_ref(base));
  }

  // sampleFirstFrameClock resolves the clock bridge flat.
  return first_frame_register_probe(
    env, element.get(), "sampleFirstFrameClock", ctx,
    [](Napi::Env env, Napi::Promise::Deferred &deferred, const FirstFrameClockSample *s) {
      deferred.Resolve(first_frame_build_clock_bridge(env, s));
    }
  );
}

Napi::Value Element::set_first_frame_timecode(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!element.get()) {
    Napi::TypeError::New(env, "Element is null or not initialized")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "setFirstFrameTimecode requires an options object")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  if (!opts.Has("timecode") || !opts.Get("timecode").IsObject()) {
    Napi::TypeError::New(
      env, "options.timecode { hours, minutes, seconds, frames, dropFrame? } required"
    ).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object tcObj = opts.Get("timecode").As<Napi::Object>();
  auto num = [&](Napi::Object o, const char *k, guint def) -> guint {
    return (o.Has(k) && o.Get(k).IsNumber()) ? o.Get(k).As<Napi::Number>().Uint32Value() : def;
  };

  FirstFrameClockContext *ctx = new FirstFrameClockContext();
  ctx->element = element.get();
  // The stamp the probe applies to frame 0. fps 0/1 → read from negotiated caps.
  ctx->has_stamp = true;
  ctx->stamp_hh = num(tcObj, "hours", 0);
  ctx->stamp_mm = num(tcObj, "minutes", 0);
  ctx->stamp_ss = num(tcObj, "seconds", 0);
  ctx->stamp_ff = num(tcObj, "frames", 0);
  ctx->stamp_drop = tcObj.Has("dropFrame") && tcObj.Get("dropFrame").IsBoolean() &&
                    tcObj.Get("dropFrame").As<Napi::Boolean>().Value();
  if (opts.Has("rate") && opts.Get("rate").IsObject()) {
    Napi::Object r = opts.Get("rate").As<Napi::Object>();
    ctx->stamp_fps_n = num(r, "numerator", 0);
    ctx->stamp_fps_d = num(r, "denominator", 1);
    if (ctx->stamp_fps_d == 0) ctx->stamp_fps_d = 1;
  }
  GstElement *base = unwrap_base_time_element(opts);
  if (base) ctx->base_time_source = static_cast<GstElement *>(gst_object_ref(base));

  // Optional capture anchor (ARKP-1535): the reference-clock instant, in the same
  // monotonic domain as the clock bridge, that the seed's value corresponds to.
  // Present ⇒ advance the seed to the frame's true capture instant at the first
  // buffer; absent ⇒ stamp the seed verbatim (prior behaviour). The seed must
  // already be expressed at the camera rate so the advance is a plain frame add.
  if (opts.Has("captureAnchor") && opts.Get("captureAnchor").IsObject()) {
    Napi::Object a = opts.Get("captureAnchor").As<Napi::Object>();
    if (a.Has("anchoredAtNs") && a.Get("anchoredAtNs").IsNumber()) {
      double anchoredAtNs = a.Get("anchoredAtNs").As<Napi::Number>().DoubleValue();
      if (anchoredAtNs >= 0) {
        ctx->has_capture_anchor = true;
        ctx->capture_anchor_ns = (guint64)anchoredAtNs;
      }
    }
  }

  // setFirstFrameTimecode resolves the applied label plus the clock bridge nested.
  return first_frame_register_probe(
    env, element.get(), "setFirstFrameTimecode", ctx,
    [](Napi::Env env, Napi::Promise::Deferred &deferred, const FirstFrameClockSample *s) {
      Napi::Object res = Napi::Object::New(env);
      res.Set("timecode", Napi::String::New(env, s->applied_tc));
      if (s->first_pts != GST_CLOCK_TIME_NONE)
        res.Set("pts", Napi::Number::New(env, static_cast<double>(s->first_pts)));
      Napi::Object fr = Napi::Object::New(env);
      fr.Set("numerator", Napi::Number::New(env, s->applied_fps_n));
      fr.Set("denominator", Napi::Number::New(env, s->applied_fps_d));
      res.Set("framerate", fr);
      res.Set("dropFrame", Napi::Boolean::New(env, s->applied_drop));
      // Frames the seed was advanced to reach the capture instant (0 when no
      // anchor was supplied or the advance was skipped).
      res.Set("advancedFrames", Napi::Number::New(env, static_cast<double>(s->advanced_frames)));
      res.Set("clockBridge", first_frame_build_clock_bridge(env, s));
      deferred.Resolve(res);
    }
  );
}

Napi::Value Element::push(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Validate that we have an app source element
  if (!element || !GST_IS_APP_SRC(element.get())) {
    Napi::TypeError::New(env, "push() can only be called on app-src-element")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info.Length() < 1) {
    Napi::TypeError::New(env, "push() requires at least 1 argument: buffer")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!info[0].IsBuffer()) {
    Napi::TypeError::New(env, "First argument must be a Buffer").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Get buffer data from Node.js Buffer
  Napi::Buffer<uint8_t> node_buffer = info[0].As<Napi::Buffer<uint8_t>>();
  uint8_t *buffer_data = node_buffer.Data();
  size_t buffer_length = node_buffer.Length();

  // Create GStreamer buffer
  GstBuffer *gst_buffer = gst_buffer_new_allocate(nullptr, buffer_length, nullptr);
  if (!gst_buffer) {
    Napi::Error::New(env, "Failed to allocate GStreamer buffer").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Fill the buffer with data
  gst_buffer_fill(gst_buffer, 0, buffer_data, buffer_length);

  // Handle optional PTS (presentation timestamp) parameter
  if (info.Length() > 1) {
    if (info[1].IsBuffer()) {
      // Handle PTS as buffer (compatible with original NAN implementation)
      Napi::Buffer<uint8_t> pts_buffer = info[1].As<Napi::Buffer<uint8_t>>();
      if (pts_buffer.Length() >= 8) {
        uint8_t *pts_data = pts_buffer.Data();
        // Read as big-endian uint64
        guint64 pts = GST_READ_UINT64_BE(pts_data);
        GST_BUFFER_PTS(gst_buffer) = pts;
      }
    } else if (info[1].IsNumber()) {
      // Handle PTS as number (more convenient JavaScript API)
      guint64 pts = static_cast<guint64>(info[1].As<Napi::Number>().Int64Value());
      GST_BUFFER_PTS(gst_buffer) = pts;
    }
  }

  // Push buffer to app source
  GstFlowReturn ret = gst_app_src_push_buffer(GST_APP_SRC(element.get()), gst_buffer);

  // Check for errors
  if (ret != GST_FLOW_OK) {
    // Buffer is consumed by push_buffer even on error, so don't unref it
    std::string error_msg = "Failed to push buffer: ";
    switch (ret) {
      case GST_FLOW_FLUSHING:
        error_msg += "Element is flushing";
        break;
      case GST_FLOW_EOS:
        error_msg += "End of stream";
        break;
      case GST_FLOW_NOT_LINKED:
        error_msg += "Source pad not linked";
        break;
      case GST_FLOW_ERROR:
        error_msg += "Generic error";
        break;
      default:
        error_msg += "Unknown error (" + std::to_string(ret) + ")";
        break;
    }
    Napi::Error::New(env, error_msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return env.Undefined();
}

Napi::Value Element::end_of_stream(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Validate that we have an app source element
  if (!element || !GST_IS_APP_SRC(element.get())) {
    Napi::TypeError::New(env, "endOfStream() can only be called on app-src-element")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Send end-of-stream signal to app source
  GstFlowReturn ret = gst_app_src_end_of_stream(GST_APP_SRC(element.get()));

  // Check for errors
  if (ret != GST_FLOW_OK) {
    std::string error_msg = "Failed to send end-of-stream: ";
    switch (ret) {
      case GST_FLOW_FLUSHING:
        error_msg += "Element is flushing";
        break;
      case GST_FLOW_EOS:
        error_msg += "Already at end of stream";
        break;
      case GST_FLOW_NOT_LINKED:
        error_msg += "Source pad not linked";
        break;
      case GST_FLOW_ERROR:
        error_msg += "Generic error";
        break;
      default:
        error_msg += "Unknown error (" + std::to_string(ret) + ")";
        break;
    }
    Napi::Error::New(env, error_msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return env.Undefined();
}

Napi::Value Element::set_pad(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "setPad() requires two string arguments (attribute, padName)")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!element.get()) {
    Napi::Error::New(env, "Element is null or not initialized").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string attribute = info[0].As<Napi::String>().Utf8Value();
  std::string padName = info[1].As<Napi::String>().Utf8Value();

  GstPad *pad = gst_element_get_static_pad(element.get(), padName.c_str());
  if (!pad) {
    Napi::Error::New(env, "Pad not found: " + padName).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_object_set(G_OBJECT(element.get()), attribute.c_str(), pad, NULL);

  gst_object_unref(pad);

  return env.Undefined();
}

Napi::Value Element::get_pad(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "getPad() requires one string argument (padName)")
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  if (!element.get()) {
    return env.Null();
  }

  std::string padName = info[0].As<Napi::String>().Utf8Value();

  GstPad *pad = gst_element_get_static_pad(element.get(), padName.c_str());

  if (!pad) {
    return env.Null();
  }

  // Create an object with pad information
  Napi::Object padObj = Napi::Object::New(env);
  padObj.Set("name", Napi::String::New(env, GST_PAD_NAME(pad)));
  padObj.Set("direction", Napi::Number::New(env, GST_PAD_DIRECTION(pad)));

  // Get pad caps if available
  GstCaps *caps = gst_pad_get_current_caps(pad);
  if (caps) {
    gchar *caps_str = gst_caps_to_string(caps);
    padObj.Set("caps", Napi::String::New(env, caps_str));
    g_free(caps_str);
    gst_caps_unref(caps);
  } else {
    padObj.Set("caps", env.Null());
  }

  gst_object_unref(pad);

  return padObj;
}
