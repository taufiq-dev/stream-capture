// types.ts
import type { SelectionReport } from "./camera-selection";
import type { FocusRegion } from "./capture-photo";
import type { StreamCaptureEvent } from "./events";

export type StreamCaptureContent = {
  instructionText?: string;
  line1?: string;
  line2?: string;
  loadingText?: string;
  cancelText?: string;
};

/** Everything needed to display the captured image as the user framed it. */
export type CapturedImageMeta = {
  /** The guide box within the image, as fractions. Pass to <FocusedImage> to hide the margin. */
  focus: FocusRegion;
  /** Encoded image size in pixels. */
  width: number;
  height: number;
  /**
   * The guide box as a file of its own, present only when `encodeFocused` asked for one. Send this
   * instead of the first argument when the backend wants the card without the surrounding context.
   *
   * <FocusedImage> and this are not the same thing: it hides the margin in CSS and costs the same
   * bytes as the full crop, while this one has the margin encoded away and is genuinely smaller.
   * Where there is no margin to remove (`cropMargin` 0) the two files are one and the same, and
   * `dataUrl` here is the string passed as the first argument.
   */
  focused?: { dataUrl: string; width: number; height: number; bytes: number };
};

export type StreamCaptureProps = {
  cmsContent: StreamCaptureContent & {
    retryText?: string;
    switchCameraText?: string;
  };
  /**
   * Receives the captured card as a JPEG data URL — the whole crop, margin included, for the
   * backend. `meta` says where the guide box sits in it; callers that ignore it still compile.
   */
  uploadImage: (dataUrl: string, meta: CapturedImageMeta) => Promise<void>;
  setStream: (open: boolean) => void;
  /**
   * Context added around the guide box on each side, as a fraction of the box (default 0.08).
   * Gives the backend room for detection and perspective correction; 0 crops to the box exactly.
   */
  cropMargin?: number;
  /**
   * Shape of the guide box, as width ÷ height — a number, because the layout divides by it.
   * Defaults to GUIDE_ASPECT.DESIGN (1.65, the original design box); GUIDE_ASPECT.ID_CARD is the
   * true ID-1 card outline. The box shrinks to fit rather than overflow when the shape is tall.
   */
  guideAspectRatio?: number;
  /**
   * Prefix for the element ids and data-testids rendered by the sheet — `<prefix>_guide_box`,
   * `<prefix>_capture_button`, `<prefix>_cancel_button`, `<prefix>_instruction_text`,
   * `<prefix>_guidelines_text_box`. Defaults to "stream_capture"; pass the names your existing
   * test and analytics automation already expects.
   */
  idPrefix?: string;
  /**
   * Every notable thing the sheet does, as one typed stream: opened, camera_ready, camera_failed,
   * retry_clicked, camera_switched, capture_clicked, capture_succeeded, capture_failed,
   * cancel_clicked, and then exactly one of closed or abandoned. Fire-and-forget: the return value
   * is ignored and a handler that throws is caught, so analytics can never cost a capture.
   */
  emitEvent?: (event: StreamCaptureEvent) => void;
  /** @deprecated Listen for `capture_clicked` on emitEvent. */
  onClickCapture?: () => void;
  /** @deprecated Listen for `cancel_clicked` on emitEvent. */
  onStreamCancel?: () => void;
  /** @deprecated Read `selection` from the `camera_ready` event on emitEvent. */
  onCameraReport?: (report: SelectionReport) => void;
  /** Shows a "switch camera" control when more than one rear camera is available. Off by default. */
  enableCameraSwitch?: boolean;
  /**
   * Also encode the guide box on its own and hand it to `uploadImage` as `meta.focused`, so the
   * call site can choose which file it sends. Off by default: it is a second JPEG encode in the
   * moment after the shutter, and callers that send the padded crop have no use for it.
   *
   * Only worth setting when both files are wanted. When the backend wants nothing but the box,
   * `cropMargin={0}` gets there in one encode and one file.
   */
  encodeFocused?: boolean;
};
