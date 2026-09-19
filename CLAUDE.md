# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A React full-screen camera sheet for photographing an ID card in a mobile browser. The two things
it exists to get right — and that any change must not regress:

1. **Camera choice.** `facingMode: "environment"` only promises *a* rear camera, so cameras are
   scored on capabilities, never picked by `enumerateDevices()` index.
2. **Capture resolution.** The crop is cut from a full-resolution preview frame in *source* pixels,
   never from a viewport-sized canvas. The guide box is a DOM element and the crop reads its
   rendered rect, so preview and capture cannot drift.

`README.md` has the full design rationale; read it before changing capture or selection logic.

## Layout

```
stream-capture/        the component. Plain folder: no package.json, no node_modules, no build step
stream-capture-demo/   rsbuild app that exercises it on a real phone; also where it is type-checked
```

`stream-capture/` has no dependencies of its own. Its bare imports (`react`, `styled-components`,
`valibot`) resolve against the demo's `node_modules` via two parallel aliases that must stay in
sync when adding an import:

- `stream-capture-demo/tsconfig.json` → `paths` (for `tsc`)
- `stream-capture-demo/rsbuild.config.ts` → `resolve.alias` + `resolve.modules` (for the bundler)

The demo imports the component as `@stream-capture/*`.

## Commands

All run from `stream-capture-demo/` (pnpm):

```sh
pnpm dev        # https on 0.0.0.0 with a self-signed cert — for phones on the LAN
pnpm dev:http   # plain http://localhost:3001 — desktop only
pnpm typecheck  # tsc --noEmit; covers ../stream-capture too. The only check in the repo
pnpm build      # rsbuild build → dist/
pnpm deploy     # build + wrangler deploy (static-assets-only Worker)
```

`getUserMedia` needs a secure context: `http://localhost` qualifies, a LAN IP does not.

There are **no tests and no linter**. `pnpm typecheck` is the verification step — run it after any
change under either folder. Nothing here can be verified without a real phone camera, so state
plainly what was and wasn't exercised.

## Conventions

- **TypeScript is strict**, including `noUncheckedIndexedAccess` — indexing an array yields
  `T | undefined` and the code is written to handle that (see the switch-camera logic).
- **Comments explain why, not what.** Nearly every non-obvious block carries a short prose comment
  naming the browser behaviour or device quirk it exists for (iOS visual-viewport offsets, Safari
  canvas memory budget, Chromium-only `InputDeviceInfo`, Safari rotating device ids). Match that
  register when editing: if you work around a platform bug, say which one. Each file opens with a
  header comment stating its job.
- **CSS custom properties are prefixed `--sc-`** — the sheet renders inside a host page that may
  define its own. The guide geometry derives from `--sc-guide-ratio` and the measured
  `--sc-viewport-{width,height}`; don't reintroduce `vh`/`dvh` for sheet geometry, it is measured at
  runtime because mobile Safari's units don't match the screen.
- **Element ids and test ids come from `idPrefix`** (`${prefix}_guide_box`, `_capture_button`, …) so
  a host app can keep its existing automation names. Never hardcode them.
- **Events** (`events.ts`) are lowercase snake_case, one discriminated union. Every session ends in
  exactly one terminal `closed` or `abandoned` — preserve that invariant so funnels add up.
  `emitEvent` is fire-and-forget and wrapped in try/catch: a throwing analytics handler must never
  cost a capture.
- **`localStorage` is untrusted input** — the camera cache is validated with valibot on read.
- Timing constants are duplicated deliberately: `SLIDE_MS` in `stream-capture.tsx` must match the
  slide animation duration in `stream-capture.styles.tsx`.
- The demo deliberately renders **without `<StrictMode>`**: the dev double-mount opens the camera
  twice and makes the cached/scored session behaviour non-deterministic.

## Deploying

The demo deploys as an assets-only Worker (`wrangler.jsonc`, `assets.directory: ./dist`) — no server
code, no backend. Pushes to `main` build via the dashboard's Git integration. `account_id` is
intentionally absent from the config; add it locally if deploying by hand.

The demo transmits and stores nothing: a captured photo lives in page memory until the tab closes,
and the page says so because it asks for camera permission on a public URL. Keep that true.
