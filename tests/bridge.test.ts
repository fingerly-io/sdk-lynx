import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import type {
  FingerlyOptions,
  IdentifyOptions,
  IdentifyResult,
  IdentifySubmission,
  NativeIdentifyResult,
  RiskSignal,
  SignalName,
  SignalReport,
} from '../src/index.js'
import type {
  FingerlyOptions as DeclaredFingerlyOptions,
  FingerlySpec,
  IdentifyResult as DeclaredIdentifyResult,
  NativeIdentifyResult as DeclaredNativeIdentifyResult,
  RiskSignal as DeclaredRiskSignal,
  ConsentState as DeclaredConsentState,
  Signal as DeclaredSignal,
  SuspectLevel as DeclaredSuspectLevel,
} from '../types/index.js'

type Success = (json: string) => void
type Failure = (error: string) => void

interface TestNativeModule {
  configure: ReturnType<typeof vi.fn>
  setConsent: ReturnType<typeof vi.fn>
  identify: ReturnType<typeof vi.fn>
  collect: ReturnType<typeof vi.fn>
  sdkVersion: ReturnType<typeof vi.fn>
}

const runtime = globalThis as typeof globalThis & {
  NativeModules?: Record<string, unknown>
  SystemInfo?: { platform: string }
}

const {
  Confidence,
  ConsentError,
  ConsentState,
  EventState,
  FingerlyError,
  SdkPlatform,
  Signal,
  SuspectLevel,
  deleteStoredIdentity,
  load,
  nativeVersion,
} = await import('../src/index.js')
type ConsentState = import('../src/index.js').ConsentState
type EventState = import('../src/index.js').EventState
type Signal = import('../src/index.js').Signal
type SuspectLevel = import('../src/index.js').SuspectLevel

const fullResult = {
  requestId: 'req_123',
  visitorId: 'vis_123',
  visitorIsNew: false,
  visitorConfidence: 91,
  identifiable: true,
  duplicate: false,
  state: 'enriched',
  reason: '',
  suspectScore: 42,
  suspectLevel: 'high',
  triggers: [{ signal: 'frida', group: 'instrumentation', weight: 16, confidence: 'high', reason: 'image' }],
  verdicts: { jailbreak: { value: true, confidence: 'high', reasons: ['path'] } },
  report: {
    schema: 2,
    budget_ms: 1000,
    elapsed_ms: 12,
    sources: {},
    integrity: { patched_natives: [], lies: [], engine: {} },
  },
}

function installNative(result: unknown = fullResult): TestNativeModule {
  const native = {
    configure: vi.fn(),
    setConsent: vi.fn(),
    identify: vi.fn((_tag: string | null, _submit: boolean, _automatic: boolean, success: Success) => {
      success(JSON.stringify(result))
    }),
    collect: vi.fn((success: Success) => success(JSON.stringify(fullResult.report))),
    sdkVersion: vi.fn(() => '0.4.0'),
  }
  runtime.NativeModules = { Fingerly: native }
  return native
}

/**
 * A native module that keeps its own consent, as `FingerlyBridge` does, and
 * fails `identify` and `collect` with `consent_required` until it is granted.
 * `shape` imitates each adapter's failure JSON: iOS includes `state`, Android
 * sends only a code and a message.
 */
function installGatedNative(shape: 'ios' | 'android' = 'ios'): TestNativeModule {
  let consent = 'pending'
  const refusal = () =>
    JSON.stringify({
      code: 'consent_required',
      message: `Fingerly needs consent before it can identify this visitor (consent is ${consent})`,
      ...(shape === 'ios' ? { state: consent } : {}),
    })

  const native = {
    configure: vi.fn((_apiKey: string, _endpoint: string, _platform: string, state: string) => {
      consent = state
    }),
    setConsent: vi.fn((state: string) => {
      consent = state
    }),
    identify: vi.fn((_tag: string | null, _submit: boolean, _automatic: boolean, success: Success, failure: Failure) => {
      if (consent !== 'granted') failure(refusal())
      else success(JSON.stringify(fullResult))
    }),
    collect: vi.fn((success: Success, failure: Failure) => {
      if (consent !== 'granted') failure(refusal())
      else success(JSON.stringify(fullResult.report))
    }),
    sdkVersion: vi.fn(() => '0.4.0'),
  }
  runtime.NativeModules = { Fingerly: native }
  return native
}

beforeEach(() => {
  delete runtime.NativeModules
  runtime.SystemInfo = { platform: 'iOS' }
})

describe('0.4.3 version and v3 contract parity', () => {
  it('keeps package.json, iOS binary metadata, and Android dependency at their versions', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
    // The @fingerly/types this package resolves: packages/types in this
    // repository, client/web/types when it builds inside the sdks workspace.
    const typesPkg = JSON.parse(
      readFileSync(new URL('../node_modules/@fingerly/types/package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    const iosBinary = JSON.parse(
      readFileSync(new URL('../ios/fingerly-binary.json', import.meta.url), 'utf8'),
    ) as { version: string; url: string; sha256: string; team_id: string }
    const androidGradle = readFileSync(
      new URL('../android/build.gradle.kts', import.meta.url),
      'utf8',
    )

    expect(pkg.version).toBe('0.4.3')
    // The contract types may move ahead of the bridge; it needs the signal names of 0.6.0 on.
    const [typesMajor, typesMinor] = typesPkg.version.split('.').map(Number)
    expect(typesMajor === 0 && (typesMinor ?? 0) >= 6).toBe(true)
    expect(iosBinary.version).toBe('0.4.1')
    expect(iosBinary.url).toBe('https://maven.fingerly.io/ios/Fingerly-0.4.1.xcframework.zip')
    expect(iosBinary.sha256).toBe(
      '74bb15a4b72b55524f4d2cb8567037c7f76088747bb5c866dfee61eb5f7d056e',
    )
    expect(iosBinary.team_id).toBe('XGXX88HRR5')
    expect(androidGradle).toContain('mavenLocal()')
    // An app that leaves out the optional artifacts must still pass R8.
    expect(androidGradle).toContain('consumerProguardFiles("consumer-rules.pro")')
    const rules = readFileSync(new URL('../android/consumer-rules.pro', import.meta.url), 'utf8')
    expect(rules).toContain('-dontwarn io.fingerly.sdk.appchecks.**')
    expect(rules).toContain('-dontwarn io.fingerly.sdk.playintegrity.**')
    expect(androidGradle).toContain('implementation("io.fingerly:fingerly:0.4.0")')
  })

  it('aligns public and generated TypeScript declarations with v3 and @fingerly/types', () => {
    expectTypeOf<FingerlyOptions['playIntegrityCloudProjectNumber']>().toEqualTypeOf<
      number | undefined
    >()
    expectTypeOf<DeclaredFingerlyOptions>().toEqualTypeOf<FingerlyOptions>()
    expectTypeOf<Parameters<FingerlySpec['configure']>>().toEqualTypeOf<
      [string, string, string, string, number]
    >()
    expectTypeOf<IdentifyOptions>().not.toHaveProperty('tiers')
    expectTypeOf<SignalReport>().not.toHaveProperty('tiers')
    expectTypeOf<IdentifySubmission['v']>().toEqualTypeOf<3>()
    expectTypeOf<IdentifyResult['visitorId']>().toEqualTypeOf<string>()
    expectTypeOf<IdentifyResult['visitorIsNew']>().toEqualTypeOf<boolean>()
    expectTypeOf<NativeIdentifyResult['visitorId']>().toEqualTypeOf<string>()
    expectTypeOf<NativeIdentifyResult['visitorIsNew']>().toEqualTypeOf<boolean | null>()
    expectTypeOf<NativeIdentifyResult['suspectLevel']>().toEqualTypeOf<SuspectLevel | null>()
    expectTypeOf<DeclaredIdentifyResult>().toEqualTypeOf<IdentifyResult>()
    expectTypeOf<DeclaredNativeIdentifyResult>().toEqualTypeOf<NativeIdentifyResult>()
    expectTypeOf<DeclaredRiskSignal>().toEqualTypeOf<RiskSignal>()

    const v3NativeSignals = [
      'attestation_failed',
      'attestation_missing',
      'attestation_downgrade',
      'play_device_integrity_failed',
      'play_app_unrecognized',
      'device_inconsistent',
      'report_incomplete',
      'probe_errors',
      'tampering',
      'custom_root_ca',
      'secondary_user_profile',
      'frida',
      'mitm_attack',
      'jailbreak',
      'root_apps',
      'app_cloner',
      'emulator',
      'simulator',
    ] as const satisfies readonly RiskSignal[]
    expectTypeOf<(typeof v3NativeSignals)[number]>().toMatchTypeOf<RiskSignal>()
  })
})

/** Every signal group and raw detector the server reports (`server/domain/risk`). */
const SERVER_SIGNALS = [
  'active_call',
  'ai_spoofed',
  'android_emulator',
  'antidetect_browser',
  'anycast_ip',
  'app_cloner',
  'attestation_downgrade',
  'attestation_failed',
  'attestation_missing',
  'automation',
  'bad_bot',
  'bogon_ip',
  'bootloader_unlocked',
  'bot',
  'browser_tampering',
  'cloned_app',
  'custom_root_ca',
  'datacenter_ip',
  'datacenter_proxy',
  'developer_tools',
  'device_activity_high',
  'device_activity_very_high',
  'device_farm',
  'device_inconsistent',
  'embedded_web_view',
  'emulator',
  'fetch_metadata_missing',
  'fingerprint_suppressed',
  'frida',
  'frida_detected',
  'geo_mismatch',
  'high_activity',
  'identity_obfuscated',
  'incognito',
  'incognito_mode',
  'ios_simulator',
  'ip_abuser',
  'ip_blocklist',
  'ip_blocklist_attack_source',
  'ip_blocklist_email_spam',
  'ip_reputation',
  'jailbreak',
  'jailbroken_device',
  'location_spoofing',
  'mitm_attack',
  'network_anomaly',
  'play_app_unrecognized',
  'play_device_integrity_failed',
  'privacy_settings',
  'probe_errors',
  'proxy',
  'remote_control',
  'repeated_reinstall',
  'report_incomplete',
  'residential_proxy',
  'residential_proxy_high_confidence',
  'residential_proxy_low_confidence',
  'residential_proxy_medium_confidence',
  'root_apps',
  'rooted_device',
  'secondary_user_profile',
  'simulator',
  'tampering',
  'tor',
  'virtual_machine',
  'vpn',
  'vpn_high_confidence',
  'vpn_low_confidence',
  'vpn_medium_confidence',
  'vpn_mobile',
  'vpn_os_mismatch',
  'vpn_public',
  'vpn_relay',
  'web_ticket_invalid',
  'web_ticket_missing',
]

/** `fingerprint_suppressed` as `FingerprintSuppressed`: the value in PascalCase, word by word. */
function memberName(value: string): string {
  return value
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

describe('named constants', () => {
  it('are the @fingerly/types objects, so the names match the web SDK', async () => {
    const types = await import('@fingerly/types')

    expect(Confidence).toBe(types.Confidence)
    expect(ConsentState).toBe(types.ConsentState)
    expect(EventState).toBe(types.EventState)
    expect(SdkPlatform).toBe(types.SdkPlatform)
    expect(Signal).toBe(types.Signal)
    expect(SuspectLevel).toBe(types.SuspectLevel)
    // The published declarations name the same objects.
    expectTypeOf<typeof DeclaredSignal>().toEqualTypeOf<typeof types.Signal>()
    expectTypeOf<typeof DeclaredSuspectLevel>().toEqualTypeOf<typeof types.SuspectLevel>()
    expectTypeOf<typeof DeclaredConsentState>().toEqualTypeOf<typeof types.ConsentState>()
  })

  it('pin every value to the server lists', () => {
    expect([...Object.values(Signal)].sort()).toEqual(SERVER_SIGNALS)
    expect(Object.values(Signal)).toHaveLength(75)
    expect(Object.values(Signal)).not.toContain('app_attest_key_churn')
    expect(Object.values(SuspectLevel)).toEqual(['low', 'medium', 'high'])
    expect(Object.values(Confidence)).toEqual(['low', 'medium', 'high'])
    expect(Object.values(EventState)).toEqual(['pending', 'enriched', 'unavailable'])
    expect(Object.values(ConsentState)).toEqual(['granted', 'pending', 'denied'])
    expect(Object.values(SdkPlatform)).toEqual([
      'web',
      'android',
      'ios',
      'react-native-ios',
      'react-native-android',
      'flutter-ios',
      'flutter-android',
      'lynx-ios',
      'lynx-android',
    ])
  })

  it('name each member after its value', () => {
    for (const constants of [Signal, SuspectLevel, Confidence, EventState, ConsentState, SdkPlatform]) {
      for (const [member, value] of Object.entries(constants)) {
        expect(member).toBe(memberName(value))
      }
    }
  })

  it('compare equal to what the server answered, and an unknown value passes through', async () => {
    const native = installNative()
    const fingerly = await load({ apiKey: 'fly_pk_development_test', consent: ConsentState.Granted })

    const result = await fingerly.identify()
    expect(result.state).toBe(EventState.Enriched)
    expect(result.suspectLevel).toBe(SuspectLevel.High)
    expect(native.configure.mock.calls[0]?.[2]).toBe(SdkPlatform.LynxIos)
    expect(native.configure.mock.calls[0]?.[3]).toBe(ConsentState.Granted)

    installNative({
      requestId: 'req_new_values',
      visitorId: 'vis_123',
      identifiable: true,
      state: 'state_from_a_newer_server',
      suspectScore: 50,
      suspectLevel: 'level_from_a_newer_server',
      report: fullResult.report,
    })
    const newer = await fingerly.identify()
    expect(newer.state).toBe('state_from_a_newer_server')
    expect(newer.suspectLevel).toBe('level_from_a_newer_server')
  })

  it('type the result fields with the constants and still accept plain strings', () => {
    expectTypeOf(SuspectLevel.High).toEqualTypeOf<'high'>()
    expectTypeOf<NativeIdentifyResult['suspectLevel']>().toEqualTypeOf<SuspectLevel | null>()
    expectTypeOf<EventState>().toMatchTypeOf<NativeIdentifyResult['state']>()
    expectTypeOf<'state_from_a_newer_server'>().toMatchTypeOf<NativeIdentifyResult['state']>()
    expectTypeOf<Signal>().toEqualTypeOf<RiskSignal>()
    expectTypeOf<'signal_from_a_newer_server'>().toMatchTypeOf<SignalName>()
    expectTypeOf<FingerlyOptions['consent']>().toEqualTypeOf<ConsentState | undefined>()
  })
})

describe('platform contract', () => {
  it('reports the iOS host', async () => {
    const native = installNative()
    await load({ apiKey: 'fly_pk_development_test' })
    expect(native.configure).toHaveBeenCalledWith('fly_pk_development_test', '', 'lynx-ios', 'pending', 0)
  })

  it('reports the Android host and forwards a custom endpoint', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    const native = installNative()
    await load({ apiKey: 'fly_pk_development_test', endpoint: 'https://edge.example' })
    expect(native.configure).toHaveBeenCalledWith('fly_pk_development_test', 'https://edge.example', 'lynx-android', 'pending', 0)
  })

  it.each(['Harmony', 'windows', 'macOS', 'web'])('rejects unsupported %s hosts', async (platform) => {
    runtime.SystemInfo = { platform }
    installNative()
    await expect(load({ apiKey: 'fly_pk_development_test' })).rejects.toThrow(/iOS and Android only/)
  })
})

describe('Play Integrity', () => {
  it('hands the project number to the native configure on Android and iOS', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    const androidNative = installNative()
    await load({ apiKey: 'fly_pk_development_test', playIntegrityCloudProjectNumber: 123456789012 })
    expect(androidNative.configure).toHaveBeenCalledWith(
      'fly_pk_development_test',
      '',
      'lynx-android',
      'pending',
      123456789012,
    )

    runtime.SystemInfo = { platform: 'iOS' }
    const iosNative = installNative()
    await load({ apiKey: 'fly_pk_development_test', playIntegrityCloudProjectNumber: 123456789012 })
    expect(iosNative.configure).toHaveBeenCalledWith(
      'fly_pk_development_test',
      '',
      'lynx-ios',
      'pending',
      123456789012,
    )
  })

  it('refuses a value that is not a positive safe integer project number before configuring', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    for (const bad of [
      0,
      -5,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '123456789012',
      null,
      true,
    ]) {
      const native = installNative()
      await expect(
        load({
          apiKey: 'fly_pk_development_test',
          playIntegrityCloudProjectNumber: bad as unknown as number,
        }),
      ).rejects.toThrow(TypeError)
      expect(native.configure).not.toHaveBeenCalled()
    }
  })
})

describe('native module lifecycle', () => {
  it('gives actionable setup guidance when Autolink is missing', async () => {
    await expect(load({ apiKey: 'fly_pk_development_test' })).rejects.toThrow(/Autolink/)
    await expect(load({ apiKey: 'fly_pk_development_test' })).rejects.toThrow(/compromised device as clean/)
  })

  it('looks the module up lazily', async () => {
    const native = installNative()
    await expect(load({ apiKey: 'fly_pk_development_test' })).resolves.toBeDefined()
    expect(native.configure).toHaveBeenCalledOnce()
  })

  it('returns the collecting 0.4.0 SDK version', () => {
    const native = installNative()
    expect(nativeVersion()).toBe('0.4.0')

    native.sdkVersion.mockImplementation(() => {
      throw new Error('bridge error')
    })
    expect(nativeVersion()).toBeUndefined()

    delete runtime.NativeModules
    expect(nativeVersion()).toBeUndefined()
  })
})

describe('identify', () => {
  it('uses a null tag and submits by default', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await client.identify()
    expect(native.identify.mock.calls[0]?.slice(0, 3)).toEqual([null, true, false])
  })

  it('forwards a tag and submit false', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await client.identify({ tag: 'checkout', submit: false })
    expect(native.identify.mock.calls[0]?.slice(0, 3)).toEqual(['checkout', false, false])
  })

  it('forwards automatic when asked for', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await client.identify({ tag: 'timer', automatic: true })
    expect(native.identify.mock.calls[0]?.slice(0, 3)).toEqual(['timer', true, true])
  })

  it('preserves the complete native/server result', async () => {
    installNative()
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.requestId).toBe('req_123')
    expect(result.visitorId).toBe('vis_123')
    expect(result.visitorIsNew).toBe(false)
    expect(result.visitorConfidence).toBe(91)
    expect(result.identifiable).toBe(true)
    expect(result.duplicate).toBe(false)
    expect(result.state).toBe('enriched')
    expect(result.suspectScore).toBe(42)
    expect(result.suspectLevel).toBe('high')
    expect(result).not.toHaveProperty('triggers')
    expect(result.report.schema).toBe(2)
    expect(result.report).not.toHaveProperty('tiers')
  })

  it('handles v3 Option B unidentifiable results with visitorId "" and visitorIsNew false', async () => {
    installNative({
      requestId: 'req_unid',
      visitorId: '',
      visitorIsNew: false,
      visitorConfidence: 0,
      identifiable: false,
      duplicate: false,
      state: 'enriched',
      suspectScore: 33,
      suspectLevel: 'high',
      report: fullResult.report,
    })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.requestId).toBe('req_unid')
    expect(result.identifiable).toBe(false)
    expect(result.visitorId).toBe('')
    expect(result.visitorIsNew).toBe(false)
    expect(result.visitorConfidence).toBe(0)
    expect(result.suspectScore).toBe(33)
    expect(result.suspectLevel).toBe('high')
  })

  it('enforces Option B invariants when identifiable is false or visitorId is empty', async () => {
    installNative({
      requestId: 'req_unid_legacy',
      visitorId: 'vis_stale',
      visitorIsNew: true,
      visitorConfidence: 0,
      identifiable: false,
      state: 'enriched',
      report: fullResult.report,
    })
    const unidentifiable = await (
      await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    ).identify()
    expect(unidentifiable.identifiable).toBe(false)
    expect(unidentifiable.visitorId).toBe('')
    expect(unidentifiable.visitorIsNew).toBe(false)

    installNative({
      requestId: 'req_empty_vid',
      visitorId: '',
      visitorIsNew: true,
      visitorConfidence: 0,
      identifiable: true,
      state: 'enriched',
      report: fullResult.report,
    })
    const emptyVisitor = await (
      await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    ).identify()
    expect(emptyVisitor.visitorId).toBe('')
    expect(emptyVisitor.visitorIsNew).toBe(false)
  })

  it('preserves visitorIsNew true when a fresh visitorId was minted', async () => {
    installNative({
      requestId: 'req_minted',
      visitorId: 'vis_fresh',
      visitorIsNew: true,
      visitorConfidence: 0,
      identifiable: true,
      duplicate: false,
      state: 'enriched',
      suspectScore: 0,
      suspectLevel: 'low',
      report: fullResult.report,
    })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.visitorId).toBe('vis_fresh')
    expect(result.visitorIsNew).toBe(true)
    expect(result.visitorConfidence).toBe(0)
    expect(result.suspectScore).toBe(0)
    expect(result.suspectLevel).toBe('low')
  })

  it('carries a score from an answer that has no signals', async () => {
    installNative({ requestId: 'req_1', visitorId: 'vis_1', suspectScore: 41, suspectLevel: 'high', report: fullResult.report })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.suspectScore).toBe(41)
    expect(result.suspectLevel).toBe('high')
    expect(result).not.toHaveProperty('triggers')
  })

  it('reads an answer with neither score nor signals, the same as a hidden score', async () => {
    installNative({ requestId: 'req_1', visitorId: 'vis_1', state: 'enriched', report: fullResult.report })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.requestId).toBe('req_1')
    expect(result.suspectScore).toBeNull()
    expect(result.suspectLevel).toBeNull()
    expect(result).not.toHaveProperty('triggers')
  })

  it('keeps an unscored result null', async () => {
    installNative({ ...fullResult, suspectScore: null, suspectLevel: null })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.suspectScore).toBeNull()
    expect(result.suspectLevel).toBeNull()
    expect(result.suspectScore).not.toBe(0)
    expect(result.suspectLevel).not.toBe('')
  })

  it.each([
    ['Android writes null', { visitorIsNew: null, visitorConfidence: null, identifiable: null, duplicate: null, suspectScore: null, suspectLevel: null }],
    ['iOS leaves the key out', {}],
  ])('reads an answer the server did not give as null: %s', async (_label, unsaid) => {
    installNative({ requestId: 'req_dup', visitorId: '', state: 'enriched', report: fullResult.report, ...unsaid })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()

    for (const field of ['visitorIsNew', 'visitorConfidence', 'identifiable', 'duplicate', 'suspectScore', 'suspectLevel'] as const) {
      expect(result[field]).toBeNull()
    }
  })

  it('keeps a duplicate answer true with its visitor fields empty', async () => {
    installNative({ requestId: 'req_dup', visitorId: '', duplicate: true, state: 'enriched', report: fullResult.report })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()

    expect(result.duplicate).toBe(true)
    expect(result.visitorId).toBe('')
    expect(result.visitorConfidence).toBeNull()
  })

  it('never hands the app a signal name or weight, even when the native side still sends them', async () => {
    // fullResult answers like an older native build, with a trigger in it.
    installNative()
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result).not.toHaveProperty('triggers')
    expect(JSON.stringify(result)).not.toContain('instrumentation')
    expect(JSON.stringify(result)).not.toContain('weight')
  })

  it('never hands the app a local conclusion from a stale or forged native answer', async () => {
    installNative()
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result).not.toHaveProperty('verdicts')
    expect(JSON.stringify(result)).not.toContain('jailbreak')
  })

  it.each([
    ['null', null],
    ['not a list', 'frida'],
    ['an object', { signal: 'frida' }],
    ['a list of anything', ['frida', null, 3, ['x'], { signal: 'frida', weight: 9 }]],
  ])('ignores stale triggers that are %s, and any unknown member', async (_label, triggers) => {
    installNative({ requestId: 'req_1', suspectScore: 12, triggers, futureMember: { nested: true }, report: fullResult.report })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.requestId).toBe('req_1')
    expect(result.suspectScore).toBe(12)
    expect(result).not.toHaveProperty('triggers')
    expect(result).not.toHaveProperty('futureMember')
    expect(JSON.stringify(result)).not.toContain('"frida"')
  })

  it('returns only the raw report for submit: false', async () => {
    // Forged on purpose: an answer full of server fields and a local conclusion
    // for a check nobody sent. None of it may survive.
    installNative()
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await expect(client.identify({ submit: false })).resolves.toEqual({ report: fullResult.report })
  })

  it.each([
    ['missing', {}],
    ['null', { report: null }],
    ['text', { report: 'text' }],
    ['a list', { report: [1] }],
  ])('rejects submit: false when the report is %s', async (_label, answer) => {
    installNative(answer)
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await expect(client.identify({ submit: false })).rejects.toBeInstanceOf(FingerlyError)
  })
})

describe('consent', () => {
  it('defaults to pending, so nothing is identified until consent is granted', async () => {
    const native = installGatedNative('ios')
    const client = await load({ apiKey: 'fly_pk_development_test' })
    expect(native.configure.mock.calls[0]?.[3]).toBe('pending')
    expect(client.consent).toBe('pending')
    await expect(client.identify()).rejects.toMatchObject({
      name: 'ConsentError',
      code: 'consent_required',
      state: 'pending',
    })
    await expect(client.collect()).rejects.toBeInstanceOf(ConsentError)
  })

  it.each(['granted', 'pending', 'denied'] as const)('passes %s through to the native configure', async (consent) => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test', consent })
    expect(native.configure).toHaveBeenCalledWith('fly_pk_development_test', '', 'lynx-ios', consent, 0)
    expect(client.consent).toBe(consent)
  })

  it('rejects an unknown consent before configuring', async () => {
    const native = installNative()
    await expect(
      load({ apiKey: 'fly_pk_development_test', consent: 'yes' as unknown as 'granted' }),
    ).rejects.toThrow(TypeError)
    expect(native.configure).not.toHaveBeenCalled()
  })

  it('forwards setConsent and keeps the getter in step', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'pending' })

    client.setConsent('granted')
    expect(native.setConsent).toHaveBeenLastCalledWith('granted')
    expect(client.consent).toBe('granted')

    client.setConsent('denied')
    expect(native.setConsent).toHaveBeenLastCalledWith('denied')
    expect(client.consent).toBe('denied')

    expect(() => client.setConsent('all' as unknown as 'granted')).toThrow(TypeError)
    expect(native.setConsent).toHaveBeenCalledTimes(2)
    expect(client.consent).toBe('denied')
  })

  it('wraps a synchronous setConsent failure without changing the stored state', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'pending' })
    native.setConsent.mockImplementation(() => {
      throw new Error('bridge disconnected')
    })

    expect(() => client.setConsent('granted')).toThrow(FingerlyError)
    expect(client.consent).toBe('pending')
  })

  it.each(['pending', 'denied'] as const)(
    'maps an iOS consent_required failure to ConsentError (%s)',
    async (consent) => {
      installGatedNative('ios')
      const client = await load({ apiKey: 'fly_pk_development_test', consent })
      const failure = await client.identify().catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(ConsentError)
      expect(failure).toBeInstanceOf(FingerlyError)
      expect(failure).toMatchObject({
        name: 'ConsentError',
        code: 'consent_required',
        state: consent,
        status: undefined,
        message: `Fingerly needs consent before it can identify this visitor (consent is ${consent})`,
      })
    },
  )

  it('reads the state from the message when Android sends none, and falls back to pending', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    installGatedNative('android')
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'denied' })
    await expect(client.collect()).rejects.toMatchObject({
      name: 'ConsentError',
      code: 'consent_required',
      state: 'denied',
    })

    const native = installNative()
    native.identify.mockImplementation(
      (_tag: string | null, _submit: boolean, _automatic: boolean, _success: Success, failure: Failure) => {
        failure(JSON.stringify({ code: 'consent_required', message: 'refused' }))
      },
    )
    const fallbackClient = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await expect(fallbackClient.identify()).rejects.toMatchObject({
      name: 'ConsentError',
      code: 'consent_required',
      state: 'pending',
    })
  })

  it('identifies once consent is granted', async () => {
    const native = installGatedNative('ios')
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'pending' })

    await expect(client.identify()).rejects.toBeInstanceOf(ConsentError)
    await expect(client.collect()).rejects.toBeInstanceOf(ConsentError)

    client.setConsent('granted')
    await expect(client.identify()).resolves.toMatchObject({ requestId: 'req_123' })
    expect(native.identify).toHaveBeenCalledTimes(2)
  })
})

describe('collection and failures', () => {
  it('parses the report returned by collect', async () => {
    installNative()
    const report = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).collect()
    expect(report.schema).toBe(2)
  })

  it('preserves positive HTTP status codes', async () => {
    const native = installNative()
    native.identify.mockImplementation(
      (_tag: string | null, _submit: boolean, _automatic: boolean, _success: Success, failure: Failure) => {
        failure(JSON.stringify({ code: '402', message: 'organisation disabled' }))
      },
    )
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await expect(client.identify()).rejects.toMatchObject({
      name: 'FingerlyError',
      message: 'organisation disabled',
      status: 402,
    })
  })

  it('carries retryAfterMs on 429 and 503 errors on both iOS and Android', async () => {
    for (const platform of ['iOS', 'Android'] as const) {
      runtime.SystemInfo = { platform }
      const native = installNative()
      native.identify.mockImplementation(
        (_tag: string | null, _submit: boolean, _automatic: boolean, _success: Success, failure: Failure) => {
          failure(JSON.stringify({ code: '429', message: 'Too many requests', retryAfterMs: 3000 }))
        },
      )
      const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
      await expect(client.identify()).rejects.toMatchObject({ status: 429, retryAfterMs: 3000 })
    }
  })

  it('leaves retryAfterMs undefined when no usable wait was named', async () => {
    for (const extra of [{}, { retryAfterMs: '3' }, { retryAfterMs: -1 }]) {
      const native = installNative()
      native.identify.mockImplementation(
        (_tag: string | null, _submit: boolean, _automatic: boolean, _success: Success, failure: Failure) => {
          failure(JSON.stringify({ code: '503', message: 'unavailable', ...extra }))
        },
      )
      const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
      const error = await client.identify().catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(FingerlyError)
      expect((error as InstanceType<typeof FingerlyError>).retryAfterMs).toBeUndefined()
    }
  })

  it('wraps plain-text failures and synchronous bridge throws in FingerlyError', async () => {
    const native = installNative()
    native.configure.mockImplementationOnce(() => {
      throw new Error('secret key refused')
    })
    await expect(load({ apiKey: 'fly_sk_development_bad' })).rejects.toMatchObject({
      name: 'FingerlyError',
      message: 'secret key refused',
    })

    native.identify.mockImplementationOnce(
      (_tag: string | null, _submit: boolean, _automatic: boolean, _success: Success, failure: Failure) => {
        failure('plain native failure')
      },
    )
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await expect(client.identify()).rejects.toMatchObject({
      name: 'FingerlyError',
      message: 'plain native failure',
      status: undefined,
    })
  })

  it('does not expose native sentinel codes as HTTP statuses', async () => {
    const native = installNative()
    native.collect.mockImplementation((_success: Success, failure: Failure) => {
      failure(JSON.stringify({ code: '-1', message: 'no report' }))
    })
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    try {
      await client.collect()
      throw new Error('expected collect to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(FingerlyError)
      expect((error as InstanceType<typeof FingerlyError>).status).toBeUndefined()
    }
  })
})

describe('unreadable native answers', () => {
  it('rejects with a FingerlyError rather than a SyntaxError or TypeError', async () => {
    for (const raw of ['not json', 'null', '[1, 2]', '"text"']) {
      const native = installNative()
      native.identify.mockImplementation((_tag: string | null, _submit: boolean, _automatic: boolean, success: Success) => {
        success(raw)
      })
      native.collect.mockImplementation((success: Success) => success(raw))
      const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
      await expect(client.identify(), raw).rejects.toBeInstanceOf(FingerlyError)
      await expect(client.collect(), raw).rejects.toBeInstanceOf(FingerlyError)
    }
  })

  it('passes on only what the server tells an app and defaults missing visitorId to ""', async () => {
    installNative({
      requestId: 'req_1',
      state: 'unavailable',
      reason: 'ip-database-not-loaded',
      report: { schema: 2, sources: {} },
      somethingNew: { a: 1 },
    })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.requestId).toBe('req_1')
    expect(result.visitorId).toBe('')
    expect(result.state).toBe('unavailable')
    expect(result).not.toHaveProperty('reason')
    expect(result).not.toHaveProperty('somethingNew')
  })
})

describe('deleteStoredIdentity', () => {
  it('asks the native SDK, without load or consent', async () => {
    const native = installNative()
    const remove = vi.fn((success: () => void) => success())
    ;(native as unknown as Record<string, unknown>).deleteStoredIdentity = remove

    await expect(deleteStoredIdentity()).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(native.configure).not.toHaveBeenCalled()
    expect(native.setConsent).not.toHaveBeenCalled()
  })

  it('surfaces a failed delete as a FingerlyError, as both adapters report it', async () => {
    const native = installNative()
    ;(native as unknown as Record<string, unknown>).deleteStoredIdentity = vi.fn(
      (_success: () => void, failure: Failure) =>
        failure(
          JSON.stringify({
            code: 'delete_failed',
            message: 'Fingerly could not delete its stored install record',
          }),
        ),
    )

    const error = await deleteStoredIdentity().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FingerlyError)
    expect((error as InstanceType<typeof FingerlyError>).message).toBe(
      'Fingerly could not delete its stored install record',
    )
    expect((error as InstanceType<typeof FingerlyError>).status).toBeUndefined()
  })

  it('wraps a synchronous deleteStoredIdentity throw in FingerlyError', async () => {
    const native = installNative()
    ;(native as unknown as Record<string, unknown>).deleteStoredIdentity = vi.fn(() => {
      throw new Error('storage locked')
    })

    await expect(deleteStoredIdentity()).rejects.toMatchObject({
      name: 'FingerlyError',
      message: 'storage locked',
    })
  })

  it('says so when the native SDK in the app predates it', async () => {
    installNative()

    await expect(deleteStoredIdentity()).rejects.toThrow(/deleteStoredIdentity is not available/)
  })

  it('reports the missing native module', async () => {
    await expect(deleteStoredIdentity()).rejects.toThrow(/could not find its Fingerly native module/)
  })

  it('documents deleteStoredIdentity strictly for user-initiated GDPR/privacy erasure across TS and native adapters', () => {
    const tsSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const dtsSource = readFileSync(new URL('../types/index.d.ts', import.meta.url), 'utf8')
    const javaSource = readFileSync(
      new URL('../android/src/main/java/io/fingerly/lynx/Fingerly.java', import.meta.url),
      'utf8',
    )
    const objcSource = readFileSync(new URL('../ios/src/Fingerly.m', import.meta.url), 'utf8')

    for (const source of [tsSource, dtsSource, javaSource, objcSource]) {
      expect(source).toMatch(/GDPR/i)
      expect(source).toMatch(/user-initiated/i)
    }
  })
})
