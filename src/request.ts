import { URL } from 'url'
import Debug from 'debug'
import * as http from 'http'
import * as https from 'https'

const debug = Debug('http')
const debugHeaders = Debug('http')

const parseUrl = function (source: string) {
  if (source.indexOf('http') !== 0 && source.indexOf('https') !== 0) {
    source = 'https://' + source
  }

  let parsedUrl = new URL(source)
  let port = parsedUrl.port
  if (!port) {
    if (parsedUrl.protocol === 'https:') {
      port = '443'
    } else {
      port = '80'
    }
  }
  let secure = parsedUrl.protocol === 'https:' || parsedUrl.port === '443'

  return { host: parsedUrl.hostname, port: parseInt(port), secure: secure }
}

export class HTTPError extends Error {
  body?: any
  statusCode?: number
}

export type RequestOptions = {
  auth?: string
  body?: any
  clientVersion?: string
  debug?: boolean
  debugHeaders?: boolean
  fetchAll?: boolean
  headers?: http.OutgoingHttpHeaders
  host?: string
  json?: boolean
  logger?: any
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  middleware?: (response: any, fn: () => void) => void
  onNextPage?: (nextPage: string, lastPage: string) => void
  parseJSON?: boolean
  path?: string
  rejectUnauthorized?: boolean
  sessionToken?: string
  site?: string
  timeout?: number
  token?: string
  userAgent?: string
}

type BaseType<T> = T extends Array<infer U> ? U : T
type PossibleArray<U> = U | Array<U>

export class Request<T = any> {
  options: RequestOptions

  debug: boolean = false
  debugHeaders: boolean = false
  path?: string | null
  token?: string
  sessionToken?: string
  site?: string
  userAgent?: string
  clientVersion?: string
  logger?: any
  fetchAll: boolean = false
  parseJSON?: boolean
  host: string | null
  port?: number
  secure?: boolean
  certs: string[]
  promise: Promise<T>
  resolve: (value: T) => void = () => {}
  reject: (reason?: any) => void = () => {}
  middleware: (response: http.IncomingMessage, fn: () => void) => void

  onNextPage?: (nextPage: string, lastPage: string) => void
  agent?: http.Agent | https.Agent
  aggregate?: T
  retries?: number

  constructor(options: RequestOptions) {
    this.options = options || {}
    this.debug = options.debug ?? false
    this.debugHeaders = options.debugHeaders ?? false
    this.path = options.path
    this.token = options.token
    this.sessionToken = options.sessionToken
    this.site = options.site
    this.userAgent = options.userAgent
    this.clientVersion = options.clientVersion
    this.logger = options.logger
    this.fetchAll = options.fetchAll ?? true
    this.onNextPage = options.onNextPage

    let url = parseUrl(options.host || 'https://api.nimbu.io')
    this.host = url.host
    this.port = url.port
    this.secure = url.secure

    if (!this.userAgent) {
      let packageJson = require('../package.json')
      this.userAgent = 'node-nimbu-client/' + packageJson.version
    }

    this.parseJSON = options.hasOwnProperty('parseJSON') ? options.parseJSON : true

    this.middleware =
      options.middleware ||
      function (_, fn) {
        fn()
      }

    this.certs = getCerts(this.debug)

    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })

    if (process.env.NIMBU_HTTP_PROXY_HOST) {
      let tunnel = require('tunnel-agent')
      let agent: any

      if (this.secure) {
        agent = tunnel.httpsOverHttp
      } else {
        agent = tunnel.httpOverHttp
      }

      let agentOptions: any = {
        proxy: {
          host: process.env.NIMBU_HTTP_PROXY_HOST,
          port: process.env.NIMBU_HTTP_PROXY_PORT || 8080,
          proxyAuth: process.env.NIMBU_HTTP_PROXY_AUTH,
        },
        rejectUnauthorized: options.rejectUnauthorized,
      }

      if (this.certs.length > 0) {
        agentOptions.ca = this.certs
      }

      this.agent = agent(agentOptions)
    } else {
      if (this.secure) {
        this.agent = new https.Agent({
          maxSockets: Number(process.env.NIMBU_CLIENT_MAX_SOCKETS) || 4096,
        })
      } else {
        this.agent = new http.Agent({
          maxSockets: Number(process.env.NIMBU_CLIENT_MAX_SOCKETS) || 4096,
        })
      }
    }
  }

  request() {
    let defaultHeaders: http.OutgoingHttpHeaders = {
      Accept: 'application/json',
      'Content-type': 'application/json',
      'User-Agent': this.userAgent,
    }

    if (this.token) {
      defaultHeaders['Authorization'] = this.token
    }

    if (this.clientVersion) {
      defaultHeaders['X-Nimbu-Client-Version'] = this.clientVersion
    }

    if (this.site) {
      defaultHeaders['X-Nimbu-Site'] = this.site
    }

    let headers = Object.assign(defaultHeaders, this.options.headers)

    if (this.sessionToken) {
      headers['X-Nimbu-Session-Token'] = this.sessionToken
    }

    Object.keys(headers).forEach((k) => {
      if (headers[k] == null) {
        delete headers[k]
      }
    })

    let requestOptions: https.RequestOptions = {
      agent: this.agent,
      method: this.options.method || 'GET',
      host: this.host,
      port: this.port,
      path: this.path,
      auth: this.options.auth,
      headers: headers,
      rejectUnauthorized: this.options.rejectUnauthorized,
    }

    if (this.certs.length > 0) {
      requestOptions.ca = this.certs
    }

    let request: http.ClientRequest
    if (this.secure) {
      request = https.request(requestOptions, this.handleResponse.bind(this))
    } else {
      request = http.request(requestOptions, this.handleResponse.bind(this))
    }

    this.logRequest(request, requestOptions)
    this.writeBody(request)
    this.setRequestTimeout(request)

    request.on('error', this.onError.bind(this))
    request.end()

    return this.promise
  }

  handleResponse(res: http.IncomingMessage) {
    this.middleware(res, () => {
      this.logResponse(res)

      new Promise((resolve) => {
        let chunks: any = []
        res.on('data', (data) => chunks.push(data))
        res.on('end', () => resolve(chunks.join('')))
      })
        .then((data) => {
          debug(`<-- ${this.options.method} ${this.path}`)
          debugHeaders('\n' + sanitizeHeaders(res.headers) + '\n')
          debug(`<-- ${data}`)
          if (this.debug) console.log('<-- ' + data)
          if (res.statusCode != null && res.statusCode.toString().match(/^2\d{2}$/)) {
            this.onSuccess(res, data)
          } else {
            this.onFailure(res, data)
          }
        })
        .catch(this.reject)
    })
  }

  onSuccess(res: http.IncomingMessage, buffer: any) {
    let body = this.parseBody(buffer)
    const nextRegex = /<(https?:\/\/[^>]+)>;\s*rel="next"/
    const lastRegex = /<(https?:\/\/[^>]+)>;\s*rel="last"/
    const pageNbRegex = /page=([0-9]+)/
    const linkHeaders = res.headers['link']

    if (
      this.fetchAll &&
      linkHeaders &&
      typeof linkHeaders === 'string' &&
      nextRegex.test(linkHeaders) &&
      lastRegex.test(linkHeaders)
    ) {
      let matches = nextRegex.exec(linkHeaders)
      if (matches && matches[1]) {
        let nextUrl = matches[1]
        if (this.onNextPage && this.onNextPage instanceof Function) {
          let lastPageUrlRegexResult = lastRegex.exec(linkHeaders)
          let lastPageUrl = lastPageUrlRegexResult != null ? lastPageUrlRegexResult[1] : null

          if (lastPageUrl != null) {
            let nextPageRegexResult = pageNbRegex.exec(nextUrl)
            let nextPage = nextPageRegexResult != null ? nextPageRegexResult[1] : null
            let lastPageRegexResult = pageNbRegex.exec(lastPageUrl)
            let lastPage = lastPageRegexResult != null ? lastPageRegexResult[1] : null

            if (nextPage != null && lastPage != null) {
              this.onNextPage(nextPage, lastPage)
            }
          }
        }
        this.nextRequest(nextUrl, body)
      }
    } else {
      this.updateAggregate(body)
      this.resolve(this.aggregate!)
    }
  }

  nextRequest(nextUrl: string, body: any) {
    this.updateAggregate(body)

    const nextUrlParsed = new URL(nextUrl)
    this.path = nextUrlParsed.pathname + nextUrlParsed.search

    this.request()
  }

  updateAggregate(aggregate: T) {
    if (Array.isArray(aggregate)) {
      this.aggregate = (this.aggregate ?? []) as T
      this.aggregate = (this.aggregate as any).concat(aggregate) as T
    } else {
      this.aggregate = aggregate
    }
  }

  writeBody(req: http.ClientRequest) {
    if (this.options.body) {
      let body = this.options.body

      if (this.options.json !== false) {
        body = JSON.stringify(body)
      }

      if (this.debug) {
        console.log('--> ' + body)
      }

      req.setHeader('Content-length', Buffer.byteLength(body, 'utf8'))
      req.write(body)
    } else {
      req.setHeader('Content-length', 0)
    }
  }

  parseBody(body: any) {
    if (this.parseJSON) {
      return JSON.parse(body || '{}')
    } else {
      return body
    }
  }

  onError(error: Error) {
    if (!this.retries) this.retries = 0
    if (this.retries >= 4 || !this.isRetryAllowed(error)) {
      return this.reject(error)
    }
    let randomDelay = Math.random() * 100
    setTimeout(() => this.request(), (1 << this.retries) * 1000 + randomDelay)
    this.retries++
  }

  isRetryAllowed(error) {
    const isRetryAllowed = require('is-retry-allowed')
    if (!isRetryAllowed(error)) return false
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return false
    }
    return true
  }

  onFailure(res: http.IncomingMessage, buffer: any) {
    let message = 'Expected response to be ok, but got ' + res.statusCode
    let err: HTTPError

    err = new HTTPError(message)
    err.statusCode = res.statusCode
    try {
      err.body = this.parseBody(buffer)
    } catch (e) {
      err.body = buffer
    }

    this.reject(err)
  }

  setRequestTimeout(req: http.ClientRequest) {
    if (this.options.timeout) {
      req.setTimeout(this.options.timeout, () => {
        let err = new Error('Request took longer than ' + this.options.timeout + 'ms to complete.')

        req.abort()

        this.reject(err)
      })
    }
  }

  logRequest(req: http.ClientRequest, reqOptions: https.RequestOptions) {
    debug(`--> ${reqOptions.method} ${req.path}`)
    if (this.debug) console.log('--> ' + reqOptions.method + ' ' + req.path)
    let headers = req.getHeaders()
    if (!headers) return

    const headersForDebugging = sanitizeHeaders(headers)
    debugHeaders('\n' + headersForDebugging + '\n')
    if (this.debugHeaders) console.log(headersForDebugging)
  }

  logResponse(res: http.IncomingMessage) {
    if (this.logger) {
      this.logger.log({
        status: res.statusCode,
        content_length: res.headers['content-length'],
        request_id: res.headers['request-id'],
      })
    }
    let headers = sanitizeHeaders(res.headers)
    if (this.debug) {
      console.log('<-- ' + res.statusCode)
    }
    if (this.debugHeaders) console.log(headers)
  }
}

function sslCertFile() {
  return process.env.SSL_CERT_FILE ? [process.env.SSL_CERT_FILE] : []
}

function sslCertDir() {
  let sslCertDir = process.env.SSL_CERT_DIR
  if (sslCertDir) {
    let path = require('path')
    let fs = require('fs')
    return fs
      .readdirSync(sslCertDir)
      .map((f: string) => path.join(sslCertDir, f))
      .filter((f: string) => fs.statSync(f).isFile())
  } else {
    return []
  }
}

function getCerts(debug = false) {
  let certs = sslCertFile().concat(sslCertDir())

  if (certs.length > 0 && debug) {
    console.log('Adding the following trusted certificate authorities')
  }

  return certs.map(function (cert) {
    let fs = require('fs')
    if (debug) {
      console.log('  ' + cert)
    }
    return fs.readFileSync(cert)
  })
}

function sanitizeHeaders(headers: http.OutgoingHttpHeaders) {
  return Object.keys(headers)
    .map((key) => {
      let k = key.toUpperCase()
      let value = k === 'AUTHORIZATION' || k === 'X-NIMBU-SESSION-TOKEN' ? 'REDACTED' : headers[key]
      return '  ' + key + '=' + value
    })
    .join('\n')
}

export default Request
