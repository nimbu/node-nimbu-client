import nock from 'nock'
import Nimbu from '../src/index'

let nimbu = new Nimbu()

beforeAll(() => {
  nock.disableNetConnect()
})

test('allow to specify a site id', async () => {
  let api = nock('https://api.nimbu.io', {
    reqheaders: {
      'X-Nimbu-Site': 'foo',
      'X-Nimbu-Client-Version': 'v1.2.3',
    },
  })
    .get('/channels')
    .reply(200, [{ name: 'foo' }])

  const channels = await new Nimbu({ site: 'foo', clientVersion: 'v1.2.3' }).get('/channels')

  expect(channels[0].name).toEqual('foo')
  expect(api.isDone()).toBe(true)
})

test('allow to specify the user agent', async () => {
  let api = nock('https://api.nimbu.io', {
    reqheaders: {
      'User-Agent': 'foo',
    },
  })
    .get('/channels')
    .reply(200, [{ name: 'foo' }])

  const channels = await new Nimbu({ userAgent: 'foo' }).get('/channels')

  expect(channels[0].name).toEqual('foo')
  expect(api.isDone()).toBe(true)
})

test('get /channels', async () => {
  let api = nock('https://api.nimbu.io')
    .get('/channels')
    .reply(200, [{ name: 'foo' }])

  const channels = await nimbu.get('/channels')

  expect(channels[0].name).toEqual('foo')
  expect(api.isDone()).toBe(true)
})

test('get /channels with pagination', async () => {
  let api1 = nock('https://api.nimbu.io')
    .get('/channels')
    .reply(200, [{ name: 'foo' }], {
      Link: '<https://api.nimbu.io/channels?page=2>; rel="next", <https://api.nimbu.io/channels?page=2>; rel="last"',
    })

  let api2 = nock('https://api.nimbu.io')
    .get('/channels')
    .query({ page: 2 })
    .reply(200, [{ name: 'bar' }], {
      Link: '<https://api.nimbu.io/channels?page=1>; rel="prev", <https://api.nimbu.io/channels?page=1>; rel="first"',
    })

  const channels = await nimbu.get('/channels', { fetchAll: true })

  expect(channels[0].name).toEqual('foo')
  expect(channels[1].name).toEqual('bar')
  expect(api1.isDone() && api2.isDone()).toBe(true)
})

test('post /channels', () => {
  let api = nock('https://api.nimbu.io').post('/channels', { name: 'foo' }).reply(201)

  return nimbu.post('/channels', { body: { name: 'foo' } }).then(() => expect(api.isDone()).toBe(true))
})

test('patch /channels', async () => {
  let api = nock('https://api.nimbu.io').patch('/channels', { name: 'foo' }).reply(201)

  await nimbu.patch('/channels', { body: { name: 'foo' } })
  expect(api.isDone()).toBe(true)
})

test('put /channels', async () => {
  let api = nock('https://api.nimbu.io').put('/channels', { name: 'foo' }).reply(201)

  await nimbu.put('/channels', { body: { name: 'foo' } })
  expect(api.isDone()).toBe(true)
})

test('delete /channels', () => {
  let api = nock('https://api.nimbu.io').delete('/channels', { name: 'foo' }).reply(201)

  return nimbu.delete('/channels', { body: { name: 'foo' } }).then(() => expect(api.isDone()).toBe(true))
})

test('non-https', async () => {
  let api = nock('http://api.nimbu.io')
    .get('/channels')
    .reply(200, [{ name: 'foo' }])

  const channels = await nimbu.get('/channels', { host: 'http://api.nimbu.io' })

  expect(channels[0].name).toEqual('foo')
  expect(api.isDone()).toBe(true)
})

describe('is-retry-allowed', () => {
  const mockFn = jest.fn(() => true)
  jest.mock('is-retry-allowed', () => mockFn)

  test('should not retry on 404s', async () => {
    try {
      // will error with a 404
      await nimbu.get('/channels')
    } catch {}

    expect(mockFn).toHaveBeenCalled()
  })
})
