// (fork "wishes") The start page sorted by the child itself ("Kind darf die Startseite sortieren", off: A to Z as
// always): a long press on a cover, then the covers are moved - the order per tab is kept here (start-order.json, in the
// backup). Only the order of what the display shows: the library (data.json) is not changed. What is not in the order
// (new on the start page) the display puts in front.
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Express } from 'express'
import { backupBeforeWrite } from './file-backup'
import { localOnly } from './request-guard'

export const START_ORDER_CATEGORIES = ['audiobook', 'music', 'nas', 'other'] as const
type Category = (typeof START_ORDER_CATEGORIES)[number]
export type StartOrder = Partial<Record<Category, string[]>>

// a tile's key (start-order.service.ts tileKey): "artist:…", "nas:…", "spotify:…" - no more than this
const KEY_MAX = 600
const KEYS_MAX = 3000

export const startOrderOn = (cfg: Record<string, unknown> | undefined): boolean =>
  ((cfg?.mupibox ?? {}) as Record<string, unknown>).displayStartSort === true

export interface StartOrderDeps {
  configDir: string
  getMupiboxConfig: () => Record<string, unknown> | undefined
}

const isCategory = (v: unknown): v is Category => (START_ORDER_CATEGORIES as readonly string[]).includes(String(v))

export class StartOrderStore {
  private readonly file: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(configDir: string) {
    this.file = path.join(configDir, 'start-order.json')
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }

  async read(): Promise<StartOrder> {
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8')) as Record<string, unknown>
      const out: StartOrder = {}
      for (const c of START_ORDER_CATEGORIES) {
        const keys = raw?.[c]
        if (Array.isArray(keys)) out[c] = keys.filter((k): k is string => typeof k === 'string' && k.length <= KEY_MAX)
      }
      return out
    } catch {
      return {}
    }
  }

  private async write(order: StartOrder): Promise<void> {
    backupBeforeWrite(this.file)
    const tmp = `${this.file}.tmp.${process.pid}.${Date.now()}`
    await fsp.writeFile(tmp, JSON.stringify(order, null, 1))
    await fsp.rename(tmp, this.file)
  }

  /** a tab's order as the child set it; null: forgotten (A to Z again) */
  set(category: Category, keys: string[] | null): Promise<StartOrder> {
    return this.serial(async () => {
      const order = await this.read()
      if (keys === null) delete order[category]
      else order[category] = [...new Set(keys)]
      await this.write(order)
      return order
    })
  }
}

export function registerStartOrderRoutes(app: Express, deps: StartOrderDeps): StartOrderStore {
  const store = new StartOrderStore(deps.configDir)
  const on = () => startOrderOn(deps.getMupiboxConfig())

  /** GET /api/start-order - {on, order}: whether the child may sort, and the order of each tab it sorted */
  app.get('/api/start-order', localOnly, async (_req, res) => {
    res.json({ on: on(), order: await store.read() })
  })

  /** POST /api/start-order {category, keys} - a tab's order (the keys of its tiles, the first first) */
  app.post('/api/start-order', localOnly, async (req, res) => {
    if (!on()) return void res.status(403).json({ error: 'off' })
    const { category, keys } = (req.body ?? {}) as Record<string, unknown>
    if (
      !isCategory(category) ||
      !Array.isArray(keys) ||
      keys.length > KEYS_MAX ||
      !keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= KEY_MAX)
    )
      return void res.status(400).json({ error: 'invalid_request' })
    await store.set(category, keys as string[])
    res.json({ ok: true })
  })

  /** POST /api/start-order/reset {category} - the tab from A to Z again (its order forgotten) */
  app.post('/api/start-order/reset', localOnly, async (req, res) => {
    if (!on()) return void res.status(403).json({ error: 'off' })
    const category = (req.body ?? {}).category
    if (!isCategory(category)) return void res.status(400).json({ error: 'invalid_request' })
    await store.set(category, null)
    res.json({ ok: true })
  })

  return store
}
