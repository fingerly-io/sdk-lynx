'background only'

import { useState } from '@lynx-js/react'
import { load, nativeVersion } from '@badele/lynx'

export function App() {
  const [output, setOutput] = useState('Ready')

  const identify = async () => {
    try {
      const badele = await load({ apiKey: 'pk_test_replace_me' })
      const result = await badele.identify({ tag: 'lynx-example' })
      setOutput(`${result.requestId} · score ${result.suspectScore ?? 'unscored'}`)
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  const collect = async () => {
    try {
      const badele = await load({ apiKey: 'pk_test_replace_me' })
      const report = await badele.collect()
      setOutput(`${Object.keys(report.sources).length} sources · native ${nativeVersion() ?? '?'}`)
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <view>
      <text>@badele/lynx</text>
      <text bindtap={identify}>Identify</text>
      <text bindtap={collect}>Collect</text>
      <text>{output}</text>
    </view>
  )
}
