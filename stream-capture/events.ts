// events.ts
//
// Everything the sheet tells its parent, as one stream. The parent decides what is analytics, what
// is logging and what is ignored — the component never calls a tag manager itself, and nothing a
// handler does can affect a capture.
//
// Naming: lowercase snake_case throughout, discriminant and payload alike — the same casing the
// element ids and design tokens use. The type system, not the casing, is what guarantees the
// discriminant, and an analytics vendor will rename these to its own convention anyway.

import type { CameraCandidate, SelectionReport } from "./camera-selection";
import type { CaptureResult } from "./capture-photo";

/** Added to every event, so one opening of the sheet can be stitched back together. */
export type StreamCaptureEventBase = {
  /** Stable for one mount of the sheet; a new id each time it opens. */
  sessionId: string;
  /** Milliseconds since the sheet mounted — time-to-preview and time-to-capture, without clock skew. */
  elapsedMs: number;
};

export type StreamCaptureEventPayload =
  | {
      /** The sheet mounted, with the configuration it is running under. */
      type: "opened";
      config: { guideAspectRatio: number; cropMargin: number; cameraSwitchEnabled: boolean };
    }
  | {
      /** The preview is live. `elapsedMs` on this one is the headline metric: time to preview. */
      type: "camera_ready";
      camera: Pick<CameraCandidate, "deviceId" | "label" | "megapixels">;
      /** What every camera reported and why this one won. Null after a manual switch, which
       *  reopens a known camera instead of re-running selection. */
      selection: SelectionReport | null;
    }
  | {
      type: "camera_failed";
      /** The DOMException name where there is one — NotAllowedError, NotReadableError,
       *  OverconstrainedError — or "interrupted" when a live track ended under us. The split
       *  between permission refused and camera busy is the one worth charting. */
      reason: string;
      /** The message shown to the user, already localised by describeCameraError. */
      message: string;
    }
  | { type: "retry_clicked" }
  | { type: "camera_switched"; from: string; to: string; label: string }
  | { type: "capture_clicked" }
  | {
      type: "capture_succeeded";
      /** Tap to encoded data URL: the wait the user actually feels after the shutter. */
      durationMs: number;
      image: { width: number; height: number; bytes: number; quality: number; cropped: boolean };
      /** The second file, when `encodeFocused` asked for one — what sending the box alone would
       *  cost, next to `image.bytes`. Null when it was not asked for. */
      focused: { width: number; height: number; bytes: number } | null;
      source: CaptureResult["source"];
    }
  | { type: "capture_failed"; message: string }
  | { type: "cancel_clicked"; from: "preview" | "error" }
  | {
      /** The slide finished and control is back with the parent. One per session, terminal. */
      type: "closed";
      outcome: "captured" | "cancelled";
    }
  | {
      /** Unmounted without closing — the parent navigated away, or the route changed under it.
       *  Never fires alongside `closed`, so the two together account for every session. */
      type: "abandoned";
      at: "loading" | "preview" | "error" | "capturing";
    };

export type StreamCaptureEvent = StreamCaptureEventBase & StreamCaptureEventPayload;
