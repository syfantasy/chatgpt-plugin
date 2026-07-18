export const BASE64_LOG_PREVIEW_LENGTH = 64

const BASE64_DATA_URI_PATTERN = /(data:[\w.+-]+\/[\w.+-]+(?:;[\w.+-]+=[^;,"\s]+)*;base64,)([A-Za-z0-9+/_-]+={0,2})/gi
const BASE64_JSON_FIELD_PATTERN = /("(?:data|image)"\s*:\s*")([A-Za-z0-9+/_-]+={0,2})(")/gi

function truncateMatch (prefix, base64, suffix = '') {
  if (base64.length <= BASE64_LOG_PREVIEW_LENGTH) {
    return `${prefix}${base64}${suffix}`
  }
  return `${prefix}${base64.slice(0, BASE64_LOG_PREVIEW_LENGTH)}...${suffix}`
}

/**
 * Shorten Base64 payloads in an already serialized log message.
 * This only changes the displayed string; the original request object is untouched.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function truncateBase64ForLog (value) {
  if (typeof value !== 'string') return value

  return value
    .replace(BASE64_DATA_URI_PATTERN, (_, prefix, base64) => truncateMatch(prefix, base64))
    .replace(BASE64_JSON_FIELD_PATTERN, (_, prefix, base64, suffix) => truncateMatch(prefix, base64, suffix))
}

/**
 * Wrap a logger so only debug output is sanitized.
 * Other methods and logger-specific helpers remain available through the proxy.
 *
 * @param {object} baseLogger
 * @returns {object}
 */
export function createDebugSanitizingLogger (baseLogger) {
  return new Proxy(baseLogger, {
    get (target, property, receiver) {
      if (property === 'debug' && typeof target.debug === 'function') {
        return (...args) => target.debug.apply(target, args.map(truncateBase64ForLog))
      }

      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
