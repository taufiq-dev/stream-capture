# stream-capture

A full-screen camera sheet for photographing an ID card in a browser, in React. It exists because
the obvious implementation — `facingMode: "environment"` plus a canvas the size of the viewport —
gets two things wrong on real phones:

- **It opens whichever rear camera the browser feels like.** On a multi-lens phone that is often the
  telephoto or macro lens, so the user gets a cropped, dim, hard-to-focus preview of a document.
- **It captures the preview at display resolution.** A guide box 368 px wide on screen yields a
  368 px-wide crop, which is not enough pixels for OCR, however good the phone's sensor is.

This picks the main rear camera by scoring what each one reports, and cuts the crop from a
full-resolution preview frame in source pixels — so the upload is 1000–2000 px wide and is exactly
what the user framed.

```
stream-capture/        the component and its camera code — no build step, no dependencies of its own
stream-capture-demo/   an rsbuild app to exercise it on a real phone
```

## Running the demo

```sh
cd stream-capture-demo
pnpm install
pnpm dev        # https + self-signed cert, for phones on the LAN
pnpm dev:http   # plain http://localhost:3001, for desktop
```

`getUserMedia` needs a secure context. `http://localhost` counts as one, so `dev:http` is fine on
your own machine; a phone needs the HTTPS server, and will warn once about the certificate.

The demo is also where the component is type-checked — `stream-capture/` has no `tsconfig` of its
own, and `pnpm typecheck` in the demo covers both.

## Deploying the demo

The demo is static, so it deploys as an assets-only Worker — no server code involved. The
dashboard's Git integration builds it on every push to `main`, with preview URLs for pull requests.
To deploy by hand instead:

```sh
cd stream-capture-demo
pnpm wrangler login
pnpm deploy          # builds, then wrangler deploy
```

Nothing is stored or transmitted by the demo: a captured photo lives in the page's memory until the
tab closes. A camera-permission prompt on a public URL deserves that said plainly, so the page says
it too.

## How it works

**Choosing the camera** (`camera-selection.ts`). `facingMode: "environment"` only promises *a* rear
camera, and `enumerateDevices()` order is not stable, so nothing is ever picked by index. Each
camera's capabilities are read — from the stream already open, from `InputDeviceInfo` on Chromium,
or by briefly opening each one where neither is available — and scored on resolution, minimum zoom
and label. The winner is remembered in `localStorage`, which on a return visit skips the probing,
not the listing: alternatives are still offered so the user can switch, and switch back.

**Taking the photo** (`capture-photo.ts`). The camera is opened asking for a 4K preview. On capture,
a few frames are sampled, scored for sharpness (variance of a Laplacian on a small grayscale copy),
and the sharpest is kept — only the winner is ever drawn at full size, so a 4K frame doesn't blow
mobile Safari's canvas budget. The guide box is then mapped from CSS pixels through the element's
`object-fit` onto source pixels and cut 1:1, with a margin around it for the backend's own detection
and perspective correction. The JPEG is fitted under the upload limit by shedding pixels before
quality, because blocking artifacts hurt document recognition more than a modest downscale does.

**Keeping it honest.** The guide box is a DOM element and the crop reads its rendered rectangle, so
the two cannot drift — including after a URL-bar or orientation change. After the shutter, the
captured image is laid over the exact region it was cut from, so the user can see that what they
framed is what was taken.

## Using it

```tsx
<StreamCapture
  cmsContent={{ instructionText: "Position your ID card inside the frame", cancelText: "Cancel" }}
  uploadImage={async (dataUrl, meta) => { /* the whole crop, margin included */ }}
  setStream={setOpen}
  guideAspectRatio={GUIDE_ASPECT.ID_CARD}
  enableCameraSwitch
  emitEvent={(event) => { /* opened, camera_ready, capture_succeeded, closed, … */ }}
/>
```

`uploadImage` receives the crop plus its margin, and a `meta.focus` rectangle saying where the guide
box sits inside it. Pass that to `<FocusedImage>` to show the user just the card while the backend
keeps the context — no second encode, CSS only.

`emitEvent` is the whole lifecycle as one typed stream (`events.ts`): every session ends in exactly
one `closed` or `abandoned`, so funnel numbers add up. Handlers are wrapped — analytics that throws
can never cost someone their capture.

## Notes

- `GUIDE_ASPECT.ID_CARD` is the real ISO/IEC 7810 ID-1 ratio (1.586) shared by bank cards and most
  national ID cards. The default, `DESIGN` (1.65), is a design mockup's box kept for compatibility.
- The component's CSS custom properties are all prefixed `--sc-`, since the sheet renders inside a
  host page that may define its own.
- `camera.label` is device-fingerprinting data. Fine for your own analytics; think before forwarding
  it to a third party.
