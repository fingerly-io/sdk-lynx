'background only'

import { requireFingerly } from '../generated/Fingerly'

import type {
  MobileFingerlyOptions,
  MobileIdentifyOptions,
  MobileVerdicts,
  NativeIdentifyResult,
  SdkPlatform,
  SignalReport,
  Verdict,
} from '@fingerly/types'

declare const SystemInfo: { platform?: string } | undefined

interface FingerlyNativeModule {
  configure(apiKey: string, endpoint: string, platform: string, consent: ConsentState): void
  setConsent(state: ConsentState): void
  identify(
    tag: string | null,
    submit: boolean,
    success: (json: string) => void,
    failure: (error: string) => void,
  ): void
  collect(success: (json: string) => void, failure: (error: string) => void): void
  /** Optional because a native module built before it existed does not have it. */
  deleteStoredIdentity?(success: () => void, failure: (error: string) => void): void
  sdkVersion(): string
}

/**
 * Whether the user has agreed to be identified. Spelled as in `@fingerly/core`
 * and the native SDKs; declared here so this package builds against any copy of
 * `@fingerly/types`, including one that predates consent.
 */
export type ConsentState = 'granted' | 'pending' | 'denied'

export interface FingerlyOptions extends MobileFingerlyOptions {
  /**
   * The consent to start from, `pending` when omitted. Call `setConsent` once
   * your consent tool has an answer. Until consent is `granted`, `identify()`
   * and `collect()` reject with a `ConsentError` and the native SDK runs no
   * source and sends nothing. Pass `granted` only once the user has agreed, or
   * where another lawful basis applies.
   */
  consent?: ConsentState
}

export type IdentifyOptions = MobileIdentifyOptions

export class FingerlyError extends Error {
  // Widened to `string` so a subclass can name itself.
  override readonly name: string = 'FingerlyError'

  constructor(
    message: string,
    readonly status?: number,
    /**
     * How long the server asked the app to wait, in milliseconds, from its
     * `Retry-After`, when the native SDK gave up on a 429 or 503 that named
     * one. Undefined when no wait was named, and on Android until the native
     * Android bridge passes the header on.
     */
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/**
 * A call refused because consent is not `granted`: nothing was collected or
 * sent. `code` is the string every Fingerly SDK uses for this failure. Also a
 * `FingerlyError`, so existing handlers keep catching everything this package
 * throws.
 */
export class ConsentError extends FingerlyError {
  override readonly name: string = 'ConsentError'
  readonly code = 'consent_required'

  constructor(readonly state: ConsentState) {
    super(`Fingerly needs consent before it can identify this visitor (consent is ${state})`)
  }
}

const CONSENT_REQUIRED = 'consent_required'

const CONSENT_STATES: readonly ConsentState[] = ['granted', 'pending', 'denied']

function isConsentState(value: unknown): value is ConsentState {
  return CONSENT_STATES.includes(value as ConsentState)
}

/**
 * Loud rather than lenient, as the browser SDK is: a consent tool's `true` or
 * `'accepted'` is a wiring mistake to report, not a state to guess at.
 */
function assertConsentState(state: unknown): asserts state is ConsentState {
  if (!isConsentState(state)) {
    throw new TypeError(
      `Fingerly consent must be 'granted', 'pending' or 'denied' (received ${JSON.stringify(state)})`,
    )
  }
}

/**
 * The state behind a native `consent_required` failure. iOS sends it as
 * `state`; Android sends only the message, which ends with it in a fixed form.
 * Unreadable is `pending`, as the native SDKs read an unknown state.
 */
function refusedConsent(record: Record<string, unknown> | undefined, message: string): ConsentState {
  const fromNative = record?.state
  if (isConsentState(fromNative)) return fromNative
  const fromMessage = /\(consent is (\w+)\)/.exec(message)?.[1]
  return isConsentState(fromMessage) ? fromMessage : 'pending'
}

/**
 * The consent last handed to the native SDK. Module state because the native
 * bridge keeps one client per process, shared by every `FingerlyClient` here.
 */
let currentConsent: ConsentState = 'pending'

const MISSING_NATIVE_MODULE =
  '@fingerly/lynx could not find its Fingerly native module. Enable Lynx Native ' +
  'Library Autolink, run `pod install` for iOS or sync Gradle for Android, ' +
  'then rebuild the native app. This SDK cannot safely collect a partial ' +
  'fingerprint from JavaScript because that could report a compromised device as clean.'

function optionalNativeModule(): FingerlyNativeModule | undefined {
  try {
    return requireFingerly() as FingerlyNativeModule
  } catch {
    return undefined
  }
}

function nativeModule(): FingerlyNativeModule {
  const native = optionalNativeModule()
  if (!native) throw new FingerlyError(MISSING_NATIVE_MODULE)
  return native
}

function platformName(): SdkPlatform {
  const platform = typeof SystemInfo === 'undefined' ? undefined : SystemInfo?.platform
  if (platform === 'Android') return 'lynx-android'
  if (platform === 'iOS') return 'lynx-ios'
  throw new FingerlyError(
    `@fingerly/lynx supports iOS and Android only; received ${platform ?? 'an unknown platform'}.`,
  )
}

function parseNativeError(raw: unknown): FingerlyError {
  if (raw instanceof FingerlyError) return raw

  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return new FingerlyError(raw)
    }
  }

  const record =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined
  const message =
    typeof record?.message === 'string'
      ? record.message
      : value instanceof Error
        ? value.message
        : String(value)

  if (record?.code === CONSENT_REQUIRED) return new ConsentError(refusedConsent(record, message))

  const parsed =
    typeof record?.code === 'number'
      ? record.code
      : typeof record?.code === 'string' && record.code.trim() !== ''
        ? Number(record.code)
        : undefined
  const status =
    typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined

  const wait = record?.retryAfterMs
  const retryAfterMs =
    typeof wait === 'number' && Number.isFinite(wait) && wait >= 0 ? wait : undefined

  return new FingerlyError(message, status, retryAfterMs)
}

function invokeNative(
  operation: (success: (json: string) => void, failure: (error: string) => void) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      operation(resolve, (error) => reject(parseNativeError(error)))
    } catch (error) {
      reject(parseNativeError(error))
    }
  })
}

/**
 * The native JSON as an object, or a `FingerlyError`.
 *
 * A `SyntaxError`, or a `TypeError` from spreading `null`, would escape a
 * handler that checks `instanceof FingerlyError`, which is the one every
 * caller writes.
 */
function parseNative(raw: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new FingerlyError('The SDK produced an unreadable report')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new FingerlyError('The SDK produced an unreadable report')
  }
  return parsed as Record<string, unknown>
}

const UNKNOWN_VERDICT: Verdict = { value: false, confidence: 'low', reasons: [] }

function normalizeVerdicts(raw: Partial<MobileVerdicts> | undefined): MobileVerdicts {
  return {
    instrumentation: raw?.instrumentation ?? UNKNOWN_VERDICT,
    mitm: raw?.mitm ?? UNKNOWN_VERDICT,
    automation: raw?.automation ?? UNKNOWN_VERDICT,
    tampering: raw?.tampering ?? UNKNOWN_VERDICT,
    farm: raw?.farm ?? UNKNOWN_VERDICT,
    jailbreak: raw?.jailbreak ?? UNKNOWN_VERDICT,
    simulator: raw?.simulator ?? UNKNOWN_VERDICT,
    root: raw?.root ?? UNKNOWN_VERDICT,
    emulator: raw?.emulator ?? UNKNOWN_VERDICT,
    appCloner: raw?.appCloner ?? UNKNOWN_VERDICT,
  }
}

export class FingerlyClient {
  /** The consent last given to the native SDK, by `load` or `setConsent`. */
  get consent(): ConsentState {
    return currentConsent
  }

  /**
   * Record the user's answer. Synchronous and safe to repeat; applies to the
   * next call and to any call in flight, which then rejects with a
   * `ConsentError` instead of submitting. Throws a `TypeError` for anything
   * that is not one of the three states.
   */
  setConsent(state: ConsentState): void {
    assertConsentState(state)
    const native = nativeModule()
    try {
      native.setConsent(state)
    } catch (error) {
      throw parseNativeError(error)
    }
    currentConsent = state
  }

  /** Rejects with a `ConsentError` while consent is not `granted`. */
  async identify(options: IdentifyOptions = {}): Promise<NativeIdentifyResult> {
    const native = nativeModule()
    const raw = await invokeNative((success, failure) =>
      native.identify(options.tag ?? null, options.submit !== false, success, failure),
    )
    const parsed = parseNative(raw) as unknown as NativeIdentifyResult
    return { ...parsed, verdicts: normalizeVerdicts(parsed.verdicts) }
  }

  /** Submits nothing, but still needs consent: rejects with a `ConsentError` without it. */
  async collect(): Promise<SignalReport> {
    const native = nativeModule()
    const raw = await invokeNative((success, failure) => native.collect(success, failure))
    return parseNative(raw) as unknown as SignalReport
  }
}

/**
 * Loading collects and sends nothing, whatever the consent. The consent passed
 * here, or `pending` when there is none, replaces what the native SDK held.
 */
export async function load(options: FingerlyOptions): Promise<FingerlyClient> {
  const consent = options.consent ?? 'pending'
  assertConsentState(consent)

  const native = nativeModule()
  try {
    native.configure(options.apiKey, options.endpoint ?? '', platformName(), consent)
  } catch (error) {
    throw parseNativeError(error)
  }
  currentConsent = consent
  return new FingerlyClient()
}

/**
 * Delete the install record the native SDK keeps on the device, for a user's
 * erasure request or account deletion. Needs no `load` and no consent, and
 * sends nothing; resolves once no record remains, including when there was
 * none. The next consented identification starts a new record, so set consent
 * to `'denied'` first to stop identifying as well. Rejects with a
 * `FingerlyError` when the delete fails or the native SDK predates this call.
 */
export async function deleteStoredIdentity(): Promise<void> {
  const native = nativeModule()
  const remove = native.deleteStoredIdentity
  if (typeof remove !== 'function') {
    throw new FingerlyError('deleteStoredIdentity is not available in the native Fingerly SDK')
  }

  await new Promise<void>((resolve, reject) => {
    try {
      remove.call(native, () => resolve(), (error) => reject(parseNativeError(error)))
    } catch (error) {
      reject(parseNativeError(error))
    }
  })
}

export function nativeVersion(): string | undefined {
  try {
    return optionalNativeModule()?.sdkVersion()
  } catch {
    return undefined
  }
}

export type {
  AndroidVerdicts,
  Confidence,
  IdentifyTrigger,
  IntegrityReport,
  IosVerdicts,
  Lie,
  MobileVerdicts,
  NativeIdentifyResult,
  NativeVerdicts,
  SdkPlatform,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  Verdict,
} from '@fingerly/types'
