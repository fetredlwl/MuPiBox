// The fork's last tag for the update page (eltern/updates.ts): the tags carry their day in the name, the newest day is the last
// one; the official tags (5.0.17 ...) and names that could not be handed to the update script are not taken.
import assert from 'node:assert'
import { describe, it } from 'node:test'
import { lastForkTag } from './eltern/updates'

describe('lastForkTag', () => {
  it('takes the tag with the newest day', () => {
    assert.strictEqual(
      lastForkTag(['fork-wishes-tipps-2026-11-22', 'fork-2026-11-23-spotify-live-suche']),
      'fork-2026-11-23-spotify-live-suche',
    )
  })

  it('does not depend on the order GitHub lists them in', () => {
    assert.strictEqual(
      lastForkTag(['fork-2026-12-01-b', 'fork-2026-11-23-a', 'fork-2026-11-30-c']),
      'fork-2026-12-01-b',
    )
  })

  it('takes the later name when two tags share a day', () => {
    assert.strictEqual(lastForkTag(['fork-2026-11-23-a', 'fork-2026-11-23-b']), 'fork-2026-11-23-b')
  })

  it('ignores tags without a day and names the update script could not take', () => {
    assert.strictEqual(
      lastForkTag(['5.0.17', 'dev', 'fork-2026-11-23-ok', 'fork-2026-12-24-with space', 'fork-2026-12-25-a/b']),
      'fork-2026-11-23-ok',
    )
  })

  it('has none when no tag carries a day', () => {
    assert.strictEqual(lastForkTag(['5.0.17', 'dev']), null)
    assert.strictEqual(lastForkTag([]), null)
  })
})
