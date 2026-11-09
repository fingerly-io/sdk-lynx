'background only'

import { useState } from '@lynx-js/react'
import { load, nativeVersion } from '@fingerly/lynx'

// The example's own developer has agreed. A real app loads with the default
// 'pending' and calls setConsent('granted') once its consent tool says yes.
const options = { apiKey: 'fly_pk_development_replace_me', consent: 'granted' } as const

export function App() {
  const [output, setOutput] = useState('Ready')

  const identify = async () => {
    try {
      const fingerly = await load(options)
      const result = await fingerly.identify({ tag: 'lynx-example' })
      setOutput(`${result.requestId} · score ${result.suspectScore ?? 'unavailable'}`)
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  const collect = async () => {
    try {
      const fingerly = await load(options)
      const report = await fingerly.collect()
      setOutput(`${Object.keys(report.sources).length} sources · native ${nativeVersion() ?? '?'}`)
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <view>
      <text>@fingerly/lynx</text>
      <text bindtap={identify}>Identify</text>
      <text bindtap={collect}>Collect</text>
      <text>{output}</text>
    </view>
  )
}
