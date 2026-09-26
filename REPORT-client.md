# lib-client: the account and library client

Branch `lib-client`, four commits on top of 3a38de6. `npm run check` passes: typecheck, determinism lint, and 48 of 48 tests.

## What works

- **Sign-in gate** (`app.ts`, `screens/signin.ts`). `mount()` calls `loadAccount()`. If the URL has an `access_token` fragment it runs `finishSignIn()`; a failure shows in red on the sign-in screen. `?dev=<name>` signs in against a `DEV_LOGIN=1` server. The sign-in screen is the logo and one SIGN IN WITH DISCORD button. The frame loop sends the player back to it whenever they're signed out: after a 401 from `api()` or after SIGN OUT. Two exceptions: a match in progress (it finishes first) and the no-account `?quick=` / `?sheet=` pages. Screens that hold resources implement `Screen.abandon()`: the creator detaches the pad, and the online and draw screens close their sockets.
- **Title**: DRAW BATTLE · NEW CHARACTER · MY CHARACTERS · BATTLE · SETTINGS. The parade shows up to six of your ready characters idling, or the house roster when you have none. The Discord avatar and name sit top right, with an initial when there's no avatar. SIGN OUT is the last row of SETTINGS.
- **NEW CHARACTER** (`screens/create.ts`, `screens/forging.ts`). The pad and tool column from draw battle, with no clock, plus DONE and BACK. DONE posts through `library.create`. The progress screen shows the drawing big with the forge's `stage` under it and the pencil sweep, and polls `library.get` every 2 s.
  - Ready: the sheet with the drawing pinned on, name, tagline, the 4-line card, BATTLE WITH IT and BACK.
  - Failed: the error in red, and TRY AGAIN, which reopens the same pad with the drawing intact.
- **MY CHARACTERS** (`screens/library.ts`). A 6-wide grid of sheet thumbnails with names. It scrolls with the focus or with ▲▼. Characters still being forged show their drawing and stage, and opening one goes to the progress screen. Failed ones are in red, and their detail view shows the error. The detail view has FIGHT, DELETE (press twice; "SURE?" for 3 s) and BACK. An empty library shows a line saying so, and NEW CHARACTER is always there.
- **BATTLE** (`screens/battle/*`).
  - Step 1: pick your fighter, with rows YOURS (hidden when empty) and HOUSE.
  - Step 2: your fighter big, then VS CPU / LOCAL 2P / ONLINE.
  - VS CPU: pick the opponent (HOUSE row, then YOURS), CPU LEVEL 1–9, then the existing `StageScreen` for stage, stocks and time.
  - LOCAL 2P: the old select screen's slot logic for two slots. P1 arrives with a fighter and the device that drove the menus. P2 joins by pressing a button on any other device, or with JOIN (MOUSE). Left/right picks, attack or jump readies, shield leaves.
  - ONLINE: the existing `OnlineScreen`. In the room, left/right pages through your library, then the house. On `start`, every client loads every participant's bundle while the room shows "loading …", then builds the match. A bundle that fails to load is a loud error screen.
  - Every local match goes through `LoadingScreen`, and REMATCH / MENU are unchanged.
- **Quick start** (`quick.ts`). `?quick=1&f=<ids>` loads house bundles first. An unknown id throws and lists the house ids. `?gen=` still works, and `?sheet=<house id>` works too.
- **Server** (`server/lobby.ts`). `pick` accepts `{ fighter, bundleUrl }` and no longer checks `roster`. `bundleUrl` must pass `isBundlePath` (`shared/account.ts`): a same-site `…/gen/<id>/bundle.json` or `…/house/<id>/bundle.json` whose folder is the fighter id. This matters because bundles contain code every peer imports, so an arbitrary URL would let one player run code in everyone's browser. The client checks the same thing before it fetches. Room members and `start`'s config players carry `bundleUrl`.

## Verified

Every run below used the local server on :3012 (`DEV_LOGIN=1`), vite on :5178, and `scripts/fake-forge.mjs`.

- `node scripts/libraryshots.mjs` completes. Its screenshots are in `shots/library/`:
  - `00-sign-in`
  - `01-title-house-parade`
  - `02-create`, `02-forging`, `02-forged`
  - `03-library`, `04-library-detail`, `05-library-delete-armed`
  - `06-mode`, `07-cpu-setup`, `08-stage`, `09-vs-cpu` (Ann's forged fighter vs LAMPJACK)
  - `10-title-own-parade`, `11-pick-fighter`
  - `12-local-one-player`, `13-local-both-ready`, `14-local-match` (devices kb1 + kb2)
  - `15`/`16-online-room-host/guest`, `17`/`18-online-match-ann/bob`: two browsers on their own library fighters, both at frame 274, no desync.
- A one-off check (not committed): a forge job failed through `/forge/jobs/:id/fail` shows `19-forge-failed`, and TRY AGAIN reopens the pad with the drawing kept (`20-try-again-same-drawing`). A stale session token in localStorage leads to a 401 and then the sign-in screen (`21-stale-session-signin`).
- `FAST=1 node scripts/drawshots.mjs` plays a whole draw battle with `?dev=` sign-in and no name prompt (`shots/draw/`).
- `scripts/menushots.mjs` walks keyboard-only from the title through BATTLE, VS CPU, level and stage into a fight, pause, and SETTINGS (`shots/menus/`).
- These also pass: `onlinecheck.mjs` (PASS, hashes equal at frame 1006), `onlineplay.mjs` (PASS), `lobbyshots.mjs`, `padcheck.mjs` (PAD OK), `fightershots.mjs`, `posesheets.mjs` (all 8 house fighters) and `record-gearshift.mjs` (no errors, no hook errors).
- Not run: `hotswap.mjs`, which needs pushed game bundles. It is updated to sign in, but that's untested.

## Decisions worth knowing

- **Outside my files (1):** `server/index.ts` capped JSON bodies at 8 KB except `/forge/` and `/games`, so `POST /characters` could never accept a drawing. There was no client-side workaround, so I raised it to 2 MB for paths ending in `/characters`.
- **Outside my files (2):** `server/lobby.ts` has changes beyond `pick`/`start`, because keeping `bundleUrl` on the member needs them. The `Client` type has a new `bundleUrl` field, `fighter` is typed as a string, and a new client starts with `fighter: ""` instead of `"sable"`. `roomInfo` includes `bundleUrl`, and the `roster` import is gone.
- `client/src/screens/sheet.ts` still imports `poseAt` from `render/rig.ts`, because the renderer needs it for sprites too. If lib-engine moves it, that import is a one-line fix at merge. Nothing of mine uses `drawRig` or `resolvePose` any more.
- Navigation goes through `screens/nav.ts` (the interface) and `screens/flow.ts` (the wiring), so screens don't import each other in a cycle. `app.ts` is now just the mount and the frame loop.
- `fighterLoad` moved from `draw/images.ts` to `gen.ts`. It caches one load per URL and never rejects; callers read its state. As a result, a failed bundle stays failed until the page reloads.
- `ButtonMenu.grid()` and `FighterGrid.nav()` make up/down move by row. Grid screens use `ButtonMenu`, so keys, gamepad and taps all work. LOCAL 2P keeps the old select screen's per-device input with `ui.button`.
- `Handoff.match` and `NetVersusOptions` carry `bundles`, so a mid-match bundle swap reloads the fighters before resuming.
- `settings.name` is gone: online rooms and draw battles use the account name.

## Unfinished / not checked

- Real Discord sign-in: only the dev login was exercised. Vite dev doesn't serve `/auth`; the Express server does.
- The LOCAL 2P gamepad join follows the old code but was only tested with keyboards. `padcheck` covers pad input in a match.
- The fake forge always returns LAMPJACK art, so in-match HUD names read LAMPJACK even for renamed characters. That comes from the fake bundle, not the client.
- The settings rows draw ◀ ▶ twice. That was already there before this work, and I left it.
