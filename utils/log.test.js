import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BASE64_LOG_PREVIEW_LENGTH,
  createDebugSanitizingLogger,
  truncateBase64ForLog
} from './log.js'

test('truncates Base64 data URIs in serialized request logs', () => {
  const base64 = 'A'.repeat(200)
  const input = `openai request: {"url":"data:image/png;base64,${base64}"}`

  assert.equal(
    truncateBase64ForLog(input),
    `openai request: {"url":"data:image/png;base64,${'A'.repeat(BASE64_LOG_PREVIEW_LENGTH)}..."}`
  )
})

test('truncates raw Base64 image and data fields used by LLM adapters', () => {
  const base64 = 'aGVsbG8/'.repeat(20)
  const input = JSON.stringify({ image: base64, inlineData: { data: base64 }, text: base64 })
  const output = truncateBase64ForLog(input)

  assert.match(output, new RegExp(`"image":"${base64.slice(0, BASE64_LOG_PREVIEW_LENGTH)}\\.\\.\\."`))
  assert.match(output, new RegExp(`"data":"${base64.slice(0, BASE64_LOG_PREVIEW_LENGTH)}\\.\\.\\."`))
  assert.ok(output.includes(`"text":"${base64}"`))
})

test('does not truncate short Base64 values', () => {
  const input = '{"data":"aGVsbG8="}'
  assert.equal(truncateBase64ForLog(input), input)
})

test('sanitizes debug logs without changing other log levels or the original value', () => {
  const calls = []
  const baseLogger = {
    debug: (...args) => calls.push(['debug', ...args]),
    info: (...args) => calls.push(['info', ...args])
  }
  const wrappedLogger = createDebugSanitizingLogger(baseLogger)
  const message = `{"data":"${'Z'.repeat(100)}"}`

  wrappedLogger.debug(message, 'plain')
  wrappedLogger.info(message)

  assert.equal(message, `{"data":"${'Z'.repeat(100)}"}`)
  assert.equal(calls[0][1], `{"data":"${'Z'.repeat(BASE64_LOG_PREVIEW_LENGTH)}..."}`)
  assert.equal(calls[0][2], 'plain')
  assert.equal(calls[1][1], message)
})
