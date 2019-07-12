'use strict';

const url = require('url');
const debug = require('debug')('http');
const debugHeaders = require('debug')('http');

const parseUrl = function(source) {
  if (source.indexOf('http') !== 0 && source.indexOf('https') !== 0) {
    source = 'https://' + source;
  }

  let parsedUrl = url.parse(source);
  let port = parsedUrl.port;
  if (!port) {
    if (parsedUrl.protocol === 'https:') {
      port = '443';
    } else {
      port = '80';
    }
  }
  let secure = parsedUrl.protocol === 'https:' || parsedUrl.port === '443';

  return { host: parsedUrl.hostname, port: parseInt(port), secure: secure };
};

class Request {
  constructor(options) {
    this.options = options || {};
    this.debug = options.debug;
    this.debugHeaders = options.debugHeaders;
    this.path = options.path;
    this.token = options.token;
    this.sessionToken = options.sessionToken;
    this.userAgent = options.userAgent;
    this.logger = options.logger;
    this.fetchAll = options.fetchAll;

    let url = parseUrl(options.host || 'https://api.nimbu.io');
    this.host = url.host;
    this.port = url.port;
    this.secure = url.secure;

    if (!this.userAgent) {
      let packageJson = require('../package.json');
      this.userAgent = 'node-nimbu-client/' + packageJson.version;
    }

    this.parseJSON = options.hasOwnProperty('parseJSON') ? options.parseJSON : true;

    this.middleware =
      options.middleware ||
      function(_, fn) {
        fn();
      };

    this.certs = getCerts(this.debug);

    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });

    if (process.env.NIMBU_HTTP_PROXY_HOST) {
      let tunnel = require('tunnel-agent');
      let agent;

      if (this.secure) {
        agent = tunnel.httpsOverHttp;
      } else {
        agent = tunnel.httpOverHttp;
      }

      let agentOptions = {
        proxy: {
          host: process.env.NIMBU_HTTP_PROXY_HOST,
          port: process.env.NIMBU_HTTP_PROXY_PORT || 8080,
          proxyAuth: process.env.NIMBU_HTTP_PROXY_AUTH,
        },
        rejectUnauthorized: options.rejectUnauthorized,
      };

      if (this.certs.length > 0) {
        agentOptions.ca = this.certs;
      }

      this.agent = agent(agentOptions);
    } else {
      if (this.secure) {
        let https = require('https');
        this.agent = new https.Agent({
          maxSockets: Number(process.env.NIMBU_CLIENT_MAX_SOCKETS) || 4096,
        });
      } else {
        let http = require('http');
        this.agent = new http.Agent({
          maxSockets: Number(process.env.NIMBU_CLIENT_MAX_SOCKETS) || 4096,
        });
      }
    }
  }

  request() {
    let headers = Object.assign(
      {
        Authorization: this.token,
        Accept: 'application/json',
        'Content-type': 'application/json',
        'User-Agent': this.userAgent,
      },
      this.options.headers
    );

    if (this.sessionToken) {
      headers['X-Nimbu-Session-Token'] = this.sessionToken;
    }

    Object.keys(headers).forEach(k => {
      if (headers[k] == null) {
        delete headers[k];
      }
    });

    let requestOptions = {
      agent: this.agent,
      method: this.options.method || 'GET',
      host: this.host,
      port: this.port,
      path: this.path,
      auth: this.options.auth,
      headers: headers,
      rejectUnauthorized: this.options.rejectUnauthorized,
    };

    if (this.certs.length > 0) {
      requestOptions.ca = this.certs;
    }

    let request;
    if (this.secure) {
      let https = require('https');
      request = https.request(requestOptions, this.handleResponse.bind(this));
    } else {
      let http = require('http');
      request = http.request(requestOptions, this.handleResponse.bind(this));
    }

    this.logRequest(request, requestOptions);
    this.writeBody(request);
    this.setRequestTimeout(request);

    request.on('error', this.onError.bind(this));
    request.end();

    return this.promise;
  }

  handleResponse(res) {
    this.middleware(res, () => {
      this.logResponse(res);

      new Promise(resolve => {
        let chunks = [];
        res.on('data', data => chunks.push(data));
        res.on('end', () => resolve(chunks.join('')));
      })
        .then(data => {
          debug(`<-- ${this.options.method} ${this.path}\n${data}`);
          debugHeaders('\n' + sanitizeHeaders(res.headers));
          if (this.debug) console.log('<-- ' + data);
          if (res.statusCode.toString().match(/^2\d{2}$/)) {
            this.onSuccess(res, data);
          } else {
            this.onFailure(res, data);
          }
        })
        .catch(this.reject);
    });
  }

  onSuccess(res, buffer) {
    let body = this.parseBody(buffer);
    const regex = /<(https?:\/\/[^>]+)>;\s*rel="next"/;

    if (this.fetchAll && res.headers['link'] && regex.test(res.headers['link'])) {
      let matches = regex.exec(res.headers['link']);
      if (matches && matches[1]) {
        this.nextRequest(matches[1], body);
      }
    } else {
      this.updateAggregate(body);
      this.resolve(this.aggregate);
    }
  }

  nextRequest(nextUrl, body) {
    this.updateAggregate(body);

    nextUrl = url.parse(nextUrl);
    this.path = nextUrl.path;

    this.request();
  }

  updateAggregate(aggregate) {
    if (aggregate instanceof Array) {
      this.aggregate = this.aggregate || [];
      this.aggregate = this.aggregate.concat(aggregate);
    } else {
      this.aggregate = aggregate;
    }
  }

  writeBody(req) {
    if (this.options.body) {
      let body = this.options.body;

      if (this.options.json !== false) {
        body = JSON.stringify(body);
      }
      if (this.debug) {
        console.log('--> ' + body);
      }

      req.setHeader('Content-length', Buffer.byteLength(body, 'utf8'));
      req.write(body);
    } else {
      req.setHeader('Content-length', 0);
    }
  }

  parseBody(body) {
    if (this.parseJSON) {
      return JSON.parse(body || '{}');
    } else {
      return body;
    }
  }

  onError(error) {
    if (!this.retries) this.retries = 0;
    if (this.retries >= 4 || !this.isRetryAllowed(error)) {
      return this.reject(error);
    }
    let randomDelay = Math.random() * 100;
    setTimeout(() => this.request(), (1 << this.retries) * 1000 + randomDelay);
    this.retries++;
  }

  isRetryAllowed(error) {
    const isRetryAllowed = require('is-retry-allowed');
    if (!isRetryAllowed(error)) return false;
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return false;
    }
    return true;
  }

  onFailure(res, buffer) {
    let message = 'Expected response to be ok, but got ' + res.statusCode;
    let err;

    err = new Error(message);
    err.statusCode = res.statusCode;
    try {
      err.body = this.parseBody(buffer);
    } catch (e) {
      err.body = buffer;
    }

    this.reject(err);
  }

  setRequestTimeout(req) {
    if (this.options.timeout) {
      req.setTimeout(this.options.timeout, () => {
        let err = new Error('Request took longer than ' + this.options.timeout + 'ms to complete.');

        req.abort();

        this.reject(err);
      });
    }
  }

  logRequest(req, reqOptions) {
    debug(`--> ${reqOptions.method} ${req.path}`);
    if (this.debug) console.log('--> ' + reqOptions.method + ' ' + req.path);
    if (!req.getHeaders()) return;

    let headers = sanitizeHeaders(req.getHeaders());
    debugHeaders('\n' + headers);
    if (this.debugHeaders) console.log(headers);
  }

  logResponse(res) {
    if (this.logger) {
      this.logger.log({
        status: res.statusCode,
        content_length: res.headers['content-length'],
        request_id: res.headers['request-id'],
      });
    }
    let headers = sanitizeHeaders(res.headers);
    if (this.debug) {
      console.log('<-- ' + res.statusCode);
    }
    if (this.debugHeaders) console.log(headers);
  }
}

function sslCertFile() {
  return process.env.SSL_CERT_FILE ? [process.env.SSL_CERT_FILE] : [];
}

function sslCertDir() {
  let sslCertDir = process.env.SSL_CERT_DIR;
  if (sslCertDir) {
    let path = require('path');
    let fs = require('fs');
    return fs
      .readdirSync(sslCertDir)
      .map(f => path.join(sslCertDir, f))
      .filter(f => fs.statSync(f).isFile());
  } else {
    return [];
  }
}

function getCerts(debug) {
  let certs = sslCertFile().concat(sslCertDir());

  if (certs.length > 0 && debug) {
    console.log('Adding the following trusted certificate authorities');
  }

  return certs.map(function(cert) {
    let fs = require('fs');
    if (debug) {
      console.log('  ' + cert);
    }
    return fs.readFileSync(cert);
  });
}

function sanitizeHeaders(headers) {
  return Object.keys(headers)
    .map(key => {
      let k = key.toUpperCase();
      let value =
        k === 'AUTHORIZATION' || k === 'X-NIMBU-SESSION-TOKEN' ? 'REDACTED' : headers[key];
      return '  ' + key + '=' + value;
    })
    .join('\n');
}

module.exports = Request;
