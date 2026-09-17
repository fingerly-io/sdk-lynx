'background only'

import { useState } from '@lynx-js/react'
import { load, nativeVersion } from '@fingerly/lynx'

export function App() {
  const [output, setOutput] = useState('Ready')

  const identify = async () => {
    try {
      const fingerly = await load({ apiKey: 'fly_pk_us_development_replace_me' })
      const result = await fingerly.identify({ tag: 'lynx-example' })
      setOutput(`${result.requestId} · score ${result.suspectScore ?? 'unscored'}`)
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  const collect = async () => {
    try {
      const fingerly = await load({ apiKey: 'fly_pk_us_development_replace_me' })
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
