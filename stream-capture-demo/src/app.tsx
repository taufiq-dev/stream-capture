// app.tsx
//
// A harness around <StreamCapture>: open the sheet, capture, and see what came back. Every time the
// sheet opens it records a "session" — what the camera cache held beforehand, and whether a
// selection report arrived — which is what makes the cached-session behaviour visible.

import { useCallback, useRef, useState } from "react";
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
  Field,
  Figure,
  Focused,
  Lead,
  Mono,
  Muted,
  Page,
  Row,
  Scroll,
  SessionItem,
  SessionList,
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

type Captured = { dataUrl: string; meta: CapturedImageMeta };

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
      } · ${event.durationMs} ms · ${event.source}`;
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

const App = () => {
  const [open, setOpen] = useState(false);
  const [enableSwitch, setEnableSwitch] = useState(true);
  const [cropMargin, setCropMargin] = useState(0.08);
  const [aspect, setAspect] = useState<number>(GUIDE_ASPECT.DESIGN);
  const [cache, setCache] = useState<CachedCamera | null>(readCache);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [log, setLog] = useState<LoggedEvent[]>([]);
  const sessionIdRef = useRef(0);
  const seqRef = useRef(0);

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

  const handleUpload = useCallback(
    async (dataUrl: string, meta: CapturedImageMeta) => {
      setCaptured({ dataUrl, meta });
    },
    [],
  );

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

      <Card>
        <CardTitle>Event log — emitEvent</CardTitle>
        {log.length === 0 ? (
          <Muted>Nothing yet.</Muted>
        ) : (
          <Scroll>
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

      <Card>
        <CardTitle>Sessions</CardTitle>
        {sessions.length === 0 ? (
          <Muted>Nothing yet.</Muted>
        ) : (
          <SessionList>
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </SessionList>
        )}
      </Card>

      {captured && (
        <Card>
          <CardTitle>Last capture</CardTitle>
          <div>
            <Mono>
              {captured.meta.width}×{captured.meta.height} · ~{(approxBytes(captured.dataUrl) / 1024).toFixed(0)} KB ·
              focus x {captured.meta.focus.x.toFixed(3)}, y {captured.meta.focus.y.toFixed(3)}, w{" "}
              {captured.meta.focus.width.toFixed(3)}, h {captured.meta.focus.height.toFixed(3)}
            </Mono>
          </div>
          <Figure>
            <UploadedImage src={captured.dataUrl} alt="Uploaded capture, margin included" />
            <figcaption>What uploadImage received — guide box plus margin, for the backend.</figcaption>
          </Figure>
          <Figure>
            <Focused
              src={captured.dataUrl}
              focus={captured.meta.focus}
              imageWidth={captured.meta.width}
              imageHeight={captured.meta.height}
              alt="Capture cropped to the guide box"
            />
            <figcaption>&lt;FocusedImage&gt; — the same file, shown as the user framed it.</figcaption>
          </Figure>
        </Card>
      )}

      {open && (
        <StreamCapture
          cmsContent={CMS_CONTENT}
          uploadImage={handleUpload}
          setStream={handleSetStream}
          cropMargin={cropMargin}
          guideAspectRatio={aspect}
          enableCameraSwitch={enableSwitch}
          emitEvent={handleEvent}
        />
      )}
    </Page>
  );
};

export default App;
