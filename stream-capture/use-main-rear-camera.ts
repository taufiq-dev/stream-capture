// use-main-rear-camera.ts
//
// Owns the camera stream for a component: selects the main rear camera on mount, attaches the
// stream to a <video>, cleans up on unmount, and exposes retry / switchTo for the UI.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeCameraError,
  openCamera,
  rememberCamera,
  selectMainRearCamera,
  stopStream,
  type CameraCandidate,
  type CameraSelectionResult,
  type ScoredCandidate,
  type SelectionReport,
} from "./camera-selection";

export type CameraState =
  | { status: "loading" }
  | { status: "ready"; stream: MediaStream; camera: CameraCandidate; allCameras: ScoredCandidate[] }
  // `reason` is the DOMException name where the browser gave one — NotAllowedError (refused),
  // NotReadableError (another app holds the camera), OverconstrainedError (stale device id) — so a
  // parent can tell a permission problem from a hardware one without parsing the message. Two are
  // ours: "interrupted" (a live track ended) and "playback_blocked" (the <video> refused to play).
  | { status: "error"; message: string; reason: string };

export type UseMainRearCameraOptions = {
  // Where to send what each device reported and which camera was picked. Wire this to analytics:
  // it is how problem devices get identified and fixed.
  onReport?: (report: SelectionReport) => void;
};

export type UseMainRearCamera = {
  // Structural, so it satisfies the <video ref> prop on both React 18 and 19 typings.
  videoRef: { current: HTMLVideoElement | null };
  state: CameraState;
  // True once the <video> is rendering frames — later than `state` turning ready, which only means
  // the stream is open. Reveal the preview on this: in the gap between the two, the element shows
  // its poster, and Android WebView's default poster is a grey play button.
  playing: boolean;
  retry: () => void;
  switchTo: (camera: CameraCandidate) => void;
};

export const useMainRearCamera = (options: UseMainRearCameraOptions = {}): UseMainRearCamera => {
  const { onReport } = options;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0);
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;
  const [state, setState] = useState<CameraState>({ status: "loading" });
  const [playing, setPlaying] = useState(false);

  const releaseStream = useCallback(() => {
    if (streamRef.current) stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const run = useCallback(
    async (open: () => Promise<CameraSelectionResult>) => {
      const runId = ++runRef.current;
      releaseStream();
      setState({ status: "loading" });

      try {
        const result = await open();
        if (runId !== runRef.current) {
          stopStream(result.stream); // superseded by a newer run or unmount
          return;
        }
        streamRef.current = result.stream;

        // iOS ends the track when the app is backgrounded; surface it instead of a frozen frame.
        result.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (runId === runRef.current) {
            setState({
              status: "error",
              message: "The camera was interrupted. Please try again.",
              reason: "interrupted",
            });
          }
        });

        setState({
          status: "ready",
          stream: result.stream,
          camera: result.camera,
          allCameras: result.allCameras,
        });
      } catch (error) {
        if (runId === runRef.current) {
          const reason = (error as { name?: unknown } | null)?.name;
          setState({
            status: "error",
            message: describeCameraError(error),
            reason: typeof reason === "string" ? reason : "unknown",
          });
        }
      }
    },
    [releaseStream],
  );

  useEffect(() => {
    void run(() => selectMainRearCamera({ onReport: (report) => onReportRef.current?.(report) }));
    return () => {
      runRef.current += 1;
      releaseStream();
    };
  }, [run, releaseStream]);

  // Attach the stream to whichever <video> is mounted, and report when it is actually playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || state.status !== "ready") return;
    let attached = true;
    const onPlaying = () => setPlaying(true);
    video.addEventListener("playing", onPlaying);
    video.srcObject = state.stream;
    void video.play().catch((error: unknown) => {
      // An AbortError is this effect's own cleanup detaching the stream mid-play; only a refusal
      // matters. muted + playsInline normally prevents one, but a WebView whose host app requires a
      // gesture for media playback may still refuse — and since the preview is only revealed once
      // it plays, staying silent would leave the user looking at an empty placeholder.
      if (!attached || (error as { name?: unknown } | null)?.name !== "NotAllowedError") return;
      releaseStream();
      setState({
        status: "error",
        message: "The camera preview couldn't start. Please try again.",
        reason: "playback_blocked",
      });
    });
    return () => {
      attached = false;
      video.removeEventListener("playing", onPlaying);
      video.srcObject = null;
      setPlaying(false);
    };
  }, [state, releaseStream]);

  const retry = useCallback(() => {
    void run(() =>
      selectMainRearCamera({ useCache: false, onReport: (report) => onReportRef.current?.(report) }),
    );
  }, [run]);

  const switchTo = useCallback(
    (camera: CameraCandidate) => {
      void run(async () => {
        const stream = await openCamera(camera.deviceId);
        rememberCamera(camera);
        return {
          stream,
          camera,
          allCameras: state.status === "ready" ? state.allCameras : [],
          browserDefaultDeviceId: null,
          strategy: "manual",
        };
      });
    },
    [run, state],
  );

  return { videoRef, state, playing, retry, switchTo };
};
