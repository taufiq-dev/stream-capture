// app.tsx
//
// A harness around <StreamCapture>: open the sheet, capture, and see what came back. Every time the
// sheet opens it records a "session" — what the camera cache held beforehand, and whether a
// selection report arrived — which is what makes the cached-session behaviour visible.

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { forgetCamera, type SelectionReport } from "@stream-capture/camera-selection";
import type { StreamCaptureEvent } from "@stream-capture/events";
import StreamCapture, { GUIDE_ASPECT } from "@stream-capture/stream-capture";
import type { CapturedImageMeta } from "@stream-capture/types";
import {
  Badge,
  Button,
  CandidateTable,
  Card,
  CardTitle,
  Count,
  Field,
  Figure,
  FigureLabel,
  Focused,
  Lead,
  Mono,
  Muted,
  Note,
  Page,
  Row,
  Scroll,
  SessionItem,
  SessionList,
  StatLabel,
  Stats,
  StatValue,
  Title,
  UploadedImage,
} from "./app.styles";

// Mirrors CACHE_KEY in camera-selection.ts, which keeps it private. Read-only here, for display.
const CACHE_KEY = "camera-selection/v1";

const CMS_CONTENT = {
  instructionText: "Position your ID card inside the frame",
  cancelText: "Cancel",
  retryText: "Try again",
  switchCameraText: "Switch",
};

type CachedCamera = { deviceId: string; label: string; savedAt: number };

type Session = {
  id: number;
  cacheAtOpen: CachedCamera | null;
  report: SelectionReport | null;
  outcome: "open" | "captured" | "cancelled";
};

type Captured = {
  id: number;
  dataUrl: string;
  meta: CapturedImageMeta;
  // The settings the sheet ran under, kept beside the image. The controls can be changed after a
  // capture, so the readout has to describe the file that exists, not the one the next open would
  // produce.
  cropMargin: number;
  guideAspectRatio: number;
};

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;

type LoggedEvent = { seq: number; event: StreamCaptureEvent };

// One line of detail per event type — what you would actually want beside the name in a log.
const describeEvent = (event: StreamCaptureEvent): string => {
  switch (event.type) {
    case "opened":
      return `ratio ${event.config.guideAspectRatio.toFixed(3)}, margin ${event.config.cropMargin}`;
    case "camera_ready":
      return `${event.camera.label || "(no label)"} · ${event.camera.megapixels.toFixed(1)} MP · ${
        event.selection ? `${event.selection.strategy}, ${event.selection.candidates.length} seen` : "manual switch"
      }`;
    case "camera_failed":
      return `${event.reason}: ${event.message}`;
    case "camera_switched":
      return `→ ${event.label}`;
    case "capture_succeeded":
      return `${event.image.width}×${event.image.height} · ${(event.image.bytes / 1024).toFixed(0)} KB · q${
        event.image.quality
      }${event.focused ? ` · box ${(event.focused.bytes / 1024).toFixed(0)} KB` : ""} · ${
        event.durationMs
      } ms · ${event.source}`;
    case "capture_failed":
      return event.message;
    case "cancel_clicked":
      return `from ${event.from}`;
    case "closed":
      return event.outcome;
    case "abandoned":
      return `at ${event.at}`;
    default:
      return "";
  }
};

const readCache = (): CachedCamera | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedCamera) : null;
  } catch {
    return null;
  }
};

const shortId = (deviceId: string): string => (deviceId ? `${deviceId.slice(0, 8)}…` : "(empty)");

const approxBytes = (dataUrl: string): number => Math.round((dataUrl.length * 3) / 4);

const SessionRow = ({ session }: { session: Session }) => {
  const { report, cacheAtOpen } = session;
  const rearCount = report ? report.candidates.filter((c) => c.isRear).length : 0;

  return (
    <SessionItem>
      <Row>
        <strong>Open #{session.id}</strong>
        {report ? (
          <Badge $tone="positive">report: {report.strategy}</Badge>
        ) : (
          <Badge $tone="warning">no report</Badge>
        )}
        <Muted>{session.outcome}</Muted>
      </Row>

      <div>
        Cache before opening:{" "}
        {cacheAtOpen ? (
          <Mono>
            {cacheAtOpen.label || "(no label)"} · {shortId(cacheAtOpen.deviceId)}
          </Mono>
        ) : (
          <Muted>empty</Muted>
        )}
      </div>

      {report ? (
        <>
          <div>
            {rearCount} rear camera{rearCount === 1 ? "" : "s"} handed to the component →{" "}
            {rearCount > 1 ? "switch button can show" : "nothing to switch to"}
            {report.strategy === "cached" ? " (from cache, no camera reopened)" : ""}
          </div>
          <Scroll>
            <CandidateTable>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Rear</th>
                  <th>MP</th>
                  <th>Zoom min</th>
                  <th>Score</th>
                  <th>Caps from</th>
                </tr>
              </thead>
              <tbody>
                {report.candidates.map((c) => (
                  <tr key={c.deviceId}>
                    <td>
                      {c.deviceId === report.selectedDeviceId ? "★ " : ""}
                      {c.label || "(no label)"}
                      {c.deviceId === report.browserDefaultDeviceId ? " (browser default)" : ""}
                    </td>
                    <td>{c.isRear ? "yes" : "no"}</td>
                    <td>{c.megapixels.toFixed(1)}</td>
                    <td>{c.zoomMin ?? "–"}</td>
                    <td>{Math.round(c.score)}</td>
                    <td>{c.source}</td>
                  </tr>
                ))}
              </tbody>
            </CandidateTable>
          </Scroll>
        </>
      ) : (
        <div>
          No report — every selection path reports now, so the sheet was closed before the camera
          finished opening.
        </div>
      )}
    </SessionItem>
  );
};

type Size = { width: number; height: number };

const formatSize = (size: Size | null): string => (size ? `${size.width} × ${size.height}` : "measuring…");

// Measures what is on screen, live. The card's claim is that two different-looking figures are one
// file, so the sizes it prints are read back from the DOM rather than computed from the numbers that
// produced them — a mistake in the CSS crop would show up here instead of hiding behind arithmetic.
const useRenderedSize = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
};

// Mounted with a key per capture, so the measurements never outlive the image they describe.
const LastCapture = ({ captured }: { captured: Captured }) => {
  const { dataUrl, meta, cropMargin, guideAspectRatio } = captured;
  const [uploadedRef, uploadedSize] = useRenderedSize();
  const [focusedRef, focusedSize] = useRenderedSize();
  const [uploadedPixels, setUploadedPixels] = useState<Size | null>(null);
  const [focusedPixels, setFocusedPixels] = useState<Size | null>(null);

  const readPixels =
    (set: (size: Size) => void) =>
    (event: SyntheticEvent<HTMLImageElement>): void =>
      set({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });

  // The guide box in the encoded image: the fractions in meta.focus, back in pixels.
  const region = {
    width: Math.round(meta.focus.width * meta.width),
    height: Math.round(meta.focus.height * meta.height),
  };
  // What choosing the box over the padded crop actually costs, in bytes. Null when there is no
  // second file to compare against.
  const uploadedBytes = approxBytes(dataUrl);
  const saving = meta.focused
    ? Math.round((1 - meta.focused.bytes / uploadedBytes) * 100)
    : null;
  const sameFile =
    uploadedPixels !== null &&
    focusedPixels !== null &&
    uploadedPixels.width === focusedPixels.width &&
    uploadedPixels.height === focusedPixels.height;

  return (
    <Card>
      <CardTitle>Last capture</CardTitle>

      <Stats>
        <StatLabel>Uploaded file</StatLabel>
        <StatValue>
          {meta.width} × {meta.height} px · ~{kb(uploadedBytes)} JPEG
        </StatValue>

        <StatLabel>Guide box within it</StatLabel>
        <StatValue>
          {region.width} × {region.height} px · {(region.width / region.height).toFixed(3)} : 1{" "}
          <Muted>(the box on screen was {guideAspectRatio.toFixed(3)} : 1)</Muted>
        </StatValue>

        <StatLabel>Focused file</StatLabel>
        <StatValue>
          {meta.focused ? (
            <>
              {meta.focused.width} × {meta.focused.height} px · {kb(meta.focused.bytes)} JPEG{" "}
              {saving === null ? null : saving > 0 ? (
                <Muted>({saving}% smaller than the upload above)</Muted>
              ) : (
                <Muted>(the same file — no margin to encode away)</Muted>
              )}
            </>
          ) : (
            <Muted>not requested — encodeFocused is off</Muted>
          )}
        </StatValue>

        <StatLabel>Margin for the backend</StatLabel>
        <StatValue>
          {cropMargin === 0 ? (
            <Muted>none — cut to the box exactly</Muted>
          ) : (
            `${(cropMargin * 100).toFixed(0)}% of the box on every side`
          )}
        </StatValue>

        <StatLabel>meta.focus</StatLabel>
        <StatValue>
          <Mono>
            x {meta.focus.x.toFixed(3)} · y {meta.focus.y.toFixed(3)} · w {meta.focus.width.toFixed(3)} · h{" "}
            {meta.focus.height.toFixed(3)}
          </Mono>
        </StatValue>
      </Stats>

      <Figure>
        <FigureLabel>1 · Sent to uploadImage</FigureLabel>
        <div ref={uploadedRef}>
          <UploadedImage
            src={dataUrl}
            alt="The uploaded capture, margin included"
            onLoad={readPixels(setUploadedPixels)}
          />
        </div>
        <figcaption>
          The whole crop — the guide box plus the margin, so the backend has room to find the card’s
          edges and correct its perspective.
          <br />
          <Mono>
            {formatSize(uploadedPixels)} decoded · {formatSize(uploadedSize)} on screen
          </Mono>
        </figcaption>
      </Figure>

      <Figure>
        <FigureLabel>2 · Shown to the user — &lt;FocusedImage&gt;</FigureLabel>
        <div ref={focusedRef}>
          <Focused
            src={dataUrl}
            focus={meta.focus}
            imageWidth={meta.width}
            imageHeight={meta.height}
            alt="The same capture, clipped to the guide box"
            onLoad={readPixels(setFocusedPixels)}
          />
        </div>
        <figcaption>
          The same file, clipped to <Mono>meta.focus</Mono> in CSS — the margin hidden, nothing
          re-encoded.
          <br />
          <Mono>
            {formatSize(focusedPixels)} decoded · {formatSize(focusedSize)} on screen
          </Mono>
        </figcaption>
      </Figure>

      <Note>
        {sameFile ? (
          <>
            Both figures decode to the same pixels: one JPEG, encoded once and displayed twice, so
            figure 2 costs the same ~{kb(uploadedBytes)} as figure 1 — its margin is clipped, not
            removed.{" "}
            {meta.focused && saving !== null && saving > 0 ? (
              <>
                The file under <Mono>meta.focused</Mono> is the other way round: the margin is
                encoded away, so it weighs {kb(meta.focused.bytes)}. Send that one when the backend
                wants the card without the context.
              </>
            ) : (
              <>
                Switch on <Mono>encodeFocused</Mono> above to also get the box as a file of its own,
                which is genuinely smaller.
              </>
            )}
          </>
        ) : (
          "Waiting for both figures to decode…"
        )}
      </Note>
    </Card>
  );
};

const App = () => {
  const [open, setOpen] = useState(false);
  const [enableSwitch, setEnableSwitch] = useState(true);
  const [cropMargin, setCropMargin] = useState(0.08);
  // On in the demo, off in the component: this is the card that exists to compare the two files.
  const [encodeFocused, setEncodeFocused] = useState(true);
  const [aspect, setAspect] = useState<number>(GUIDE_ASPECT.DESIGN);
  const [cache, setCache] = useState<CachedCamera | null>(readCache);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [log, setLog] = useState<LoggedEvent[]>([]);
  const sessionIdRef = useRef(0);
  const seqRef = useRef(0);
  const captureIdRef = useRef(0);
  // Read inside handleUpload, which keeps empty deps so its identity never changes under the sheet.
  const settingsRef = useRef({ cropMargin, guideAspectRatio: aspect });
  settingsRef.current = { cropMargin, guideAspectRatio: aspect };

  const patchCurrentSession = useCallback((patch: Partial<Session>) => {
    const id = sessionIdRef.current;
    setSessions((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const handleOpen = () => {
    sessionIdRef.current += 1;
    const session: Session = {
      id: sessionIdRef.current,
      cacheAtOpen: readCache(),
      report: null,
      outcome: "open",
    };
    setSessions((all) => [session, ...all]);
    setOpen(true);
  };

  const handleSetStream = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setCache(readCache());
  }, []);

  const handleEvent = useCallback(
    (event: StreamCaptureEvent) => {
      seqRef.current += 1;
      setLog((all) => [{ seq: seqRef.current, event }, ...all].slice(0, 40));
      if (event.type === "camera_ready" && event.selection) patchCurrentSession({ report: event.selection });
      if (event.type === "closed") patchCurrentSession({ outcome: event.outcome });
    },
    [patchCurrentSession],
  );

  const handleUpload = useCallback(async (dataUrl: string, meta: CapturedImageMeta) => {
    captureIdRef.current += 1;
    setCaptured({ id: captureIdRef.current, dataUrl, meta, ...settingsRef.current });
  }, []);

  const handleClearCache = () => {
    forgetCamera();
    setCache(null);
  };

  return (
    <Page>
      <header>
        <Title>stream-capture demo</Title>
        <Lead>
          Open the camera twice in a row on a phone with more than one rear camera. The first open scores
          the cameras; the second reuses the cached choice.
        </Lead>
        <Lead>
          <strong>Nothing leaves your device.</strong> There is no backend here — a captured photo is held
          in this page&rsquo;s memory to display, and is gone when you close the tab.
        </Lead>
      </header>

      <Card>
        <CardTitle>Controls</CardTitle>
        <Row>
          <Field>
            <input
              type="checkbox"
              checked={enableSwitch}
              onChange={(event) => setEnableSwitch(event.target.checked)}
            />
            enableCameraSwitch
          </Field>
          <Field>
            <input
              type="checkbox"
              checked={encodeFocused}
              onChange={(event) => setEncodeFocused(event.target.checked)}
            />
            encodeFocused
          </Field>
          <Field>
            guide box
            <select value={aspect} onChange={(event) => setAspect(Number(event.target.value))}>
              <option value={GUIDE_ASPECT.DESIGN}>design 1.65 (default)</option>
              <option value={GUIDE_ASPECT.ID_CARD}>ID-1 card 1.586</option>
              <option value={GUIDE_ASPECT.PASSPORT}>passport 1.42</option>
            </select>
          </Field>
          <Field>
            cropMargin
            <select value={cropMargin} onChange={(event) => setCropMargin(Number(event.target.value))}>
              <option value={0}>0</option>
              <option value={0.08}>0.08 (default)</option>
              <option value={0.2}>0.2</option>
            </select>
          </Field>
        </Row>
        <Row>
          <Button type="button" onClick={handleOpen} disabled={open}>
            Open camera
          </Button>
          <Button type="button" $variant="secondary" onClick={handleClearCache} disabled={!cache}>
            Clear camera cache
          </Button>
          {/* Unmounts the sheet without the close handshake, the way a route change would. */}
          <Button type="button" $variant="secondary" onClick={() => setOpen(false)} disabled={!open}>
            Force unmount
          </Button>
        </Row>
        <div>
          Cached camera:{" "}
          {cache ? (
            <Mono>
              {cache.label || "(no label)"} · {shortId(cache.deviceId)} ·{" "}
              {new Date(cache.savedAt).toLocaleTimeString()}
            </Mono>
          ) : (
            <Muted>none — the next open will score every camera</Muted>
          )}
        </div>
      </Card>

      {captured && <LastCapture key={captured.id} captured={captured} />}

      <Card>
        <CardTitle>
          Sessions
          {sessions.length > 0 && <Count>{sessions.length}</Count>}
        </CardTitle>
        {sessions.length === 0 ? (
          <Muted>Nothing yet.</Muted>
        ) : (
          <Scroll $maxHeight="clamp(200px, 44vh, 420px)">
            <SessionList>
              {sessions.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </SessionList>
          </Scroll>
        )}
      </Card>

      <Card>
        <CardTitle>
          Event log — emitEvent
          {log.length > 0 && <Count>{log.length}</Count>}
        </CardTitle>
        {log.length === 0 ? (
          <Muted>Nothing yet.</Muted>
        ) : (
          <Scroll $maxHeight="clamp(160px, 32vh, 300px)">
            <CandidateTable>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>+ms</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {log.map(({ seq, event }) => (
                  <tr key={seq}>
                    <td>{seq}</td>
                    <td>
                      <Mono>{event.type}</Mono>
                    </td>
                    <td>{event.elapsedMs}</td>
                    <td>{describeEvent(event)}</td>
                  </tr>
                ))}
              </tbody>
            </CandidateTable>
          </Scroll>
        )}
      </Card>

      {open && (
        <StreamCapture
          cmsContent={CMS_CONTENT}
          uploadImage={handleUpload}
          setStream={handleSetStream}
          cropMargin={cropMargin}
          guideAspectRatio={aspect}
          enableCameraSwitch={enableSwitch}
          encodeFocused={encodeFocused}
          emitEvent={handleEvent}
        />
      )}
    </Page>
  );
};

export default App;
