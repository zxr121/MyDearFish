/**
 * Prepare plugin-contributed request fields and commit their delivery after HTTP acceptance.
 * Serialized payloads replace unpaired surrogate escapes, so stored history that split a
 * surrogate pair across stream chunks cannot make a strict provider JSON parser reject the request.
 */

import { errorChain, LlmError } from '@deepseek-ai/dsh-llm'
import type { DeepSeekLlmApiExtensionRequest, PreparedDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import type { DeepSeekAdapterOptions } from './types.ts'

/**
 * Replace unpaired surrogate escapes in serialized JSON with U+FFFD.
 * `JSON.stringify` writes a valid pair as its two code units and an unpaired surrogate as a
 * `\uXXXX` escape, so only the escaped form needs repair while escaped backslashes stay literal.
 * @param json - serialized request payload.
 * @returns the payload text with every unpaired surrogate escape replaced by `\ufffd`.
 */
function repairLoneSurrogates(json: string): string {
  if (!json.includes('\\u')) return json
  let out = ''
  let copied = 0
  for (let index = 0; index < json.length; index++) {
    if (json.charCodeAt(index) !== 0x5c) continue
    if (json[index + 1] !== 'u') {
      index += 1
      continue
    }
    const hex = json.slice(index + 2, index + 6)
    if (!/^[0-9a-fA-F]{4}$/u.test(hex)) continue
    const unit = Number.parseInt(hex, 16)
    if (unit >= 0xd800 && unit <= 0xdfff) {
      const pair = json.slice(index + 6, index + 12)
      if (unit <= 0xdbff && /^\\u[dD][c-fC-F][0-9a-fA-F]{2}$/u.test(pair)) {
        index += 11
        continue
      }
      out += `${json.slice(copied, index)}\\ufffd`
      copied = index + 6
      index += 5
      continue
    }
    index += 5
  }
  return copied === 0 ? json : out + json.slice(copied)
}

/**
 * Merge contributions without replacing Messages fields. A rejected preparation or
 * a base-field collision reports REQUEST_EXTENSION with the cause chain appended to
 * the message. When the merged request fails to serialize, the payload is the
 * base request alone and acceptance is a no-op, so contributors resend their
 * unaccepted state on a later request. An acceptance failure is reported and
 * does not fail the request.
 * @param body - serialized Messages request before extension fields.
 * @param options - request identity, purpose, and cancellation.
 * @param prepare - contributor registry captured for this adapter.
 * @param onOmitted - receives the omitted field names and the serialization failure.
 * @param onUnaccepted - receives an acceptance failure after HTTP 2xx.
 * @returns HTTP payload and a commit to invoke only after a successful HTTP response.
 */
export async function prepareRequestExtensions(
  body: DeepSeekLlmApiExtensionRequest['body'],
  options: Omit<DeepSeekLlmApiExtensionRequest, 'body'>,
  prepare: DeepSeekAdapterOptions['prepareExtensions'],
  onOmitted: (fields: readonly string[], error: unknown) => void,
  onUnaccepted: (error: unknown) => void,
): Promise<{ payload: string; accept(): Promise<void> }> {
  let extensions: PreparedDeepSeekLlmApiExtensions
  try {
    extensions = await prepare({ body, ...options })
  } catch (error) {
    throw new LlmError(`DeepSeek request extension preparation failed: ${errorChain(error)}`, 'REQUEST_EXTENSION', { cause: error })
  }
  const fields = Object.keys(extensions.fields)
  for (const field of fields) {
    if (Object.hasOwn(body, field)) {
      throw new LlmError(`DeepSeek request extension field ${JSON.stringify(field)} collides with the base request`, 'REQUEST_EXTENSION')
    }
  }
  let payload: string
  try {
    payload = repairLoneSurrogates(JSON.stringify({ ...body, ...extensions.fields }))
  } catch (error) {
    // A base request that cannot serialize throws here, before any field is reported as omitted.
    const base = repairLoneSurrogates(JSON.stringify(body))
    onOmitted(fields, error)
    return { payload: base, accept: () => Promise.resolve() }
  }
  return {
    payload,
    async accept() {
      try {
        await extensions.accept()
      } catch (error) {
        onUnaccepted(error)
      }
    },
  }
}
