'background only'

import { requireFingerly } from '../generated/Fingerly'

import { ConsentState, SdkPlatform } from '@fingerly/types'
import type {
  MobileFingerlyOptions,
  MobileIdentifyOptions,
  NativeIdentifyResult,
  SignalReport,
} from '@fingerly/types'

declare const SystemInfo: { platform?: string } | undefined

interface FingerlyNativeModule {
  configure(
    apiKey: string,
    endpoint: string,
    platform: string,
    consent: ConsentState,
    playIntegrityCloudProjectNumber: number,
  ): void
  setConsent(state: ConsentState): void
  identify(
    tag: string | null,
    submit: boolean,
    automatic: boolean,
    success: (json: string) => void,
    failure: (error: string) => void,
  ): void
  collect(success: (json: string) => void, failure: (error: string) => void): void
  /** Optional because a native module built before it existed does not have it. */
  deleteStoredIdentity?(success: () => void, failure: (error: string) => void): void
  sdkVersion(): string
}

export interface FingerlyOptions extends MobileFingerlyOptions {
  /**
   * The consent to start from, `pending` when omitted. Call `setConsent` once
   * your consent tool has an answer. Until consent is `granted`, `identify()`
   * and `collect()` reject with a `ConsentError` and the native SDK runs no
   * source and sends nothing. Pass `granted` only once collection is permitted
   * for this user: they consented, or the law that applies to them does not
   * require consent. A GDPR lawful basis such as legitimate interest is not
   * enough on its own.
   */
  consent?: ConsentState
  /**
   * Android only: your Google Cloud project number, the one linked to the app
   * in Play Console, to add Play Integrity Standard verdicts to v3 events
   * (server ADR 0026). Used when the app also configures the optional
   * `io.fingerly:fingerly-play-integrity` provider; without it the number is
   * ignored and nothing fails. Ignored on iOS. Omit it to leave Play Integrity
   * off.
   */
  playIntegrityCloudProjectNumber?: number
}

export interface IdentifyOptions extends MobileIdentifyOptions {
  /**
   * True for a call the app makes on its own rather than in answer to the
   * user: on start, on a timer, on returning to the foreground. It joins an
   * identification already in flight instead of starting another, and waits
   * out a transient failure instead of repeating it at once. False when
   * omitted.
   */
  automatic?: boolean
}

/**
 * What `identify({ submit: false })` resolves with. Nothing was sent, so nobody
 * answered, and the raw report is all there is.
 */
export interface RawReportResult {
  report: SignalReport
}

export class FingerlyError extends Error {
  // Widened to `string` so a subclass can name itself.
  override readonly name: string = 'FingerlyError'

  constructor(
    message: string,
    readonly status?: number,
    /**
     * How long the server asked the app to wait, in milliseconds, from its
     * `Retry-After`, when the native SDK gave up on a 429 or 503 that named
     * one. Undefined when no wait was named.
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

const CONSENT_STATES: readonly ConsentState[] = Object.values(ConsentState)

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
 * A Google Cloud project number is a positive whole number. Anything else is a
 * typo the app should hear about at `load`, not a Play Integrity setup that
 * silently does nothing.
 */
function assertCloudProjectNumber(value: unknown): asserts value is number | undefined {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(
      `Fingerly playIntegrityCloudProjectNumber must be a positive whole number (received ${JSON.stringify(value)})`,
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
  return isConsentState(fromMessage) ? fromMessage : ConsentState.Pending
}

/**
 * The consent last handed to the native SDK. Module state because the native
 * bridge keeps one client per process, shared by every `FingerlyClient` here.
 */
let currentConsent: ConsentState = ConsentState.Pending

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
  if (platform === 'Android') return SdkPlatform.LynxAndroid
  if (platform === 'iOS') return SdkPlatform.LynxIos
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Named rather than spread, so what reaches the app is what the server said and
// nothing else: a signal name, a conclusion or an unscored reason in the native
// JSON is left behind here.
const SERVER_FIELDS = [
  'requestId',
  'visitorId',
  'visitorIsNew',
  'visitorConfidence',
  'identifiable',
  'duplicate',
  'state',
  'suspectScore',
  'suspectLevel',
  'report',
] as const

function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const field of fields) {
    // An explicit null survives: an unscored check is null, not absent and not 0.
    if (source[field] !== undefined) picked[field] = source[field]
  }
  return picked
}

// A native build may write null or leave the key out. The types promise null,
// so an answer the server did not give reads the same on both platforms: never
// undefined, and never an invented 0 or false.
const NULLABLE_FIELDS = [
  'visitorIsNew',
  'visitorConfidence',
  'identifiable',
  'duplicate',
  'suspectScore',
  'suspectLevel',
] as const

function serverAnswer(parsed: Record<string, unknown>): NativeIdentifyResult {
  const answer = pick(parsed, SERVER_FIELDS)
  answer.visitorId = typeof answer.visitorId === 'string' ? answer.visitorId : ''
  for (const field of NULLABLE_FIELDS) {
    if (answer[field] === undefined) answer[field] = null
  }
  // v3 Option B invariant: unidentifiable checks emit `visitorId: ""` and
  // `visitorIsNew: false`, and an empty `visitorId` is never marked newly minted.
  if (answer.identifiable === false) {
    answer.visitorId = ''
    answer.visitorIsNew = false
  } else if (answer.visitorId === '' && answer.visitorIsNew === true) {
    answer.visitorIsNew = false
  }
  return answer as unknown as NativeIdentifyResult
}

function rawReport(parsed: Record<string, unknown>): RawReportResult {
  if (!isRecord(parsed.report)) throw new FingerlyError('The SDK produced an unreadable report')
  return { report: parsed.report as unknown as SignalReport }
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

  /**
   * Collects and submits on the single-pass `v: 3` wire contract, resolving
   * with the server's answer (`visitorId` is `""` and `visitorIsNew` is `false`
   * when `identifiable === false` per Option B). With `submit: false` nothing
   * is sent and only `{ report }` comes back. Rejects with a `ConsentError`
   * while consent is not `granted`.
   */
  identify(options: IdentifyOptions & { submit: false }): Promise<RawReportResult>
  identify(options?: IdentifyOptions & { submit?: true }): Promise<NativeIdentifyResult>
  identify(options: IdentifyOptions): Promise<NativeIdentifyResult | RawReportResult>
  async identify(options: IdentifyOptions = {}): Promise<NativeIdentifyResult | RawReportResult> {
    const native = nativeModule()
    const raw = await invokeNative((success, failure) =>
      native.identify(
        options.tag ?? null,
        options.submit !== false,
        options.automatic === true,
        success,
        failure,
      ),
    )
    const parsed = parseNative(raw)
    return options.submit === false ? rawReport(parsed) : serverAnswer(parsed)
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
  const consent = options.consent ?? ConsentState.Pending
  assertConsentState(consent)
  const playIntegrity = options.playIntegrityCloudProjectNumber
  assertCloudProjectNumber(playIntegrity)

  const native = nativeModule()
  try {
    // 0 means no Play Integrity; the iOS module accepts the argument and ignores it.
    native.configure(options.apiKey, options.endpoint ?? '', platformName(), consent, playIntegrity ?? 0)
  } catch (error) {
    throw parseNativeError(error)
  }
  currentConsent = consent
  return new FingerlyClient()
}

/**
 * Delete the local install record (`install_id`) and local hardware attestation
 * key state kept on the device (`Application Support` container + App Attest
 * key state on iOS; atomic install record + `AndroidKeyStore` signing key on
 * Android).
 *
 * Strictly for user-initiated GDPR / privacy right-to-erasure requests or
 * account deletion. Do not call this on routine logout, session expiry, or
 * user switching: repeatedly resetting `install_id` on the same device triggers
 * single-key `install_id` churn telemetry (`>= 3` distinct IDs in 24 hours).
 *
 * Needs no `load` and no consent, and sends nothing; resolves once no local
 * record or attestation key remains, including when there was none. A later
 * re-consented identification generates a fresh `install_id` and attests a
 * fresh key so the server mints an unlinked `visitorId`; set consent to
 * `'denied'` first to stop identifying altogether. Rejects with a
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

// Runtime constants for the fixed values the API returns and the module
// accepts, the same objects `@fingerly/core` and `@fingerly/web-js` export, so
// `result.suspectLevel === SuspectLevel.High` reads the same in every
// JavaScript SDK. Each is also the type of its values. They are names for
// strings, not a filter: the module hands on the server's values as they came,
// so one a newer server adds still reaches the app unchanged.
export {
  Confidence,
  ConsentState,
  EventState,
  SdkPlatform,
  Signal,
  SuspectLevel,
} from '@fingerly/types'

export type {
  EngineIdentity,
  IdentifyResult,
  IdentifySubmission,
  IdentifyTrigger,
  IntegrityReport,
  Lie,
  LieKind,
  MobileFingerlyOptions,
  MobileIdentifyOptions,
  NativeIdentifyResult,
  RiskSignal,
  SignalName,
  SignalOutcome,
  SignalReport,
  SignalStatus,
} from '@fingerly/types'
