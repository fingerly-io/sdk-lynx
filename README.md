# @fingerly/lynx

The Fingerly SDK for Lynx. It is a thin Native Module over the Fingerly iOS and
Android SDKs; all collection, transport and scoring stays native.

Lynx 4.1 and iOS/Android are supported in this first release. HarmonyOS, Web,
Lynxtron and per-`LynxView` registration are not supported.

## Install

```sh
pnpm add @fingerly/lynx
```

The host app must enable [Lynx Native Library Autolink](https://lynxjs.org/guide/autolink):

- Android: apply `org.lynxsdk.library-settings` in `settings.gradle` and
  `org.lynxsdk.library-build` in the app module, then sync and rebuild.
- iOS: install `cocoapods-lynx-library`, add
  `plugin 'cocoapods-lynx-library'` and `use_lynx_library!` to the Podfile, run
  `pod install`, then rebuild.

The Android module depends on `io.fingerly:fingerly:0.1.0` from Fingerly's Maven
repository and declares no repositories of its own, so Android hosts add it to
the repositories in `settings.gradle`:

```groovy
maven { url 'https://maven.fingerly.io' }
```

That repository is not live yet; see
[Native SDK development dependencies](#native-sdk-development-dependencies) for
the local route until it is.

This bridge is licensed under Apache-2.0. The native SDK it depends on is a
closed binary under the Fingerly SDK License.

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
correct native risk profile. `identify()` defaults to submission and resolves
with what the server said: `requestId`, `visitorId`, `suspectScore`,
`suspectLevel` and `triggers`. `visitorConfidence`, `visitorIsNew`,
`identifiable` and `duplicate` can be `null` when the server did not say, which
is not the same as `0` or `false`. Pass `{ submit: false }` to collect without
sending; it resolves with `{ report }`, the raw report and nothing else. Pass `{ automatic: true }` for
a call your app makes on its own (on start, on a timer, on returning to the
foreground): it joins an identification already in flight instead of starting
another, and waits out a transient failure instead of repeating it. On Android
it has no effect until the native Android SDK supports it. `collect()` returns
the native signal report without submitting it.

```ts
const report = await fingerly.collect()
const version = nativeVersion()
```

Failures are surfaced as `FingerlyError`. `status` is populated only for a
positive HTTP status returned by the native transport. When the server asked
for a pause with `Retry-After`, `retryAfterMs` carries it: wait at least that
long before identifying again. It is undefined when no wait was named, and on
Android until the native Android bridge passes the header on.

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

Until consent is `'granted'`, the native SDK runs no source, touches no storage
for fingerprinting and sends nothing. `identify()` and `collect()` reject with
`ConsentError`, a subclass of `FingerlyError` with `code: 'consent_required'`
and the refusing `state`:

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

Every submission the native SDK sends carries the state it was collected under,
`"consent": "granted"`, and the server refuses any other value with
`422 consent_required`. The native SDK only sends while consent is granted, so
that refusal should never be seen.

## Erasure

```ts
import { deleteStoredIdentity } from '@fingerly/lynx'

await deleteStoredIdentity()
```

Deletes the install record the native SDK keeps on the device, including the
install ID the server recognises it by. Call it when a user asks for their data
to be erased or deletes their account. It needs no `load` and no consent,
sends nothing, and resolves once no record remains, including when there was
none. It rejects with a `FingerlyError` when the delete fails. The next
identification made with consent starts a new record; to stop identifying as
well, set consent to `'denied'` first.

## Why there is no JavaScript fallback

JavaScript cannot inspect the filesystem, loaded images, debugger flags,
DeviceCheck, Android packages, or the native TLS connection. Falling back to a
partial report could mark a compromised device as clean, so a missing Native
Module is an actionable integration error.

## Native SDK development dependencies

The native SDKs are not published yet. For Android, until
`https://maven.fingerly.io` is live and for contributors at any time, publish
the sibling [Android SDK](https://github.com/fingerly-io/sdk-android) to Maven
Local, and add `mavenLocal()` after that repository in the host:

```sh
./gradlew :fingerly:publishToMavenLocal
```

For iOS development, point the host Podfile at the sibling
[iOS SDK](https://github.com/fingerly-io/sdk-ios) checkout before resolving
`fingerly-lynx`.

## Development

Clone recursively so `@fingerly/types` is available:

```sh
git clone --recurse-submodules git@github.com:fingerly-io/sdk-lynx.git
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
