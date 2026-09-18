// stream-capture.tsx
//
// Same flow as before: slides up on mount → user taps capture → captured image holds on screen
// while the sheet slides down → after the slide, uploadImage(dataUrl) and setStream(false).
// Cancel: onStreamCancel() → slide down → setStream(false).
//
// What changed underneath:
//   - the camera is chosen by capability scoring (useMainRearCamera), not by whichever rear lens
//     the browser happened to hand back — which is what fixes phones that hand back a telephoto
//     lens as their default rear camera;
//   - the crop is taken from the preview frame at the stream's full resolution (a 4K preview is
//     requested) in source pixels, not from a viewport-sized canvas, so it is ~1000–2000 px wide
//     instead of ~368 px — and it is exactly what the user framed;
//   - the guide box is a DOM element and the crop reads its rendered rect, so the two can't drift;
//   - the crop carries a margin around the box for the backend (cropMargin, default 8%), and
//     uploadImage also receives where the box sits inside it, so the viewer can be shown just the
//     box (see focused-image.tsx) while the backend gets the context.

import React, { useCallback, useEffect, useRef, useState } from "react";
import CaptureButton from "./capture-button";
import type { SelectionReport } from "./camera-selection";
import type { StreamCaptureEventPayload } from "./events";
import type { CapturedImageMeta, StreamCaptureProps } from "./types";
import { useMainRearCamera } from "./use-main-rear-camera";
import { blobToDataUrl, capturePhoto, cropSpecFromElements, mapSourceToOverlay } from "./capture-photo";
import {
  CameraContainer,
  CameraPlaceholder,
  CameraVideo,
  CancelButton,
  CapturedImage,
  CaptureControlsContainer,
  GuidelineTextTitle,
  ErrorOverlay,
  ErrorText,
  GuideBox,
  GuidelineTextBox,
} from "./stream-capture.styles";

const SLIDE_MS = 600; // must match the slide animations in stream-capture.styles
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_CROP_MARGIN = 0.08;
// Prefix for the element ids and test ids the sheet renders. Neutral here; an app that already has
// automation or analytics bound to its own names passes them in via idPrefix.
const DEFAULT_ID_PREFIX = "stream_capture";

const newSessionId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Guide box shapes, as width ÷ height. The crop reads the box's rendered rect, so changing the
// shape needs nothing else: the capture follows whatever is on screen.
export const GUIDE_ASPECT = {
  /** 330 × 200, the box from the original design. The default, so existing callers are unchanged. */
  DESIGN: 330 / 200,
  /** ISO/IEC 7810 ID-1 (85.6 × 53.98 mm): the size of national ID cards, licences and bank cards. */
  ID_CARD: 85.6 / 53.98,
  /** ISO/IEC 7810 ID-3 (125 × 88 mm): the passport data page. */
  PASSPORT: 125 / 88,
} as const;

const StreamCapture: React.FC<StreamCaptureProps> = ({
  cmsContent,
  uploadImage,
  setStream,
  cropMargin = DEFAULT_CROP_MARGIN,
  guideAspectRatio = GUIDE_ASPECT.DESIGN,
  idPrefix = DEFAULT_ID_PREFIX,
  emitEvent,
  onClickCapture,
  onStreamCancel,
  onCameraReport,
  enableCameraSwitch = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const guideRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // Held in refs so an inline `emitEvent={(e) => …}` at the call site — which is how it will be
  // written — does not re-run effects or reopen the camera on every parent render.
  const emitRef = useRef(emitEvent);
  emitRef.current = emitEvent;
  const onCameraReportRef = useRef(onCameraReport);
  onCameraReportRef.current = onCameraReport;

  const sessionIdRef = useRef("");
  if (!sessionIdRef.current) sessionIdRef.current = newSessionId();
  const openedAtRef = useRef(performance.now());
  const closedRef = useRef(false);
  const phaseRef = useRef<"loading" | "preview" | "error" | "capturing">("loading");
  // The last selection report, handed to `camera_ready`. Cleared once used, so a manual switch that
  // follows does not re-report a selection that did not run again.
  const reportRef = useRef<SelectionReport | null>(null);

  const emit = useCallback((event: StreamCaptureEventPayload) => {
    const handler = emitRef.current;
    if (!handler) return;
    try {
      handler({
        ...event,
        sessionId: sessionIdRef.current,
        elapsedMs: Math.round(performance.now() - openedAtRef.current),
      });
    } catch (error) {
      // A throwing analytics handler must never cost the user their capture.
      console.error("[stream-capture] emitEvent handler threw", error);
    }
  }, []);

  const handleReport = useCallback((report: SelectionReport) => {
    reportRef.current = report;
    onCameraReportRef.current?.(report);
  }, []);

  const { videoRef, state, retry, switchTo } = useMainRearCamera({ onReport: handleReport });

  const [isCapturing, setIsCapturing] = useState(false); // tap acknowledged: controls hidden
  const [isClosing, setIsClosing] = useState(false); // slide-down running
  // The captured card plus where it sits on screen, so it can be laid exactly over the spot it was
  // taken from while the sheet slides away.
  const [capturedImage, setCapturedImage] = useState<{ src: string; style: React.CSSProperties } | null>(
    null,
  );

  const isReady = state.status === "ready";

  phaseRef.current = isCapturing
    ? "capturing"
    : state.status === "ready"
      ? "preview"
      : state.status === "error"
        ? "error"
        : "loading";

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // A full-screen sheet over a page that scrolls. Locking the page is not only politeness: on iOS a
  // fixed overlay above a scrolled document is offset by the visual viewport, which crops the sheet
  // off the top of the screen. Freezing the body at its current offset keeps the two in step, and
  // the position is restored on the way out.
  useEffect(() => {
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // The guide geometry is derived from the sheet's real size rather than from vh/dvh, which mobile
  // Safari resolves against a viewport that is not always the one on screen. Re-measured when the
  // URL bar slides, on rotation, and on keyboard show/hide.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      element.style.setProperty("--sc-viewport-width", `${rect.width}px`);
      element.style.setProperty("--sc-viewport-height", `${rect.height}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  // `opened` once per mount, and `abandoned` if the parent tears the sheet down without it closing —
  // between them every session is accounted for exactly once.
  useEffect(() => {
    emit({
      type: "opened",
      config: { guideAspectRatio, cropMargin, cameraSwitchEnabled: enableCameraSwitch },
    });
    return () => {
      if (!closedRef.current) emit({ type: "abandoned", at: phaseRef.current });
    };
    // The config is a snapshot of what the sheet opened with; later prop changes do not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit]);

  // Fires again after a manual switch, which is a second camera becoming ready.
  useEffect(() => {
    if (state.status === "ready") {
      const { deviceId, label, megapixels } = state.camera;
      emit({ type: "camera_ready", camera: { deviceId, label, megapixels }, selection: reportRef.current });
      reportRef.current = null;
    } else if (state.status === "error") {
      emit({ type: "camera_failed", reason: state.reason, message: state.message });
    }
  }, [state, emit]);

  // Slide the sheet down, then hand off to the parent — the same 600 ms handshake as before.
  const closeAfterSlide = useCallback(
    (outcome: "captured" | "cancelled", then?: () => void) => {
      setIsClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        closedRef.current = true;
        emit({ type: "closed", outcome });
        then?.();
        setStream(false);
      }, SLIDE_MS);
    },
    [emit, setStream],
  );

  const handleCancel = () => {
    if (isClosing) return;
    emit({ type: "cancel_clicked", from: state.status === "error" ? "error" : "preview" });
    onStreamCancel?.();
    setIsCapturing(true);
    closeAfterSlide("cancelled");
  };

  const handleCapture = async () => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (isCapturing || state.status !== "ready" || !video || !guide) return;

    emit({ type: "capture_clicked" });
    onClickCapture?.();
    setIsCapturing(true);
    const startedAt = performance.now();

    try {
      const crop = cropSpecFromElements(guide, video, { margin: cropMargin });
      const result = await capturePhoto(video, state.stream, { maxBytes: MAX_UPLOAD_BYTES, crop });
      const dataUrl = await blobToDataUrl(result.blob);
      const meta: CapturedImageMeta = { focus: result.focus, width: result.width, height: result.height };

      // Where the cut region sits on the element, in CSS px — exact, including the crop margin
      // and any clamping at the frame edge.
      const placed = result.cropRect ? mapSourceToOverlay(result.cropRect, crop, result.sourceSize) : null;
      const style: React.CSSProperties = placed
        ? { left: placed.x, top: placed.y, width: placed.width, height: placed.height }
        : { left: 0, top: 0, width: "100%", height: "100%" };

      emit({
        type: "capture_succeeded",
        durationMs: Math.round(performance.now() - startedAt),
        image: {
          width: result.width,
          height: result.height,
          bytes: result.blob.size,
          quality: result.quality,
          cropped: result.cropped,
        },
        source: result.source,
      });

      video.pause(); // freeze the rest of the preview while the sheet slides away
      setCapturedImage({ src: dataUrl, style });
      closeAfterSlide("captured", () => {
        void uploadImage(dataUrl, meta);
      });
    } catch (error) {
      console.error("[stream-capture] capture failed", error);
      emit({ type: "capture_failed", message: error instanceof Error ? error.message : String(error) });
      setIsCapturing(false); // give the controls back so the user can try again
    }
  };

  const canSwitch = enableCameraSwitch && state.status === "ready" && state.allCameras.length > 1;
  const handleSwitch = () => {
    if (state.status !== "ready" || isCapturing) return;
    const index = state.allCameras.findIndex((c) => c.deviceId === state.camera.deviceId);
    const next = state.allCameras[(index + 1) % state.allCameras.length];
    if (!next) return;
    emit({ type: "camera_switched", from: state.camera.deviceId, to: next.deviceId, label: next.label });
    switchTo(next);
  };

  return (
    <CameraContainer
      ref={containerRef}
      className="camera-container"
      data-capturing={isCapturing}
      data-closing={isClosing}
      // The whole guide geometry derives from this one number; see stream-capture.styles.
      style={{ "--sc-guide-ratio": guideAspectRatio } as React.CSSProperties}
    >
      <CameraPlaceholder data-ready={isReady} />
      <CameraVideo ref={videoRef} className="camera" autoPlay playsInline muted data-ready={isReady} />

      {capturedImage && (
        <CapturedImage
          src={capturedImage.src}
          alt="captured"
          className="captured-image"
          style={capturedImage.style}
        />
      )}

      <GuideBox ref={guideRef} id={`${idPrefix}_guide_box`} />
      <GuidelineTextBox id={`${idPrefix}_guidelines_text_box`} className="container">
        <GuidelineTextTitle id={`${idPrefix}_instruction_text`}>
          {cmsContent.instructionText}
        </GuidelineTextTitle>
      </GuidelineTextBox>

      {state.status === "error" && (
        <ErrorOverlay role="alert">
          <ErrorText>{state.message}</ErrorText>
          <CancelButton
            type="button"
            onClick={() => {
              emit({ type: "retry_clicked" });
              retry();
            }}
          >
            {cmsContent.retryText ?? "Try again"}
          </CancelButton>
          <CancelButton type="button" onClick={handleCancel}>
            {cmsContent.cancelText}
          </CancelButton>
        </ErrorOverlay>
      )}

      <CaptureControlsContainer>
        <CancelButton
          type="button"
          onClick={handleCancel}
          data-testid={`${idPrefix}_cancel_button`}
        >
          {cmsContent.cancelText}
        </CancelButton>
        <CaptureButton
          id={`${idPrefix}_capture_button`}
          data-testid={`${idPrefix}_capture_button`}
          onClick={() => void handleCapture()}
          disabled={!isReady || isCapturing}
        />
        {/* Third slot keeps the layout symmetrical, as before; doubles as the optional switcher. */}
        <CancelButton
          type="button"
          $invisible={!canSwitch}
          disabled={!canSwitch}
          aria-hidden={!canSwitch}
          onClick={handleSwitch}
        >
          {canSwitch ? cmsContent.switchCameraText ?? "Switch camera" : cmsContent.cancelText}
        </CancelButton>
      </CaptureControlsContainer>
    </CameraContainer>
  );
};

export default StreamCapture;
