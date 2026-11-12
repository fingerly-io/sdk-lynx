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

`@fingerly/lynx` is the Fingerly SDK for Lynx. It is a thin Native Module over the Fingerly iOS and Android SDKs; all collection, transport and scoring stays native. You call `identify()` from Lynx background-thread scripting and get back a request ID and a visitor ID to send to your own backend, which decides what to do. [Fingerly](https://fingerly.io) is a device intelligence API that helps you protect signups, logins and payments from fraud and abuse.

Supported: Lynx 4.1 on iOS and Android. Not supported: HarmonyOS, Web, Lynxtron and per-`LynxView` registration.

## Getting started

1. **Get a key.** In the [Fingerly dashboard](https://dashboard.fingerly.io), open **Integration > SDK keys** and create a public key for your app. [How keys work](https://docs.fingerly.io/docs/api-keys).
2. **Install the package.**

   ```sh
   pnpm add @fingerly/lynx
   ```

   The host app must enable [Lynx Native Library Autolink](https://lynxjs.org/guide/autolink). See [Platform setup](#platform-setup) for the Android and iOS steps.

3. **Identify.** Native Modules are available from Lynx background-thread scripting, so call the SDK from an event handler, effect, or other background function.

   ```ts
   import { load } from '@fingerly/lynx'

   // consent: only once you have consent (or another lawful basis)
   const fingerly = await load({ apiKey: 'fly_pk_production_…', consent: 'granted' })
   const result = await fingerly.identify({ tag: 'checkout' })

   // Send result.requestId to your backend and make the decision there.
   ```

## Contents

- [Platform setup](#platform-setup)
- [Identify](#identify)
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

The Android module depends on `io.fingerly:fingerly:0.2.0` from Fingerly's Maven repository and declares no repositories of its own, so Android hosts add it to the repositories in `settings.gradle`:

```groovy
maven { url 'https://maven.fingerly.io' }
```

## Identify

`load` reports `lynx-ios` or `lynx-android`, so the server applies the right mobile checks. On any other platform it throws a `FingerlyError`.

`identify()` defaults to submission and resolves with what the server said: `requestId`, `visitorId` and, by default, `suspectScore` and `suspectLevel`.

- The score is a convenience for showing a result straight away. Each SDK key has a setting that hides it from apps, and then both fields are `null`, exactly as on a check nobody scored. An app cannot tell which it was, so read `null` as "no answer here", never as clean.
- The signals behind a score never reach the device. Read them on your backend, through the server-side event read by `requestId` or webhooks, or in the dashboard.
- `visitorConfidence`, `visitorIsNew`, `identifiable` and `duplicate` can be `null` when the server did not say, which is not the same as `0` or `false`.

| Option | What it does |
| --- | --- |
| `tag` | A string echoed back on the finished event, for your own correlation. |
| `submit: false` | Collect without sending. It resolves with `{ report }`, the raw report and nothing else. |
| `automatic: true` | For a call your app makes on its own (on start, on a timer, on returning to the foreground): it joins an identification already in flight instead of starting another, and waits out a transient failure instead of repeating it. On Android the module accepts the option and ignores it. |

`collect()` returns the native signal report without submitting it.

```ts
const report = await fingerly.collect()
const version = nativeVersion()
```

`nativeVersion()` returns the version of the native SDK that did the collecting.

Failures are surfaced as `FingerlyError`. `status` is populated only for a positive HTTP status returned by the native transport. When the server asked for a pause with `Retry-After`, `retryAfterMs` carries it: wait at least that long before identifying again. It is undefined when no wait was named.

## Consent

The SDK identifies nobody until it is told consent is `'granted'`. The usual pattern is to load it at launch with the default `'pending'` and pass on the answer from your consent tool when it arrives:

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

The default is `'pending'`, so an integration that never mentions consent identifies nobody. Pass `consent: 'granted'` to `load` only when you already have consent, or another lawful basis. Anything other than the three states throws a `TypeError`.

Until consent is `'granted'`, the native SDK runs no source, touches no storage for fingerprinting and sends nothing. `identify()` and `collect()` reject with `ConsentError`, a subclass of `FingerlyError` with `code: 'consent_required'` and the refusing `state`:

```ts
try {
  await fingerly.identify()
} catch (error) {
  if (error instanceof ConsentError) {
    // error.state is 'pending' or 'denied'; nothing was collected or sent
  }
}
```

Withdrawing consent also stops a call already in flight before its next source starts and before it submits, and that call rejects with `ConsentError`. Loading collects and sends nothing, whatever the state. The native SDK holds one state for the whole app, and each `load` sets it to the `consent` passed (or `'pending'`), so pass `consent` on every `load`.

Every submission the native SDK sends carries the state it was collected under, `"consent": "granted"`, and the server refuses any other value with `422 consent_required`. The native SDK only sends while consent is granted, so that refusal should never be seen.

## Erasure

```ts
import { deleteStoredIdentity } from '@fingerly/lynx'

await deleteStoredIdentity()
```

Deletes the install record the native SDK keeps on the device, including the install ID the server recognises it by. Call it when a user asks for their data to be erased or deletes their account. It needs no `load` and no consent, sends nothing, and resolves once no record remains, including when there was none. It rejects with a `FingerlyError` when the delete fails. The next identification made with consent starts a new record; to stop identifying as well, set consent to `'denied'` first.

## Why there is no JavaScript fallback

JavaScript cannot reach most of what the native SDKs collect. Falling back to a partial report could mark a compromised device as clean, so a missing Native Module is an actionable integration error.

## Native SDK dependencies

<details>
<summary><b>iOS</b></summary>

`pod install` downloads the matching `Fingerly.xcframework` from `https://maven.fingerly.io/ios/` and verifies its checksum, so the Podfile needs no entry for the native SDK. The same binary is published as a Swift package at [sdk-ios](https://github.com/fingerly-io/sdk-ios).

The Play Integrity project number passed to `load` is ignored on iOS.

</details>

<details>
<summary><b>Android</b></summary>

The module resolves `io.fingerly:fingerly` from `https://maven.fingerly.io`, added to the host's repositories as shown in [Platform setup](#platform-setup).

**Installed-app checks are opt-in.** The checks for root managers, hooking frameworks and app cloners by package name ship in a separate artifact, `io.fingerly:fingerly-app-checks`, because Google Play treats the list of installed apps as personal and sensitive data. This bridge depends on `io.fingerly:fingerly` only. If your app can justify the package visibility in its Play review and wants these checks, add the artifact to your app's Android module, at the same version as `io.fingerly:fingerly`, and declare "App activity: Installed apps" in the Data safety form:

```kotlin
dependencies {
    implementation("io.fingerly:fingerly-app-checks:<same version as io.fingerly:fingerly>")
}
```

Without it, the report carries no installed-app fields and nothing about other apps leaves the device; whether the app itself runs inside a cloner is still reported.

**Play Integrity (optional).** The Android SDK has an optional artifact, `io.fingerly:fingerly-play-integrity`, that adds Google Play Integrity verdicts to events. To use it, add the artifact to the app and pass your Google Cloud project number, the one linked to the app in Play Console, to `load`:

```kotlin
// the app module's build.gradle.kts
dependencies {
    implementation("io.fingerly:fingerly-play-integrity:<same version as io.fingerly:fingerly>")
}
```

```ts
const fingerly = await load({
  apiKey: 'fly_pk_production_…',
  playIntegrityCloudProjectNumber: 123456789012,
})
```

The native SDK finds the artifact on its own; this bridge does not depend on it. Without the artifact the number is ignored and nothing fails. The rest of the setup, the service account uploaded to your Fingerly project and the daily budget, is covered by the Android SDK's [install notes](https://github.com/fingerly-io/sdk-android/blob/main/INSTALL.md#optional-play-integrity). Gradle refuses to pair the artifact with a core of another version.

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

This bridge is licensed under [Apache-2.0](LICENSE). The native SDK it depends on is a closed binary under the Fingerly SDK License.
