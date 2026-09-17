// camera-selection.ts
//
// Picks the main rear camera on multi-camera phones. `facingMode: "environment"` only guarantees
// *a* rear camera and enumerateDevices() order is not stable, so we never pick by index: read each
// camera's capabilities, score them, remember the winner, and let the UI override.

import * as v from "valibot";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ZoomCapability = { min?: number; max?: number; step?: number };

// lib.dom's MediaTrackCapabilities does not declare `zoom` (it comes from the Image Capture spec).
type VideoCapabilities = MediaTrackCapabilities & { zoom?: ZoomCapability };

type CapabilitySource = "default-stream" | "device-info" | "stream-probe" | "none";

export type CameraCandidate = {
  deviceId: string;
  label: string;
  maxWidth: number;
  maxHeight: number;
  megapixels: number;
  zoomMin: number | null;
  facingMode: string[];
  source: CapabilitySource;
};

export type ScoredCandidate = CameraCandidate & { score: number; isRear: boolean };

export type SelectionStrategy = "cached" | "single-camera" | "scored" | "manual";

export type CameraSelectionResult = {
  stream: MediaStream;
  camera: CameraCandidate;
  allCameras: ScoredCandidate[];
  browserDefaultDeviceId: string | null;
  strategy: SelectionStrategy;
};

export type SelectionReport = {
  userAgent: string;
  strategy: SelectionStrategy;
  browserDefaultDeviceId: string | null;
  candidates: ScoredCandidate[];
  selectedDeviceId: string;
};

export type SelectOptions = {
  useCache?: boolean;
  probeTimeoutMs?: number;
  onReport?: (report: SelectionReport) => void;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const stopStream = (stream: MediaStream): void => {
  stream.getTracks().forEach((track) => track.stop());
};

const trackOf = (stream: MediaStream): MediaStreamTrack | undefined => stream.getVideoTracks()[0];

const readTrackCapabilities = (track: MediaStreamTrack | undefined): VideoCapabilities | null =>
  typeof track?.getCapabilities === "function" ? (track.getCapabilities() as VideoCapabilities) : null;

const supportsTrackCapabilities = (): boolean =>
  typeof MediaStreamTrack !== "undefined" &&
  typeof MediaStreamTrack.prototype.getCapabilities === "function";

const toCandidate = (
  device: Pick<MediaDeviceInfo, "deviceId" | "label">,
  caps: VideoCapabilities | null,
  source: CapabilitySource,
): CameraCandidate => {
  const maxWidth = caps?.width?.max ?? 0;
  const maxHeight = caps?.height?.max ?? 0;
  return {
    deviceId: device.deviceId,
    label: device.label,
    maxWidth,
    maxHeight,
    megapixels: (maxWidth * maxHeight) / 1_000_000,
    zoomMin: caps?.zoom?.min ?? null,
    facingMode: caps?.facingMode ?? [],
    source: caps ? source : "none",
  };
};

// getUserMedia can hang indefinitely when another app holds the camera. Only probes get a
// timeout — the initial permission call must not, because the user may sit on the prompt.
const getUserMediaWithTimeout = (
  constraints: MediaStreamConstraints,
  ms: number,
): Promise<MediaStream> =>
  new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`getUserMedia timed out after ${ms}ms`));
    }, ms);

    navigator.mediaDevices.getUserMedia(constraints).then(
      (stream) => {
        clearTimeout(timer);
        // If the camera only opened after we gave up, release it rather than leak it.
        if (timedOut) stopStream(stream);
        else resolve(stream);
      },
      (error) => {
        clearTimeout(timer);
        if (!timedOut) reject(error);
      },
    );
  });

// ---------------------------------------------------------------------------
// Reading capabilities
// ---------------------------------------------------------------------------

// Chromium returns InputDeviceInfo from enumerateDevices(); its getCapabilities() is specified to
// return the same data as opening the device and reading the track. No camera switching, no flicker.
// Safari and Firefox don't implement it, so we feature-detect and fall back to probing.
const hasDeviceCapabilities = (device: MediaDeviceInfo): device is InputDeviceInfo =>
  typeof (device as Partial<InputDeviceInfo>).getCapabilities === "function";

const readDeviceInfoCapabilities = (device: MediaDeviceInfo): VideoCapabilities | null => {
  if (!hasDeviceCapabilities(device)) return null;
  const caps = device.getCapabilities() as VideoCapabilities;
  // Returns {} until permission is granted — treat that as "unknown", not "no capabilities".
  return caps.width || caps.height || caps.facingMode ? caps : null;
};

type ProbeResult = { opened: true; caps: VideoCapabilities | null } | { opened: false };

const probeCamera = async (deviceId: string, timeoutMs: number): Promise<ProbeResult> => {
  try {
    const stream = await getUserMediaWithTimeout(
      { video: { deviceId: { exact: deviceId } } },
      timeoutMs,
    );
    try {
      return { opened: true, caps: readTrackCapabilities(trackOf(stream)) };
    } finally {
      stopStream(stream);
    }
  } catch (error) {
    console.warn(`[camera] probe failed for ${deviceId}`, error);
    return { opened: false };
  }
};

// ---------------------------------------------------------------------------
// Classification and scoring
// ---------------------------------------------------------------------------

const NON_MAIN_KEYWORDS = ["zoom", "tele", "wide", "ultra", "macro", "depth", "periscope"];

// Escape hatch for devices the heuristics get wrong: a rear candidate whose label contains one of
// these fragments wins outright. Empty by default — add a fragment only with a device to justify it.
const PREFERRED_LABEL_FRAGMENTS: string[] = [];

const isRearCamera = (camera: CameraCandidate): boolean => {
  // Capabilities are authoritative when present.
  if (camera.facingMode.length > 0) return camera.facingMode.indexOf("environment") !== -1;
  // Otherwise fall back to the label. An empty label is treated as rear so we never end up with
  // zero candidates on browsers that hide everything.
  const label = camera.label.toLowerCase();
  if (/back|rear|environment/.test(label)) return true;
  return !/front|user|selfie/.test(label);
};

// Capabilities readable without opening a camera: the stream we are already holding for the
// browser's default device, and InputDeviceInfo on Chromium. Null on Safari and Firefox, where the
// caller decides between probing and scoring on labels alone.
const cheapCandidate = (
  device: MediaDeviceInfo,
  browserDefaultDeviceId: string | null,
  defaultCaps: VideoCapabilities | null,
): CameraCandidate | null => {
  if (device.deviceId === browserDefaultDeviceId && defaultCaps) {
    return toCandidate(device, defaultCaps, "default-stream");
  }
  const caps = readDeviceInfoCapabilities(device);
  return caps ? toCandidate(device, caps, "device-info") : null;
};

const scoreCamera = (camera: CameraCandidate): number => {
  let score = 0;

  // Resolution is the strongest signal, but capped so a label/zoom penalty can still overrule it.
  score += Math.min(camera.megapixels, 50) * 10;

  // A minimum zoom above 1x almost always means a telephoto lens.
  if (camera.zoomMin !== null && camera.zoomMin > 1) score -= 400;

  const label = camera.label.toLowerCase();
  for (const keyword of NON_MAIN_KEYWORDS) {
    if (label.includes(keyword)) score -= 300;
  }

  // Android Chrome labels cameras "camera2 <id>, facing back"; id 0 is the main sensor on nearly
  // every device. iOS labels the main wide lens exactly "Back Camera".
  if (/camera2 0\b/.test(label) || label === "back camera") score += 250;

  return score;
};

const scoreAll = (candidates: CameraCandidate[]): ScoredCandidate[] =>
  candidates.map((camera) => ({ ...camera, isRear: isRearCamera(camera), score: scoreCamera(camera) }));

// What the UI offers as alternatives: rear cameras only, best first. Index 0 is the selection.
const rearFirst = (scored: ScoredCandidate[]): ScoredCandidate[] =>
  scored.filter((c) => c.isRear).sort((a, b) => b.score - a.score);

// ---------------------------------------------------------------------------
// Remembering the choice
// ---------------------------------------------------------------------------

// Chromium keeps deviceId stable per origin until the user clears site data, so caching saves the
// whole detection step on repeat visits. Safari rotates ids between sessions, so the cache simply
// misses there. Stored JSON is untrusted input — validate it on the way in.
const CACHE_KEY = "camera-selection/v1";

const CachedCameraSchema = v.object({
  deviceId: v.pipe(v.string(), v.minLength(1)),
  label: v.string(),
  savedAt: v.number(),
});

type CachedCamera = v.InferOutput<typeof CachedCameraSchema>;

const readCachedCamera = (): CachedCamera | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    const parsed = v.safeParse(CachedCameraSchema, JSON.parse(raw));
    return parsed.success ? parsed.output : null;
  } catch {
    return null; // storage blocked or corrupt JSON — behave as a cache miss
  }
};

export const rememberCamera = (camera: CameraCandidate): void => {
  try {
    const entry: CachedCamera = { deviceId: camera.deviceId, label: camera.label, savedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Private mode or quota exceeded — caching is an optimisation, not a requirement.
  }
};

export const forgetCamera = (): void => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
};

// ---------------------------------------------------------------------------
// Opening a camera
// ---------------------------------------------------------------------------

// The still is cut from a preview frame (WYSIWYG — see capture-photo.ts), so the preview has to
// carry the pixels: ask for 4K. `ideal` is a soft request — the browser picks the closest supported
// format and never fails on it — so phones that top out at 1080p still work, with a smaller crop.
// Lower this on a device tier where a 4K preview stutters; the crop math adapts automatically.
type Size = { width: number; height: number };

export const PREVIEW_IDEAL: Size = { width: 3840, height: 2160 };

const previewConstraints = (): MediaTrackConstraints => ({
  width: { ideal: PREVIEW_IDEAL.width },
  height: { ideal: PREVIEW_IDEAL.height },
});

const isStaleDeviceError = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "OverconstrainedError" || name === "NotFoundError";
};

export const openCamera = async (deviceId: string): Promise<MediaStream> => {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, ...previewConstraints() },
    });
  } catch (error) {
    // A stale id (Safari rotation, camera removed) fails with OverconstrainedError/NotFoundError.
    if (isStaleDeviceError(error)) {
      forgetCamera();
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", ...previewConstraints() },
      });
    }
    throw error;
  }
};

// Avoids a reopen (and the flicker that comes with it) when the browser's default was already right.
const reuseOrReopen = async (current: MediaStream, targetDeviceId: string): Promise<MediaStream> => {
  const track = trackOf(current);
  if (track?.readyState === "live" && track.getSettings().deviceId === targetDeviceId) return current;
  stopStream(current);
  return openCamera(targetDeviceId);
};

const openDefaultRearCamera = async (): Promise<MediaStream> => {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", ...previewConstraints() },
    });
  } catch (error) {
    // Desktops and some tablets have no "environment" camera — take whatever exists.
    if (isStaleDeviceError(error)) {
      return navigator.mediaDevices.getUserMedia({ video: { ...previewConstraints() } });
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// The selection flow
// ---------------------------------------------------------------------------

export const selectMainRearCamera = async (
  options: SelectOptions = {},
): Promise<CameraSelectionResult> => {
  const { useCache = true, probeTimeoutMs = 3000, onReport } = options;

  // 1. Permission. No timeout here on purpose.
  const defaultStream = await openDefaultRearCamera();
  const defaultTrack = trackOf(defaultStream);
  const browserDefaultDeviceId = defaultTrack?.getSettings().deviceId ?? null;

  // 2. Enumerate. Labels and capabilities are only populated now that permission is granted.
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput",
  );
  const defaultCaps = readTrackCapabilities(defaultTrack);

  // Every exit reports, so analytics sees problem devices whichever path they take — including the
  // cached and single-camera ones, which are the majority of real sessions.
  const report = (strategy: SelectionStrategy, candidates: ScoredCandidate[], selectedDeviceId: string) => {
    onReport?.({ userAgent: navigator.userAgent, strategy, browserDefaultDeviceId, candidates, selectedDeviceId });
  };

  const finish = async (
    camera: CameraCandidate,
    allCameras: ScoredCandidate[],
    strategy: SelectionStrategy,
  ): Promise<CameraSelectionResult> => {
    const stream = await reuseOrReopen(defaultStream, camera.deviceId);
    rememberCamera(camera);
    return { stream, camera, allCameras, browserDefaultDeviceId, strategy };
  };

  // 3. Cache hit? Only trust it if both id and label still match a present device.
  if (useCache) {
    const cached = readCachedCamera();
    const match =
      cached && devices.find((d) => d.deviceId === cached.deviceId && d.label === cached.label);
    if (match) {
      // The cache saves the probing, not the listing: enumerateDevices() has already returned, so
      // ranking what it gave us costs nothing and opens no camera. Without this the UI would have
      // no alternatives to offer, and a user who once switched to a worse lens could never switch
      // back — the cache would hand them that lens on every later visit.
      const scored = scoreAll(
        devices.map(
          (device) =>
            cheapCandidate(device, browserDefaultDeviceId, defaultCaps) ?? toCandidate(device, null, "none"),
        ),
      );
      const camera = scored.find((c) => c.deviceId === match.deviceId) ?? toCandidate(match, null, "none");
      report("cached", scored, camera.deviceId);
      return finish(camera, rearFirst(scored), "cached");
    }
  }

  // 4. Nothing to choose between.
  if (devices.length <= 1) {
    const device = devices[0] ?? {
      deviceId: browserDefaultDeviceId ?? "",
      label: defaultTrack?.label ?? "",
    };
    const camera = toCandidate(device, defaultCaps, "default-stream");
    const only: ScoredCandidate = { ...camera, score: scoreCamera(camera), isRear: true };
    report("single-camera", [only], camera.deviceId);
    return {
      stream: defaultStream,
      camera,
      allCameras: [only],
      browserDefaultDeviceId,
      strategy: "single-camera",
    };
  }

  // 5. Collect capabilities cheaply first: the stream we already hold, then InputDeviceInfo.
  const cheap = devices.map((device) => cheapCandidate(device, browserDefaultDeviceId, defaultCaps));

  // Only open cameras one by one if something is still unknown AND probing can tell us anything.
  const needsProbe = cheap.some((candidate) => candidate === null) && supportsTrackCapabilities();
  if (needsProbe) stopStream(defaultStream); // most phones refuse a second camera while one is held

  const candidates: CameraCandidate[] = [];
  for (let index = 0; index < devices.length; index += 1) {
    const device = devices[index];
    if (!device) continue;
    const known = cheap[index];
    if (known) {
      candidates.push(known);
      continue;
    }
    if (!needsProbe) {
      candidates.push(toCandidate(device, null, "none")); // label-only scoring
      continue;
    }
    const probe = await probeCamera(device.deviceId, probeTimeoutMs);
    if (probe.opened) candidates.push(toCandidate(device, probe.caps, "stream-probe"));
    // A camera we couldn't even open is not worth selecting.
  }

  // 6. Rank.
  const scored = scoreAll(candidates);
  const rear = rearFirst(scored);
  const preferred = rear.find((c) =>
    PREFERRED_LABEL_FRAGMENTS.some((fragment) => c.label.toLowerCase().includes(fragment)),
  );
  const winner = preferred ?? rear[0];
  if (!winner) throw new DOMException("No rear camera found on this device.", "NotFoundError");

  const strategy: SelectionStrategy = rear.length === 1 ? "single-camera" : "scored";
  report(strategy, scored, winner.deviceId);

  return finish(winner, rear, strategy);
};

// ---------------------------------------------------------------------------
// User-facing error messages
// ---------------------------------------------------------------------------

export const describeCameraError = (error: unknown): string => {
  const name = (error as { name?: unknown } | null)?.name;
  switch (name) {
    case "NotAllowedError":
      return "Camera permission was denied. Please allow camera access and try again.";
    case "NotFoundError":
      return "No suitable camera was found on this device.";
    case "NotReadableError":
      return "The camera is in use by another app. Close it and try again.";
    default:
      return "Couldn't start the camera. Please try again.";
  }
};
