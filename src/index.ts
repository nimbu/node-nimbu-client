import { Request as NimbuRequest, RequestOptions } from './request'

export const Request = NimbuRequest

export class Nimbu {
  options: RequestOptions

  constructor(options?: RequestOptions) {
    this.options = options || {}
  }

  get(path: string, options?: RequestOptions) {
    return this.request(Object.assign({}, options, { method: 'GET', path: path }))
  }

  put(path: string, options?: RequestOptions) {
    return this.request(Object.assign({}, options, { method: 'PUT', path: path }))
  }

  post(path: string, options?: RequestOptions) {
    return this.request(Object.assign({}, options, { method: 'POST', path: path }))
  }

  patch(path: string, options?: RequestOptions) {
    return this.request(Object.assign({}, options, { method: 'PATCH', path: path }))
  }

  delete(path: string, options?: RequestOptions) {
    return this.request(Object.assign({}, options, { method: 'DELETE', path: path }))
  }

  request(options: RequestOptions) {
    options = options || {}
    options.headers = Object.assign(Object.assign({}, this.options.headers), options.headers)
    options = Object.assign({}, this.options, options)
    let request = new Request(options)
    return request.request()
  }
}

export default Nimbu
