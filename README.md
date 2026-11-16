# @fingerly/lynx

The Fingerly SDK for Lynx (`0.3.0`, `v: 3`). It is a thin Native Module over the
Fingerly iOS and Android SDKs; all collection, transport and attestation stay
native.

Lynx 4.1 on iOS and Android is supported. HarmonyOS, Web, Lynxtron and
per-`LynxView` registration are not supported.

## Install

```sh
pnpm add @fingerly/lynx@^0.3.0
```

The host app must enable [Lynx Native Library Autolink](https://lynxjs.org/guide/autolink):

- Android: apply `org.lynxsdk.library-settings` in `settings.gradle` and
  `org.lynxsdk.library-build` in the app module, then sync and rebuild.
- iOS: install `cocoapods-lynx-library`, add
  `plugin 'cocoapods-lynx-library'` and `use_lynx_library!` to the Podfile, run
  `pod install`, then rebuild.

The Android module depends on `io.fingerly:fingerly:0.3.0` from Fingerly's Maven
repository (`mavenLocal()` is also configured for local artifact staging). Android
hosts add Fingerly's repository in `settings.gradle`:

```groovy
maven { url 'https://maven.fingerly.io' }
```

This bridge is licensed under Apache-2.0. The native SDKs it depends on are
closed binaries under the Fingerly SDK License.

The package's `lynx.lib.json` registers the `Fingerly` Native Module. Native
Modules are available from Lynx background-thread scripting, so call the SDK
from an event handler, effect, or other background function.

## Identify

```ts
import { load } from '@fingerly/lynx'

// consent: only once you have consent (or another lawful basis)
const fingerly = await load({ apiKey: 'fly_pk_production_…', consent: 'granted' })
const result = await fingerly.identify({ tag: 'checkout' })

// Send result.requestId to your backend and make the decision there.
```

`load` reports `lynx-ios` or `lynx-android`, allowing the server to select the
correct native risk profile. For production Android keys, configure
`AllowedAndroidSigners` (64-hex SHA-256 signing certificate digests) alongside
`AllowedAndroidPackages` in the dashboard.

`identify()` submits a single-pass `v: 3` identification (`1-RTT` steady-state
via cached `next_attestation` challenge offers) and resolves with what the
server said: `requestId`, `visitorId` and, by default, `suspectScore` and
`suspectLevel`. The score is a convenience for showing a result straight away.
Each SDK key has a setting that hides it from apps, and then both fields are
`null`, exactly as on a check nobody scored: an app cannot tell which it was, so
read `null` as "no answer here", never as clean. The signals behind a score
never reach the device; read them on your backend, through the server-side event
read by `requestId` or webhooks, or in the dashboard.

When `identifiable` is `false` (v3 **Option B**), `visitorId` is `""` and
`visitorIsNew` is `false`. `visitorConfidence`, `visitorIsNew`, `identifiable`
and `duplicate` can be `null` when the server did not say, which is not the same
as `0` or `false`.

Pass `{ submit: false }` to collect without sending; it resolves with
`{ report }`, the raw report and nothing else. Pass `{ automatic: true }` for a
call your app makes on its own (on start, on a timer, on returning to the
foreground): it joins an identification already in flight instead of starting
another, and waits out a transient failure instead of repeating it. `collect()`
returns the native `SignalReport` without submitting it:

```ts
import { nativeVersion } from '@fingerly/lynx'

const report = await fingerly.collect()
const version = nativeVersion()
```

Failures are surfaced as `FingerlyError`. `status` is populated only for a
positive HTTP status returned by the native transport. When the server asked
for a pause with `Retry-After`, `retryAfterMs` carries it: wait at least that
long before identifying again. It is undefined when no wait was named.

## Consent

The SDK identifies nobody until it is told consent is `'granted'`. The usual
pattern is to load it at launch with the default `'pending'` and pass on the
answer from your consent tool when it arrives:

```ts
import { ConsentError, load } from '@fingerly/lynx'

const fingerly = await load({ apiKey: 'fly_pk_production_…' }) // consent is 'pending'

// From your consent tool's callback:
fingerly.setConsent(accepted ? 'granted' : 'denied')

fingerly.consent // 'granted', 'pending' or 'denied'
```

| Option / method | What it does |
| --- | --- |
| `consent` option on `load` | The starting state: `'pending'` (the default), `'granted'` or `'denied'`. |
| `setConsent(state)` | Records the decision. Synchronous and safe to call repeatedly. |
| `consent` | The state last given to the native SDK, read-only. |

The default is `'pending'`, so an integration that never mentions consent
identifies nobody. Pass `consent: 'granted'` to `load` only when you already
have consent, or another lawful basis. Anything other than the three states
throws a `TypeError`.

Until consent is `'granted'`, the native SDK runs no source, touches no
container storage or attestation key state, and sends nothing. `identify()` and
`collect()` reject with `ConsentError`, a subclass of `FingerlyError` with
`code: 'consent_required'` and the refusing `state`:

```ts
try {
  await fingerly.identify()
} catch (error) {
  if (error instanceof ConsentError) {
    // error.state is 'pending' or 'denied'; nothing was collected or sent
  }
}
```

Withdrawing consent also stops a call already in flight before its next source
starts and before it submits, and that call rejects with `ConsentError`.
Loading collects and sends nothing, whatever the state. The native SDK holds one
state for the whole app, and each `load` sets it to the `consent` passed (or
`'pending'`), so pass `consent` on every `load`.

Every submission the native SDK sends carries `"consent": "granted"`, and the
server refuses any other value with `422 consent_required`. The native SDK only
sends while consent is granted, so that refusal should never be seen.

## Erasure (GDPR / privacy right to erasure only)

```ts
import { deleteStoredIdentity } from '@fingerly/lynx'

await deleteStoredIdentity()
```

Deletes the local install record (`install_id`) and local hardware attestation
key state kept on the device (`Application Support/io.fingerly.sdk/` container
files with `isExcludedFromBackup = true` and App Attest key state on iOS; atomic
install record + persistent `AndroidKeyStore` v3 signing key
`io.fingerly.sdk.attest.v3` on Android). This call is **strictly for
user-initiated GDPR / privacy right-to-erasure requests or account deletion** —
never call it on routine logout, session expiry, or user switching, as repeated
`install_id` resets on the same device trigger single-key churn telemetry
(`>= 3` distinct IDs in 24 hours). It needs no `load` and no consent, sends
nothing, and resolves once no local record or key state remains, including when
there was none. It rejects with a `FingerlyError` when the delete fails. A
subsequent re-consented identification generates a fresh `install_id` and
attests a fresh key so the server mints an unlinked `visitorId`; to stop
identifying altogether, set consent to `'denied'` first.

## Why there is no JavaScript fallback

JavaScript cannot inspect the filesystem, loaded Mach-O or ELF images, debugger
flags, App Attest / Keystore hardware attestation, Android packages, or the
native TLS connection. Falling back to a partial report could mark a compromised
device as clean, so a missing Native Module is an actionable integration error.

## Native SDK dependencies (`0.3.0`)

On iOS, `pod install` downloads the matching `Fingerly.xcframework` (`0.3.0`)
from `https://maven.fingerly.io/ios/` and verifies its SHA-256 checksum, so the
Podfile needs no separate entry for the native SDK. The same binary is published
as a Swift package at [sdk-ios](https://github.com/fingerly-io/sdk-ios).

On Android, the module resolves `io.fingerly:fingerly:0.3.0` from
`https://maven.fingerly.io`, added to the host's repositories as shown above.

**Installed-app checks are opt-in on Android (`io.fingerly:fingerly-app-checks:0.3.0`).**
Core `io.fingerly:fingerly:0.3.0` declares zero `<queries>` entries in its
manifest because Google Play treats installed-app visibility as personal and
sensitive data. If your app justifies package visibility for the 17 root
managers, hooking frameworks and dual-space cloners in Play review, add
`io.fingerly:fingerly-app-checks:0.3.0` to your Android app module, register
`FingerlyBridge.setAppChecks(FingerlyAppChecks())` in your host `Application` or
`Activity`, and declare "App activity: Installed apps" in the Data safety form:

```kotlin
// the app module's build.gradle.kts
dependencies {
    implementation("io.fingerly:fingerly-app-checks:0.3.0")
}
```

```kotlin
// Android Application or Activity startup
import io.fingerly.sdk.appchecks.FingerlyAppChecks
import io.fingerly.sdk.bridge.FingerlyBridge

FingerlyBridge.setAppChecks(FingerlyAppChecks())
```

Without it, the report carries no installed-app fields and nothing about other
apps leaves the device; whether the app itself runs inside a cloner is still
reported.

**Play Integrity (Android, optional — `io.fingerly:fingerly-play-integrity:0.3.0`).**
To add Google Play Integrity Standard tokens bound to the `v: 3`
`statementDigest` (ADR 0026), add `io.fingerly:fingerly-play-integrity:0.3.0` to
your Android app module, register
`FingerlyBridge.setPlayIntegrity(FingerlyPlayIntegrity())` in your Android host,
and pass your Google Cloud project number (the one linked in Play Console) to
`load`:

```kotlin
// the app module's build.gradle.kts
dependencies {
    implementation("io.fingerly:fingerly-play-integrity:0.3.0")
}
```

```kotlin
// Android Application or Activity startup
import io.fingerly.sdk.bridge.FingerlyBridge
import io.fingerly.sdk.playintegrity.FingerlyPlayIntegrity

FingerlyBridge.setPlayIntegrity(FingerlyPlayIntegrity())
```

```ts
const fingerly = await load({
  apiKey: 'fly_pk_production_…',
  consent: 'granted',
  playIntegrityCloudProjectNumber: 123456789012,
})
```

Without the provider the project number is ignored and nothing fails, and on iOS
it is safely ignored.

## Development

Clone recursively so `@fingerly/types` is available:

```sh
git clone --recurse-submodules https://github.com/fingerly-io/sdk-lynx.git
pnpm install
pnpm codegen
pnpm test
pnpm lint
pnpm build
pnpm example:build
ANDROID_HOME=/path/to/android-sdk ./android/gradlew -p android assembleDebug
```

Generated bridge specifications are committed. After changing
`types/platform-native-module.d.ts`, run codegen and commit the generated
TypeScript, Java and Objective-C files together.
