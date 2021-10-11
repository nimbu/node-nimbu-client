import { Request, RequestOptions } from './request'

export { HTTPError, Request, RequestOptions } from './request'

export class Nimbu {
  options: RequestOptions

  constructor(options?: RequestOptions) {
    this.options = options || {}
  }

  get<T = any>(path: string, options?: RequestOptions) {
    return this.request<T>(Object.assign({}, options, { method: 'GET', path: path }))
  }

  put<T = any>(path: string, options?: RequestOptions) {
    return this.request<T>(Object.assign({}, options, { method: 'PUT', path: path }))
  }

  post<T = any>(path: string, options?: RequestOptions) {
    return this.request<T>(Object.assign({}, options, { method: 'POST', path: path }))
  }

  patch<T = any>(path: string, options?: RequestOptions) {
    return this.request<T>(Object.assign({}, options, { method: 'PATCH', path: path }))
  }

  delete<T = any>(path: string, options?: RequestOptions) {
    return this.request<T>(Object.assign({}, options, { method: 'DELETE', path: path }))
  }

  request<T = any>(options: RequestOptions) {
    options = options || {}
    options.headers = Object.assign(Object.assign({}, this.options.headers), options.headers)
    options = Object.assign({}, this.options, options)
    let request = new Request<T>(options)
    return request.request()
  }
}

export default Nimbu
