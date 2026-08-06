# Final7 App H5 carrier runbook

This carrier is intentionally split from the PC service. It uses four frozen ports:

- `5176`: production H5 over loopback HTTPS. Port `5175` is intentionally not reused because an independently owned HTTP preview already occupies it.
- `18116`: loopback HTTPS proxy to the frozen backend at `http://127.0.0.1:8110`.
- `18111`: loopback-only OTP delivery sink. It accepts `POST /deliver` and stores the latest payload only in the restricted run directory.
- `8110`: existing backend process. **DO NOT START, STOP, OR RESTART 8110 OR 3002 without a separate controller instruction.**

The Playwright spec never reads browser storage, injects a session, opens a hidden page URL, or prints an OTP. Its only top-level navigation is the H5 origin; all later navigation is through visible controls.

## Build gate

Run from the authoritative App worktree:

```powershell
$env:VITE_NEXGRID_API_MODE = 'remote'
$env:VITE_NEXGRID_API_BASE_URL = 'https://127.0.0.1:18116'
& 'D:\software\nodejs\npm.cmd' run build:h5
```

The expected production output is `dist/build/h5/index.html`. Record a SHA-256 manifest after the build. Do not reuse a build compiled against raw `http://127.0.0.1:8110`.

## TLS and carrier start gate

Create a short-lived PKCS12 certificate inside the restricted evidence directory. Supply its password only through the current process environment; never print or commit it.

```powershell
& 'D:\software\Java\jdk-17\bin\keytool.exe' -genkeypair `
  -alias final7-loopback -keyalg RSA -keysize 2048 -validity 2 `
  -storetype PKCS12 -keystore $env:APP_TLS_PFX_FILE `
  -storepass $env:APP_TLS_PFX_PASSWORD -keypass $env:APP_TLS_PFX_PASSWORD `
  -dname 'CN=127.0.0.1, OU=Acceptance, O=Nexion, C=JP' `
  -ext 'SAN=ip:127.0.0.1,dns:localhost'
```

Required carrier variables:

```text
APP_RESTRICTED_EVIDENCE_DIR=<absolute .restricted Final7 directory>
APP_TLS_PFX_FILE=<child of APP_RESTRICTED_EVIDENCE_DIR>
APP_TLS_PFX_PASSWORD=<ephemeral process-only value>
APP_H5_DIST_DIR=D:\workspace\.acceptance\pc-full-acceptance-20260729-114336-app-master\dist\build\h5
APP_BACKEND_ORIGIN=http://127.0.0.1:8110
```

Start `tests/e2e/final7-app-h5-loopback-carrier.mjs` with Node in a hidden process. Record the PID, start time, script SHA-256, PFX SHA-256 and production H5 manifest SHA-256. The carrier must bind only `127.0.0.1`; its H5 origin is `https://127.0.0.1:5176`.

The backend must already have been started with this one additional property, otherwise registration OTP delivery fails closed:

```text
--nexion.auth.user-otp.delivery-url=http://127.0.0.1:18111/deliver
```

Adding that property requires a backend restart, which is outside this preparation gate. Its reversible recovery is to stop only the newly started backend process and relaunch the frozen command without that single property. Never alter the JAR, database, Redis or PC process as part of carrier preparation.

## Static discovery gate

These commands do not execute the registration write chain:

```powershell
node --check tests/e2e/final7-app-h5-loopback-carrier.mjs
node --test tests/final7-app-h5-carrier-contract.test.mjs
& 'D:\software\nodejs\npx.cmd' playwright test `
  tests/e2e/final7-app-h5-f003-l008-dynamic.spec.ts `
  --project=chromium --list
```

## Authorized dynamic command (not part of preparation)

Only after the controller confirms backend `8110` is the frozen candidate and is already wired to the restricted sink:

```powershell
$env:ADMIN_BASE_URL = 'https://127.0.0.1:5176'
$env:APP_H5_BASE_URL = 'https://127.0.0.1:5176'
$env:APP_BACKEND_PROXY_ORIGIN = 'https://127.0.0.1:18116'
$env:APP_OTP_SINK_FILE = Join-Path $env:APP_RESTRICTED_EVIDENCE_DIR 'otp-sink-latest.json'
$env:APP_RUN_ID = '<controller Run ID>'
$env:APP_TEST_COUNTRY_CODE = '+1'
$env:APP_TEST_PHONE = '<controller-issued unique test phone>'
& 'D:\software\nodejs\npx.cmd' playwright test `
  tests/e2e/final7-app-h5-f003-l008-dynamic.spec.ts `
  --project=chromium --workers=1 --trace=on `
  --output=(Join-Path $env:APP_RESTRICTED_EVIDENCE_DIR 'playwright')
```

The OTP and generated password are never included in `safe-result.json`, screenshots, traces written by the spec, or `cleanup-manifest-private.json`. The sink file is deleted in the spec's `finally` block.
