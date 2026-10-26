// 本机 API 的统一防护：只回环、同源、无 CORS、JSON 头校验、体积上限。
// 路由处理函数只负责业务，鉴权与序列化都在这里。

export const API_PREFIX = '/api/agent-new-media-studio'
export const API_HEADER = 'x-agent-new-media-studio-request'
const MAX_JSON_BYTES = 1024 * 1024

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function isLoopback(req) {
  const address = req.socket?.remoteAddress || ''
  return LOOPBACK.has(address)
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(payload)
}

export function fail(res, status, code, message) {
  return sendJson(res, status, { ok: false, error: { code, message } })
}

/** 读 JSON body：限制字节数，拒绝非 JSON content-type。 */
export function readJsonBody(req, limit = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '')
    if (!type.toLowerCase().startsWith('application/json')) {
      reject(Object.assign(new Error('请求必须是 application/json'), { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' }))
      return
    }
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413, code: 'PAYLOAD_TOO_LARGE' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(Object.assign(new Error('请求体必须是 JSON 对象'), { status: 400, code: 'INVALID_BODY' }))
          return
        }
        resolve(parsed)
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400, code: 'INVALID_JSON' }))
      }
    })
  })
}

/**
 * 写操作校验：必须带自定义头（跨站表单做不到），且 Content-Type 为 JSON。
 * UI 在 fetch 里显式带这个头；模型工具表里没有任何写审批入口。
 */
export function assertWritable(req) {
  if (req.method !== 'POST') return { ok: false, status: 405, code: 'METHOD_NOT_ALLOWED', message: '只接受 POST' }
  if (req.headers[API_HEADER] !== '1') {
    return { ok: false, status: 403, code: 'MISSING_REQUEST_HEADER', message: '缺少工作台请求头' }
  }
  return { ok: true }
}

/** 只保留错误类型和代码，绝不把堆栈或绝对路径回显给界面。 */
export function publicError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'INTERNAL',
    message: typeof error?.expose === 'string' ? error.expose : '操作失败，稍后再试',
  }
}

export function queryOf(req) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  return url.searchParams
}
