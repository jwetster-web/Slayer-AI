# Architecture

## Processes

```
┌──────────────── Renderer (sandboxed, CSP) ────────────────┐
│ React UI · Zustand store · ECharts · Motion               │
│ window.glide.invoke(channel, …args)  ·  window.glide.on() │
└──────────────┬────────────────────────────────▲───────────┘
               │ ipcRenderer.invoke             │ glide:event
┌──────────────▼───────────── Main process ─────┴───────────┐
│ handlers.ts (typed API) · WorkspaceManager · scheduler     │
│ glide-img:// protocol (image cache only) · OAuth loopback │
│ own SQLite connection (reads + small writes)              │
└──────────────┬────────────────────────────────▲───────────┘
               │ postMessage(job)               │ events/results
┌──────────────▼──────────── Worker thread ─────┴───────────┐
│ IMAP sync · EML/MBOX import · sample generation · image   │
│ cache · carrier refresh · Discord outbox · export render  │
│ own SQLite connection (WAL)                               │
└────────────────────────────────────────────────────────────┘
```

- The renderer has no Node access. It only reaches the app through `invoke`, and the main process rejects calls from any other sender.
- The renderer's API types come from `electron/handlers.ts` through a type-only import, so the IPC contract is checked at compile time.
- Heavy work runs in the worker, so neither the main process nor the UI blocks. SQLite runs in WAL mode, which lets the main process read while the worker writes.

## Modules (`src/core`)

All domain code is plain TypeScript with no Electron dependency, so it is testable in Node.

| Module | Responsibility |
|---|---|
| `db` | `node:sqlite` wrapper: statement cache, nested transactions (savepoints), append-only migrations |
| `email/mime` | mailparser wrapper, inline images, forward-as-attachment, mbox splitting |
| `email/forwarded` | finds the original retailer message inside inline forward chains |
| `parsing` | retailer detection, message-type classification, generic extractors, adapter registry, custom templates |
| `email/process` | one raw message end to end: provenance row, optional encrypted raw blob, parse, apply |
| `email/imapSync` | incremental read-only sync with per-message checkpoints |
| `orders/ingest` | idempotent application of a parsed email (fingerprint dedupe) |
| `orders/state` | derives fulfillment, cancellation, financial state and money from items, packages and payments |
| `identity` | normalization, identity store, confidence matcher, review resolution, duplicate scan |
| `tracking` | carrier detection and validation, carrier API providers, due-package refresh |
| `analytics` | KPI and breakdown SQL with FX conversion and timezone bucketing |
| `export` | recap aggregation, SVG templates (design units), resvg rasterizer, sharp, pdf-lib, gifenc |
| `products` | catalog resolution by SKU or UPC, image cache |
| `automation` | rules engine with once-per-event execution |
| `csv` | import (mapping, preview, rollback, card-data stripping), export, statements |
| `discord` | REST client, member sync, notification outbox |
| `sample` | synthetic retailer emails and sample workspace generator |

## Adding a retailer

1. Add a `RetailerMeta` entry in `src/core/retailers/registry.ts` (sender domains, brand markers, order-number patterns, currency).
2. If the layout needs special handling, register an adapter in `src/core/parsing/adapters.ts` (custom `detect`, `refine` or `currencyFor`).
3. Add a fixture test in `tests/unit/parser.test.ts`.

No ingestion, identity or UI code changes. Users can also add regex templates at runtime under **Settings → Parser templates**.

## Idempotency and recovery

| Layer | Guard |
|---|---|
| Message | unique `(account, mailbox, UIDVALIDITY, UID)` or `import_ref` (content hash) |
| Checkpoint | updated after every message; a UIDVALIDITY change restarts safely |
| Order | unique `(retailer, order_number)` |
| Effects | semantic fingerprint stored as `order_events.dedupe_key`. Duplicates only add an `order_sources` row. |
| Items / packages / tracking / payments | unique keys (`line_key`, `tracking_number`, `dedupe_key`) |
| Automations | unique `(rule, event_key)` |
| Notifications | unique outbox `dedupe_key` |

## Data model

Normalized tables (see `src/core/db/migrations.ts`):

- **Identity**: members, Discord name history, profiles, emails (aliases), addresses, address variants, address owners, profile ↔ address links
- **Orders**: orders, order items, packages, package items, tracking events, payments, order events (state history), order sources (provenance), source messages and encrypted blobs
- **Catalog**: products, product images, product prices
- **Identity review**: match candidates, identity corrections
- **Operations**: automation rules and executions, notifications outbox, export presets, generated reports, campaigns and signups, import batches and changes (rollback), parser templates
- **System**: activity feed, audit log, secrets, settings, workspace meta, sync checkpoints

Money is stored as integer minor units plus an ISO currency code. Timestamps are ISO-8601 UTC.
