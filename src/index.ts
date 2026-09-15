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
  configure(apiKey: string, endpoint: string, platform: string): void
  identify(
    tag: string | null,
    submit: boolean,
    success: (json: string) => void,
    failure: (error: string) => void,
  ): void
  collect(success: (json: string) => void, failure: (error: string) => void): void
  sdkVersion(): string
}

export type FingerlyOptions = MobileFingerlyOptions
export type IdentifyOptions = MobileIdentifyOptions

export class FingerlyError extends Error {
  override readonly name = 'FingerlyError'

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

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
  const parsed =
    typeof record?.code === 'number'
      ? record.code
      : typeof record?.code === 'string' && record.code.trim() !== ''
        ? Number(record.code)
        : undefined
  const status =
    typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  const message =
    typeof record?.message === 'string'
      ? record.message
      : value instanceof Error
        ? value.message
        : String(value)

  return new FingerlyError(message, status)
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
  async identify(options: IdentifyOptions = {}): Promise<NativeIdentifyResult> {
    const native = nativeModule()
    const raw = await invokeNative((success, failure) =>
      native.identify(options.tag ?? null, options.submit !== false, success, failure),
    )
    const parsed = JSON.parse(raw) as NativeIdentifyResult
    return { ...parsed, verdicts: normalizeVerdicts(parsed.verdicts) }
  }

  async collect(): Promise<SignalReport> {
    const native = nativeModule()
    const raw = await invokeNative((success, failure) => native.collect(success, failure))
    return JSON.parse(raw) as SignalReport
  }
}

export async function load(options: FingerlyOptions): Promise<FingerlyClient> {
  const native = nativeModule()
  try {
    native.configure(options.apiKey, options.endpoint ?? '', platformName())
  } catch (error) {
    throw parseNativeError(error)
  }
  return new FingerlyClient()
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
