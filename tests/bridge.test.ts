import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { ConsentError, FingerlyError, load, nativeVersion } = await import('../src/index.js')

const fullResult = {
  requestId: 'req_123',
  visitorId: 'vis_123',
  visitorIsNew: false,
  visitorConfidence: 91,
  identifiable: true,
  duplicate: false,
  state: 'scored',
  reason: '',
  suspectScore: 42,
  suspectLevel: 'medium',
  triggers: [{ signal: 'frida', group: 'instrumentation', weight: 42, confidence: 'high', reason: 'image' }],
  verdicts: { jailbreak: { value: true, confidence: 'high', reasons: ['path'] } },
  report: {
    schema: 1,
    budget_ms: 1000,
    elapsed_ms: 12,
    tiers: ['fast'],
    sources: {},
    integrity: { patched_natives: [], lies: [], engine: {} },
  },
}

function installNative(result: unknown = fullResult): TestNativeModule {
  const native = {
    configure: vi.fn(),
    setConsent: vi.fn(),
    identify: vi.fn((_tag: string | null, _submit: boolean, success: Success) => {
      success(JSON.stringify(result))
    }),
    collect: vi.fn((success: Success) => success(JSON.stringify(fullResult.report))),
    sdkVersion: vi.fn(() => '0.1.0'),
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
  let consent = 'granted'
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
    identify: vi.fn((_tag: string | null, _submit: boolean, success: Success, failure: Failure) => {
      if (consent !== 'granted') failure(refusal())
      else success(JSON.stringify(fullResult))
    }),
    collect: vi.fn((success: Success, failure: Failure) => {
      if (consent !== 'granted') failure(refusal())
      else success(JSON.stringify(fullResult.report))
    }),
    sdkVersion: vi.fn(() => '0.1.0'),
  }
  runtime.NativeModules = { Fingerly: native }
  return native
}

beforeEach(() => {
  delete runtime.NativeModules
  runtime.SystemInfo = { platform: 'iOS' }
})

describe('platform contract', () => {
  it('reports the iOS host', async () => {
    const native = installNative()
    await load({ apiKey: 'fly_pk_development_test' })
    expect(native.configure).toHaveBeenCalledWith('fly_pk_development_test', '', 'lynx-ios', 'granted')
  })

  it('reports the Android host and forwards a custom endpoint', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    const native = installNative()
    await load({ apiKey: 'fly_pk_development_test', endpoint: 'https://edge.example' })
    expect(native.configure).toHaveBeenCalledWith('fly_pk_development_test', 'https://edge.example', 'lynx-android', 'granted')
  })

  it.each(['Harmony', 'windows', 'macOS', 'web'])('rejects unsupported %s hosts', async (platform) => {
    runtime.SystemInfo = { platform }
    installNative()
    await expect(load({ apiKey: 'fly_pk_development_test' })).rejects.toThrow(/iOS and Android only/)
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

  it('returns the collecting SDK version', () => {
    installNative()
    expect(nativeVersion()).toBe('0.1.0')
    delete runtime.NativeModules
    expect(nativeVersion()).toBeUndefined()
  })
})

describe('identify', () => {
  it('uses a null tag and submits by default', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test' })
    await client.identify()
    expect(native.identify.mock.calls[0]?.slice(0, 2)).toEqual([null, true])
  })

  it('forwards a tag and submit false', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test' })
    await client.identify({ tag: 'checkout', submit: false })
    expect(native.identify.mock.calls[0]?.slice(0, 2)).toEqual(['checkout', false])
  })

  it('preserves the complete native/server result', async () => {
    installNative()
    const result = await (await load({ apiKey: 'fly_pk_development_test' })).identify()
    expect(result.requestId).toBe('req_123')
    expect(result.visitorId).toBe('vis_123')
    expect(result.suspectScore).toBe(42)
    expect(result.triggers).toHaveLength(1)
    expect(result.report.schema).toBe(1)
  })

  it('keeps an unscored result null', async () => {
    installNative({ ...fullResult, suspectScore: null, suspectLevel: null })
    const result = await (await load({ apiKey: 'fly_pk_development_test' })).identify({ submit: false })
    expect(result.suspectScore).toBeNull()
    expect(result.suspectLevel).toBeNull()
  })

  it('fills verdicts unavailable on the current native platform', async () => {
    installNative()
    const result = await (await load({ apiKey: 'fly_pk_development_test' })).identify()
    expect(result.verdicts.jailbreak.value).toBe(true)
    expect(result.verdicts.root).toEqual({ value: false, confidence: 'low', reasons: [] })
    expect(result.verdicts.emulator.reasons).toEqual([])
  })
})

describe('consent', () => {
  it('defaults to granted and leaves identification unchanged', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test' })
    expect(native.configure.mock.calls[0]?.[3]).toBe('granted')
    expect(client.consent).toBe('granted')
    await expect(client.identify()).resolves.toMatchObject({ requestId: 'req_123' })
  })

  it.each(['pending', 'denied'] as const)('passes %s through to the native configure', async (consent) => {
    const native = installNative()
    const client = await load({ apiKey: 'fly_pk_development_test', consent })
    expect(native.configure).toHaveBeenCalledWith('fly_pk_development_test', '', 'lynx-ios', consent)
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

  it('reads the state from the message when Android sends none', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    installGatedNative('android')
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'denied' })
    await expect(client.collect()).rejects.toMatchObject({
      name: 'ConsentError',
      code: 'consent_required',
      state: 'denied',
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
    const report = await (await load({ apiKey: 'fly_pk_development_test' })).collect()
    expect(report.schema).toBe(1)
  })

  it('preserves positive HTTP status codes', async () => {
    const native = installNative()
    native.identify.mockImplementation(
      (_tag: string | null, _submit: boolean, _success: Success, failure: Failure) => {
        failure(JSON.stringify({ code: '402', message: 'organisation disabled' }))
      },
    )
    const client = await load({ apiKey: 'fly_pk_development_test' })
    await expect(client.identify()).rejects.toMatchObject({
      name: 'FingerlyError',
      message: 'organisation disabled',
      status: 402,
    })
  })

  it('does not expose native sentinel codes as HTTP statuses', async () => {
    const native = installNative()
    native.collect.mockImplementation((_success: Success, failure: Failure) => {
      failure(JSON.stringify({ code: '-1', message: 'no report' }))
    })
    const client = await load({ apiKey: 'fly_pk_development_test' })
    try {
      await client.collect()
      throw new Error('expected collect to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(FingerlyError)
      expect((error as InstanceType<typeof FingerlyError>).status).toBeUndefined()
    }
  })
})
