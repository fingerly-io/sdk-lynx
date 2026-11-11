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

const { ConsentError, FingerlyError, deleteStoredIdentity, load, nativeVersion } = await import(
  '../src/index.js'
)

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
    identify: vi.fn((_tag: string | null, _submit: boolean, _automatic: boolean, success: Success) => {
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
  it('hands the project number to the native configure', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    const native = installNative()
    await load({ apiKey: 'fly_pk_development_test', playIntegrityCloudProjectNumber: 123456789012 })
    expect(native.configure).toHaveBeenCalledWith('fly_pk_development_test', '', 'lynx-android', 'pending', 123456789012)
  })

  it('refuses a value that is not a project number before configuring', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    for (const bad of [0, -5, 1.5, Number.NaN, '123456789012']) {
      const native = installNative()
      await expect(
        load({ apiKey: 'fly_pk_development_test', playIntegrityCloudProjectNumber: bad as number }),
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
    expect(result.suspectScore).toBe(42)
    expect(result).not.toHaveProperty('triggers')
    expect(result.report.schema).toBe(1)
  })

  it('carries a score from an answer that has no signals', async () => {
    installNative({ requestId: 'req_1', visitorId: 'vis_1', suspectScore: 41, suspectLevel: 'medium', report: fullResult.report })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.suspectScore).toBe(41)
    expect(result.suspectLevel).toBe('medium')
    expect(result).not.toHaveProperty('triggers')
  })

  it('reads an answer with neither score nor signals, the same as a hidden score', async () => {
    installNative({ requestId: 'req_1', visitorId: 'vis_1', state: 'scored', report: fullResult.report })
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
    installNative({ requestId: 'req_dup', visitorId: '', state: 'scored', report: fullResult.report, ...unsaid })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()

    for (const field of ['visitorIsNew', 'visitorConfidence', 'identifiable', 'duplicate', 'suspectScore', 'suspectLevel'] as const) {
      expect(result[field]).toBeNull()
    }
  })

  it('keeps a duplicate answer true with its visitor fields empty', async () => {
    installNative({ requestId: 'req_dup', visitorId: '', duplicate: true, state: 'scored', report: fullResult.report })
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
    const report = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).collect()
    expect(report.schema).toBe(1)
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

  it('carries the iOS adapter retryAfterMs on the error', async () => {
    const native = installNative()
    native.identify.mockImplementation(
      (_tag: string | null, _submit: boolean, _automatic: boolean, _success: Success, failure: Failure) => {
        failure(JSON.stringify({ code: '429', message: 'Too many requests', retryAfterMs: 3000 }))
      },
    )
    const client = await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    await expect(client.identify()).rejects.toMatchObject({ status: 429, retryAfterMs: 3000 })
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

  it('passes on only what the server tells an app', async () => {
    installNative({
      requestId: 'req_1',
      state: 'unavailable',
      reason: 'ip-database-not-loaded',
      report: { schema: 1, sources: {} },
      somethingNew: { a: 1 },
    })
    const result = await (await load({ apiKey: 'fly_pk_development_test', consent: 'granted' })).identify()
    expect(result.requestId).toBe('req_1')
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

  it('says so when the native SDK in the app predates it', async () => {
    installNative()

    await expect(deleteStoredIdentity()).rejects.toThrow(/deleteStoredIdentity is not available/)
  })

  it('reports the missing native module', async () => {
    await expect(deleteStoredIdentity()).rejects.toThrow(/could not find its Fingerly native module/)
  })
})
