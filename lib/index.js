'use strict';

class Nimbu {
  constructor(options) {
    this.options = options || {};
  }

  get(path, options) {
    return this.request(Object.assign({}, options, { method: 'GET', path: path }));
  }

  put(path, options) {
    return this.request(Object.assign({}, options, { method: 'PUT', path: path }));
  }

  post(path, options) {
    return this.request(Object.assign({}, options, { method: 'POST', path: path }));
  }

  patch(path, options) {
    return this.request(Object.assign({}, options, { method: 'PATCH', path: path }));
  }

  delete(path, options) {
    return this.request(Object.assign({}, options, { method: 'DELETE', path: path }));
  }

  request(options) {
    var Request = require('./request');

    options = options || {};
    options.headers = Object.assign(Object.assign({}, this.options.headers), options.headers);
    options = Object.assign({}, this.options, options);
    let request = new Request(options);
    return request.request();
  }
}

module.exports = Nimbu;
