<p align="center">
  <a href="https://fingerly.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-dark.svg">
      <img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/logo-light.svg" alt="Fingerly" height="44">
    </picture>
  </a>
</p>

<p align="center"><b>Fingerly for Lynx</b><br>Device intelligence and fraud signals in your Lynx app, through a thin Native Module over the Fingerly iOS and Android SDKs.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fingerly/lynx"><img src="https://img.shields.io/npm/v/@fingerly/lynx?style=flat-square" alt="npm version"></a>
  <a href="https://github.com/fingerly-io/sdk-lynx/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/fingerly-io/sdk-lynx/ci.yml?style=flat-square" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Licence: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/lynx-4.1-blue?style=flat-square" alt="Lynx 4.1">
  <a href="https://docs.fingerly.io/docs/sdks/lynx"><img src="https://img.shields.io/badge/docs-docs.fingerly.io-informational?style=flat-square" alt="Documentation"></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/fingerly-io/.github/main/assets/banner.webp" alt="Fingerly" width="100%"></p>

## What is this

`@fingerly/lynx` (`0.4.0`, `v: 3`) is the Fingerly SDK for Lynx. It is a thin Native Module over the Fingerly iOS and Android SDKs; all collection, transport and attestation stay native. You call `identify()` from Lynx background-thread scripting and get back a request ID and a visitor ID to send to your own backend, which decides what to do. [Fingerly](https://fingerly.io) is a device intelligence API that helps you protect signups, logins and payments from fraud and abuse.

Supported: Lynx 4.1 on iOS and Android. Not supported: HarmonyOS, Web, Lynxtron and per-`LynxView` registration.

## Getting started

1. **Get a key.** In the [Fingerly dashboard](https://dashboard.fingerly.io), open **Integration > SDK keys** and create a public key for your app. [How keys work](https://docs.fingerly.io/docs/api-keys).
2. **Install the package.**

   ```sh
   pnpm add @fingerly/lynx@^0.4.0
   ```

   The host app must enable [Lynx Native Library Autolink](https://lynxjs.org/guide/autolink). See [Platform setup](#platform-setup) for the Android and iOS steps.

3. **Identify.** Native Modules are available from Lynx background-thread scripting, so call the SDK from an event handler, effect, or other background function.

   ```ts
   import { ConsentState, load } from '@fingerly/lynx'

   // consent: only once you have consent (or know none is required)
   const fingerly = await load({ apiKey: 'fly_pk_production_…', consent: ConsentState.Granted })
   const result = await fingerly.identify({ tag: 'checkout' })

   // Send result.requestId to your backend and make the decision there.
   ```

## Contents

- [Platform setup](#platform-setup)
- [Identify](#identify)
- [Named values](#named-values)
- [Consent](#consent)
- [Erasure](#erasure)
- [Why there is no JavaScript fallback](#why-there-is-no-javascript-fallback)
- [Native SDK dependencies](#native-sdk-dependencies)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Development](#development)
- [Help](#help)
- [Licence](#licence)

## Platform setup

The package's `lynx.lib.json` registers the `Fingerly` Native Module. The host app must enable Lynx Native Library Autolink:

| Android | iOS |
| --- | --- |
| Apply `org.lynxsdk.library-settings` in `settings.gradle` and `org.lynxsdk.library-build` in the app module, then sync and rebuild. | Install `cocoapods-lynx-library`, add `plugin 'cocoapods-lynx-library'` and `use_lynx_library!` to the Podfile, run `pod install`, then rebuild. |

The Android module depends on `io.fingerly:fingerly:0.4.0` from Fingerly's Maven repository (`mavenLocal()` is also configured, for local artifact staging). Android hosts add Fingerly's repository to the repositories in `settings.gradle`:

```groovy
maven { url 'https://maven.fingerly.io' }
```

## Identify

`load` reports `lynx-ios` or `lynx-android` (`SdkPlatform.LynxIos`, `SdkPlatform.LynxAndroid`), so the server selects the correct native risk profile and applies the right mobile checks. On any other platform it throws a `FingerlyError`. For production Android keys, configure `AllowedAndroidSigners` (64-hex SHA-256 signing certificate digests) alongside `AllowedAndroidPackages` in the dashboard.

`identify()` submits a single-pass `v: 3` identification (`1-RTT` steady state through cached `next_attestation` challenge offers) and resolves with what the server said: `requestId`, `visitorId` and, by default, `suspectScore` and `suspectLevel`.

- When `identifiable` is `false` (`v: 3` Option B), `visitorId` is `""` and `visitorIsNew` is `false`.
- The score is a convenience for showing a result straight away. Each SDK key has a setting that hides it from apps, and then both fields are `null`, exactly as on a check nobody scored. An app cannot tell which it was, so read `null` as "no answer here", never as clean.
- The signals behind a score never reach the device. Read them on your backend, through the server-side event read by `requestId` or webhooks, or in the dashboard.
- `visitorConfidence`, `visitorIsNew`, `identifiable` and `duplicate` can be `null` when the server did not say, which is not the same as `0` or `false`.

| Option | What it does |
| --- | --- |
| `tag` | A string echoed back on the finished event, for your own correlation. |
| `submit: false` | Collect without sending. It resolves with `{ report }`, the raw report and nothing else. |
| `automatic: true` | For a call your app makes on its own (on start, on a timer, on returning to the foreground): it joins an identification already in flight instead of starting another, and waits out a transient failure instead of repeating it. |

`collect()` returns the native `SignalReport` without submitting it.

```ts
import { nativeVersion } from '@fingerly/lynx'

const report = await fingerly.collect()
const version = nativeVersion()
```

`nativeVersion()` returns the version of the native SDK that did the collecting.

Failures are surfaced as `FingerlyError`. `status` is populated only for a positive HTTP status returned by the native transport. When the server asked for a pause with `Retry-After`, `retryAfterMs` carries it: wait at least that long before identifying again. It is undefined when no wait was named.

## Named values

The fixed strings the API returns and the module accepts have names, the same objects `@fingerly/web-js` exports. Each is an `as const` object with a same-named type, and a member is its value in PascalCase, word by word (`SuspectLevel.High` is `'high'`, `Signal.FingerprintSuppressed` is `'fingerprint_suppressed'`):

```ts
import { EventState, SuspectLevel } from '@fingerly/lynx'

const result = await fingerly.identify({ tag: 'checkout' })

if (result.state === EventState.Unavailable) {
  // The network lookup could not run, so the check was not scored.
}
if (result.suspectLevel === SuspectLevel.High) {
  // Show a step-up screen while your backend makes the decision.
}
```

| Constant | Members | Where it appears |
| --- | --- | --- |
| `SuspectLevel` | `Low`, `Medium`, `High` | `suspectLevel` on the `identify()` answer. |
| `EventState` | `Enriched`, `Unavailable`, `Pending` | `state` on the `identify()` answer. An answer is never `Pending`, which only a server-side event read reports. |
| `ConsentState` | `Granted`, `Pending`, `Denied` | The `consent` option on `load`, `setConsent`, `consent` and `ConsentError.state`. |
| `SdkPlatform` | `LynxIos`, `LynxAndroid`, and the other SDKs' platforms | What the module reports itself as, and the SDK named on the event your backend reads. |
| `Signal` | Every signal group and detector the server reports, such as `Signal.Jailbreak` and `Signal.VpnPublic` | Triggers on the event your backend reads and in webhooks. The signals never reach the device. |
| `Confidence` | `Low`, `Medium`, `High` | A trigger's `confidence` on the event your backend reads. |

Comparing with the plain string compiles as well. The module hands on the server's values as they came, so a value a newer server adds reaches the app unchanged rather than being dropped.

## Consent

The SDK identifies nobody until it is told consent is `'granted'`. The usual pattern is to load it at launch with the default `'pending'` and pass on the answer from your consent tool when it arrives:

```ts
import { ConsentError, ConsentState, load } from '@fingerly/lynx'

const fingerly = await load({ apiKey: 'fly_pk_production_…' }) // consent is 'pending'

// From your consent tool's callback:
fingerly.setConsent(accepted ? ConsentState.Granted : ConsentState.Denied)

fingerly.consent // ConsentState.Granted, ConsentState.Pending or ConsentState.Denied
```

| Option / method | What it does |
| --- | --- |
| `consent` option on `load` | The starting state: `'pending'` (the default), `'granted'` or `'denied'`. |
| `setConsent(state)` | Records the decision. Synchronous and safe to call repeatedly. |
| `consent` | The state last given to the native SDK, read-only. |

The default is `'pending'`, so an integration that never mentions consent identifies nobody. Pass `consent: ConsentState.Granted` to `load` only once collection is permitted for this user: they consented, or the applicable law does not require consent. A GDPR lawful basis such as legitimate interest is not enough on its own. Anything other than the three states throws a `TypeError`.

Until consent is `'granted'`, the native SDK runs no source, touches no container storage or attestation key state, and sends nothing. `identify()` and `collect()` reject with `ConsentError`, a subclass of `FingerlyError` with `code: 'consent_required'` and the refusing `state`:

```ts
try {
  await fingerly.identify()
} catch (error) {
  if (error instanceof ConsentError) {
    // error.state is ConsentState.Pending or ConsentState.Denied; nothing was collected or sent
  }
}
```

Withdrawing consent also stops a call already in flight before its next source starts and before it submits, and that call rejects with `ConsentError`. Loading collects and sends nothing, whatever the state. The native SDK holds one state for the whole app, and each `load` sets it to the `consent` passed (or `'pending'`), so pass `consent` on every `load`.

Every submission the native SDK sends carries `"consent": "granted"`, and the server refuses any other value with `422 consent_required`. The native SDK only sends while consent is granted, so that refusal should never be seen.

## Erasure

```ts
import { deleteStoredIdentity } from '@fingerly/lynx'

await deleteStoredIdentity()
```

This call is **strictly for user-initiated GDPR or privacy right-to-erasure requests, or account deletion**. Never call it on routine logout, session expiry or user switching: repeated `install_id` resets on the same device trigger single-key churn telemetry (`>= 3` distinct IDs in 24 hours).

It deletes the local install record (`install_id`) and the local hardware attestation key state kept on the device:

- On iOS, the `Application Support/io.fingerly.sdk/` container files, kept with `isExcludedFromBackup = true`, and the App Attest key state.
- On Android, atomically, the install record and the persistent `AndroidKeyStore` v3 signing key `io.fingerly.sdk.attest.v3`.

It needs no `load` and no consent, sends nothing, and resolves once no local record or key state remains, including when there was none. It rejects with a `FingerlyError` when the delete fails. A later re-consented identification generates a fresh `install_id` and attests a fresh key, so the server mints an unlinked `visitorId`; to stop identifying altogether, set consent to `'denied'` first.

## Why there is no JavaScript fallback

JavaScript cannot inspect the filesystem, loaded Mach-O or ELF images, debugger flags, App Attest or Keystore hardware attestation, Android packages, or the native TLS connection. Falling back to a partial report could mark a compromised device as clean, so a missing Native Module is an actionable integration error.

## Native SDK dependencies

Both native dependencies are at `0.4.0`.

<details>
<summary><b>iOS</b></summary>

`pod install` downloads the matching `Fingerly.xcframework` (`0.4.0`) from `https://maven.fingerly.io/ios/` and verifies its SHA-256 checksum, so the Podfile needs no separate entry for the native SDK. The same binary is published as a Swift package at [sdk-ios](https://github.com/fingerly-io/sdk-ios).

The Play Integrity project number passed to `load` is ignored on iOS.

</details>

<details>
<summary><b>Android</b></summary>

The module resolves `io.fingerly:fingerly:0.4.0` from `https://maven.fingerly.io`, added to the host's repositories as shown in [Platform setup](#platform-setup).

**Installed-app checks are opt-in (`io.fingerly:fingerly-app-checks:0.4.0`).** Core `io.fingerly:fingerly:0.4.0` declares zero `<queries>` entries in its manifest, because Google Play treats installed-app visibility as personal and sensitive data. If your app can justify package visibility for the 17 root managers, hooking frameworks and dual-space cloners in its Play review, add `io.fingerly:fingerly-app-checks:0.4.0` to your app's Android module and declare "App activity: Installed apps" in the Data safety form. The module finds the artifact and registers its provider on every `load`, so there is no native code to write:

```kotlin
// the app module's build.gradle.kts
dependencies {
    implementation("io.fingerly:fingerly-app-checks:0.4.0")
}
```

Without it, the report carries no installed-app fields and nothing about other apps leaves the device; whether the app itself runs inside a cloner is still reported.

**Play Integrity (optional, `io.fingerly:fingerly-play-integrity:0.4.0`).** To add Google Play Integrity Standard tokens bound to the `v: 3` `statementDigest`, add the artifact to your app's Android module and pass your Google Cloud project number, the one linked to the app in Play Console, to `load`. The module finds the artifact and registers its provider with that project number:

```kotlin
// the app module's build.gradle.kts
dependencies {
    implementation("io.fingerly:fingerly-play-integrity:0.4.0")
}
```

```ts
const fingerly = await load({
  apiKey: 'fly_pk_production_…',
  consent: ConsentState.Granted,
  playIntegrityCloudProjectNumber: 123456789012,
})
```

A provider of your own, registered from native code with `FingerlyBridge.setPlayIntegrity(provider)` before `load`, is used in place of the artifact's.

A project number with neither is a configuration error: the module keeps the previous configuration, and every `identify` and `collect` rejects with a `FingerlyError` ("playIntegrityCloudProjectNumber was set but the io.fingerly:fingerly-play-integrity artifact is not on the classpath", native code `play_integrity_unavailable`) until a `load` without that mismatch replaces it. Without a project number, Play Integrity is off and nothing fails.

The rest of the setup, the service account uploaded to your Fingerly project and the daily budget, is covered by the Android SDK's [install notes](https://github.com/fingerly-io/sdk-android/blob/main/INSTALL.md#optional-play-integrity).

</details>

## Requirements

| | Minimum |
| --- | --- |
| Lynx | 4.1 |
| iOS | 13.0 |
| Android | 6.0 (API 23) |

## Documentation

Guides and the API reference: <https://docs.fingerly.io/docs/sdks/lynx>.

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

Generated bridge specifications are committed. After changing `types/platform-native-module.d.ts`, run codegen and commit the generated TypeScript, Java and Objective-C files together.

## Help

Open an issue on this repository, or write to <support@fingerly.io>. Security issues: <security@fingerly.io>.

## Licence

This bridge is licensed under [Apache-2.0](LICENSE). The native SDKs it depends on are closed binaries under the Fingerly SDK License.
