'use strict';

import test from 'ava';
import nock from 'nock';
import Nimbu from '.';

let nimbu = new Nimbu();

test.before(() => {
  nock.disableNetConnect();
});

test('get /channels', t => {
  let api = nock('https://api.nimbu.io')
    .get('/channels')
    .reply(200, [{ name: 'foo' }]);

  return nimbu
    .get('/channels')
    .then(channels => {
      t.is(channels[0].name, 'foo');
    })
    .then(() => t.true(api.isDone()));
});

test('get /channels with pagination', t => {
  let api1 = nock('https://api.nimbu.io')
    .get('/channels')
    .reply(200, [{ name: 'foo' }], {
      Link:
        '<https://api.nimbu.io/channels?page=2>; rel="next", <https://api.nimbu.io/channels?page=2>; rel="last"',
    });

  let api2 = nock('https://api.nimbu.io')
    .get('/channels')
    .query({ page: 2 })
    .reply(200, [{ name: 'bar' }], {
      Link:
        '<https://api.nimbu.io/channels?page=1>; rel="prev", <https://api.nimbu.io/channels?page=1>; rel="first"',
    });

  return nimbu
    .get('/channels', { fetchAll: true })
    .then(channels => {
      t.is(channels[0].name, 'foo');
      t.is(channels[1].name, 'bar');
    })
    .then(() => t.true(api1.isDone() && api2.isDone()));
});

test('post /channels', t => {
  let api = nock('https://api.nimbu.io')
    .post('/channels', { name: 'foo' })
    .reply(201);

  return nimbu.post('/channels', { body: { name: 'foo' } }).then(() => t.true(api.isDone()));
});

test('patch /channels', t => {
  let api = nock('https://api.nimbu.io')
    .patch('/channels', { name: 'foo' })
    .reply(201);

  return nimbu.patch('/channels', { body: { name: 'foo' } }).then(() => t.true(api.isDone()));
});

test('put /channels', t => {
  let api = nock('https://api.nimbu.io')
    .put('/channels', { name: 'foo' })
    .reply(201);

  return nimbu.put('/channels', { body: { name: 'foo' } }).then(() => t.true(api.isDone()));
});

test('delete /channels', t => {
  let api = nock('https://api.nimbu.io')
    .delete('/channels', { name: 'foo' })
    .reply(201);

  return nimbu.delete('/channels', { body: { name: 'foo' } }).then(() => t.true(api.isDone()));
});

test('non-https', t => {
  let api = nock('http://api.nimbu.io')
    .get('/channels')
    .reply(200, [{ name: 'foo' }]);

  return nimbu
    .get('/channels', { host: 'http://api.nimbu.io' })
    .then(channels => {
      t.is(channels[0].name, 'foo');
    })
    .then(() => api.isDone());
});
