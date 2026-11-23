import assert from 'node:assert'
import dns from 'node:dns'
import { syncBuiltinESMExports } from 'node:module'
import { describe, it } from 'node:test'
import nock from 'nock'
import request from 'supertest'
import { app } from './server'

// The server fetches feeds with `request` of node:http as an ESM import: nock replaces the CommonJS function, which the
// import sees only once the built-in modules' ESM exports are synced - else the test asked the real example.com.
syncBuiltinESMExports()
// (no DNS in the tests: the server checks the address a host resolves to - example.com as a public one)
dns.promises.lookup = (async () => [{ address: '93.184.215.14', family: 4 }]) as unknown as typeof dns.promises.lookup

describe('rss feeds', () => {
  it('should return an error if no url is provided', (_t, done) => {
    request(app).get('/api/rssfeed').expect(500, done)
  })

  it('should request a provided url and convert the xml response to json', (_t, done) => {
    nock('http://example.com')
      .get('/')
      // (a feed's own type: the route turns away what is not one - a web page, see fetchRemote)
      .reply(200, '<?xml version="1.0" encoding="UTF-8"?><note><title>Test</title></note>', {
        'Content-Type': 'application/rss+xml; charset=utf-8',
      })
    request(app)
      .get('/api/rssfeed?url=http://example.com')
      .end((_err, res) => {
        assert.equal(
          res.text,
          '{"_declaration":{"_attributes":{"version":"1.0","encoding":"UTF-8"}},"note":{"title":{"_text":"Test"}}}',
        )
        done()
      })
  })

  it('should handle error responses from the external urls', (_t, done) => {
    // We need to persist (i.e., expect more than one request) the nock endpoint since
    // ky repeats failed requests.
    nock('http://example.com').persist().get('/').replyWithError('Random error')
    request(app).get('/api/rssfeed?url=http://example.com').expect(500, done)
  })
})
