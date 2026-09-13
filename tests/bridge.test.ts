import { beforeEach, describe, expect, it, vi } from 'vitest'

type Success = (json: string) => void
type Failure = (error: string) => void

interface TestNativeModule {
  configure: ReturnType<typeof vi.fn>
  identify: ReturnType<typeof vi.fn>
  collect: ReturnType<typeof vi.fn>
  sdkVersion: ReturnType<typeof vi.fn>
}

const runtime = globalThis as typeof globalThis & {
  NativeModules?: Record<string, unknown>
  SystemInfo?: { platform: string }
}

const { BadeleError, load, nativeVersion } = await import('../src/index.js')

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
    identify: vi.fn((_tag: string | null, _submit: boolean, success: Success) => {
      success(JSON.stringify(result))
    }),
    collect: vi.fn((success: Success) => success(JSON.stringify(fullResult.report))),
    sdkVersion: vi.fn(() => '0.1.0'),
  }
  runtime.NativeModules = { Badele: native }
  return native
}

beforeEach(() => {
  delete runtime.NativeModules
  runtime.SystemInfo = { platform: 'iOS' }
})

describe('platform contract', () => {
  it('reports the iOS host', async () => {
    const native = installNative()
    await load({ apiKey: 'pk_test' })
    expect(native.configure).toHaveBeenCalledWith('pk_test', '', 'lynx-ios')
  })

  it('reports the Android host and forwards a custom endpoint', async () => {
    runtime.SystemInfo = { platform: 'Android' }
    const native = installNative()
    await load({ apiKey: 'pk_test', endpoint: 'https://edge.example' })
    expect(native.configure).toHaveBeenCalledWith('pk_test', 'https://edge.example', 'lynx-android')
  })

  it.each(['Harmony', 'windows', 'macOS', 'web'])('rejects unsupported %s hosts', async (platform) => {
    runtime.SystemInfo = { platform }
    installNative()
    await expect(load({ apiKey: 'pk_test' })).rejects.toThrow(/iOS and Android only/)
  })
})

describe('native module lifecycle', () => {
  it('gives actionable setup guidance when Autolink is missing', async () => {
    await expect(load({ apiKey: 'pk_test' })).rejects.toThrow(/Autolink/)
    await expect(load({ apiKey: 'pk_test' })).rejects.toThrow(/compromised device as clean/)
  })

  it('looks the module up lazily', async () => {
    const native = installNative()
    await expect(load({ apiKey: 'pk_test' })).resolves.toBeDefined()
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
    const client = await load({ apiKey: 'pk_test' })
    await client.identify()
    expect(native.identify.mock.calls[0]?.slice(0, 2)).toEqual([null, true])
  })

  it('forwards a tag and submit false', async () => {
    const native = installNative()
    const client = await load({ apiKey: 'pk_test' })
    await client.identify({ tag: 'checkout', submit: false })
    expect(native.identify.mock.calls[0]?.slice(0, 2)).toEqual(['checkout', false])
  })

  it('preserves the complete native/server result', async () => {
    installNative()
    const result = await (await load({ apiKey: 'pk_test' })).identify()
    expect(result.requestId).toBe('req_123')
    expect(result.visitorId).toBe('vis_123')
    expect(result.suspectScore).toBe(42)
    expect(result.triggers).toHaveLength(1)
    expect(result.report.schema).toBe(1)
  })

  it('keeps an unscored result null', async () => {
    installNative({ ...fullResult, suspectScore: null, suspectLevel: null })
    const result = await (await load({ apiKey: 'pk_test' })).identify({ submit: false })
    expect(result.suspectScore).toBeNull()
    expect(result.suspectLevel).toBeNull()
  })

  it('fills verdicts unavailable on the current native platform', async () => {
    installNative()
    const result = await (await load({ apiKey: 'pk_test' })).identify()
    expect(result.verdicts.jailbreak.value).toBe(true)
    expect(result.verdicts.root).toEqual({ value: false, confidence: 'low', reasons: [] })
    expect(result.verdicts.emulator.reasons).toEqual([])
  })
})

describe('collection and failures', () => {
  it('parses the report returned by collect', async () => {
    installNative()
    const report = await (await load({ apiKey: 'pk_test' })).collect()
    expect(report.schema).toBe(1)
  })

  it('preserves positive HTTP status codes', async () => {
    const native = installNative()
    native.identify.mockImplementation(
      (_tag: string | null, _submit: boolean, _success: Success, failure: Failure) => {
        failure(JSON.stringify({ code: '402', message: 'organisation disabled' }))
      },
    )
    const client = await load({ apiKey: 'pk_test' })
    await expect(client.identify()).rejects.toMatchObject({
      name: 'BadeleError',
      message: 'organisation disabled',
      status: 402,
    })
  })

  it('does not expose native sentinel codes as HTTP statuses', async () => {
    const native = installNative()
    native.collect.mockImplementation((_success: Success, failure: Failure) => {
      failure(JSON.stringify({ code: '-1', message: 'no report' }))
    })
    const client = await load({ apiKey: 'pk_test' })
    try {
      await client.collect()
      throw new Error('expected collect to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(BadeleError)
      expect((error as InstanceType<typeof BadeleError>).status).toBeUndefined()
    }
  })
})
