// Ordered, append-only schema migrations. Never edit a shipped migration;
// add a new version instead.

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: /* sql */ `
CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);

CREATE TABLE retailers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  color TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  logo_path TEXT,
  config_json TEXT
);

-- Identity ------------------------------------------------------------------
CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  discord_id TEXT UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  merged_into_id INTEGER REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_members_username ON members(username COLLATE NOCASE);

CREATE TABLE discord_name_history (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT,
  observed_at TEXT NOT NULL
);
CREATE INDEX idx_dnh_member ON discord_name_history(member_id);
CREATE INDEX idx_dnh_username ON discord_name_history(username COLLATE NOCASE);

CREATE TABLE profiles (
  id INTEGER PRIMARY KEY,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  name_key TEXT,
  last_key TEXT,
  phone_key TEXT,
  phone_masked TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_profiles_member ON profiles(member_id);
CREATE INDEX idx_profiles_name_key ON profiles(name_key);
CREATE INDEX idx_profiles_last_key ON profiles(last_key);
CREATE INDEX idx_profiles_phone ON profiles(phone_key);
CREATE INDEX idx_profiles_name ON profiles(name COLLATE NOCASE);

CREATE TABLE emails (
  id INTEGER PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  base_address TEXT NOT NULL,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'unverified', -- verified | proposed | unverified
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX idx_emails_member ON emails(member_id);
CREATE INDEX idx_emails_base ON emails(base_address);
CREATE INDEX idx_emails_domain ON emails(substr(address, instr(address, '@') + 1));

CREATE TABLE addresses (
  id INTEGER PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  street_key TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT,
  postal TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_addresses_street ON addresses(street_key);

CREATE TABLE address_variants (
  id INTEGER PRIMARY KEY,
  address_id INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  raw TEXT NOT NULL,
  raw_hash TEXT NOT NULL UNIQUE,
  first_seen TEXT NOT NULL
);
CREATE INDEX idx_address_variants_addr ON address_variants(address_id);

CREATE TABLE address_owners (
  address_id INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'verified', -- verified | proposed
  created_at TEXT NOT NULL,
  PRIMARY KEY (address_id, member_id)
);
CREATE INDEX idx_address_owners_member ON address_owners(member_id);

CREATE TABLE profile_addresses (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  address_id INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, address_id)
);
CREATE INDEX idx_profile_addresses_addr ON profile_addresses(address_id);

-- Email ingestion -----------------------------------------------------------
CREATE TABLE email_accounts (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,              -- imap | gmail | outlook | import
  address TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  secure INTEGER NOT NULL DEFAULT 1,
  username TEXT,
  auth_kind TEXT NOT NULL DEFAULT 'password', -- password | oauth | none
  secret_ref TEXT,
  owner_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'idle',
  mailboxes_json TEXT NOT NULL DEFAULT '["INBOX"]',
  backfill_days INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  last_error TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE sync_checkpoints (
  account_id INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  mailbox TEXT NOT NULL,
  uid_validity TEXT NOT NULL,
  last_uid INTEGER NOT NULL DEFAULT 0,
  backfill_done INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, mailbox)
);

CREATE TABLE source_messages (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL,
  mailbox TEXT,
  uid INTEGER,
  uid_validity TEXT,
  import_ref TEXT,
  message_id_header TEXT,
  original_message_id TEXT,
  content_hash TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TEXT,
  received_at TEXT NOT NULL,
  forwarded INTEGER NOT NULL DEFAULT 0,
  forwarded_by TEXT,
  retailer_id TEXT,
  message_type TEXT NOT NULL DEFAULT 'unknown',
  parse_status TEXT NOT NULL,      -- parsed | ignored | failed | duplicate
  parse_error TEXT,
  redacted_sample TEXT,
  order_id INTEGER,
  duplicate_of_id INTEGER REFERENCES source_messages(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_source_uid ON source_messages(account_id, mailbox, uid_validity, uid) WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX uq_source_import ON source_messages(import_ref) WHERE import_ref IS NOT NULL;
CREATE INDEX idx_source_hash ON source_messages(content_hash);
CREATE INDEX idx_source_orig ON source_messages(original_message_id);
CREATE INDEX idx_source_order ON source_messages(order_id);
CREATE INDEX idx_source_status ON source_messages(parse_status, created_at);

CREATE TABLE source_message_blobs (
  message_id INTEGER PRIMARY KEY REFERENCES source_messages(id) ON DELETE CASCADE,
  encrypted INTEGER NOT NULL,
  data BLOB NOT NULL
);

-- Catalog -------------------------------------------------------------------
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  retailer_id TEXT REFERENCES retailers(id),
  sku TEXT,
  upc TEXT,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  primary_image_id INTEGER,
  url TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_products_sku ON products(retailer_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX idx_products_upc ON products(upc);
CREATE INDEX idx_products_title_key ON products(retailer_id, title_key);

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source TEXT NOT NULL,            -- email | retailer | cache | provider | user
  url TEXT,
  local_path TEXT,
  sha256 TEXT,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_product_images_product ON product_images(product_id);

CREATE TABLE product_prices (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  retailer_id TEXT,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  order_id INTEGER,
  observed_at TEXT NOT NULL
);
CREATE INDEX idx_product_prices_product ON product_prices(product_id, observed_at);

-- Orders --------------------------------------------------------------------
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  retailer_id TEXT NOT NULL REFERENCES retailers(id),
  order_number TEXT NOT NULL,
  placed_at TEXT NOT NULL,
  currency TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  canceled_cents INTEGER NOT NULL DEFAULT 0,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL DEFAULT 0,
  units INTEGER NOT NULL DEFAULT 0,
  canceled_units INTEGER NOT NULL DEFAULT 0,
  has_confirmation INTEGER NOT NULL DEFAULT 0,
  email_account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL,
  purchase_email TEXT,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  shipping_address_id INTEGER REFERENCES addresses(id) ON DELETE SET NULL,
  billing_address_id INTEGER REFERENCES addresses(id) ON DELETE SET NULL,
  recipient_name TEXT,
  phone_key TEXT,
  phone_masked TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'ordered',
  cancel_state TEXT NOT NULL DEFAULT 'none',
  financial_status TEXT NOT NULL DEFAULT 'charged',
  review_status TEXT NOT NULL DEFAULT 'none',
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  match_confidence REAL,
  match_evidence_json TEXT,
  match_locked INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (retailer_id, order_number)
);
CREATE INDEX idx_orders_placed ON orders(placed_at);
CREATE INDEX idx_orders_member ON orders(member_id, placed_at);
CREATE INDEX idx_orders_profile ON orders(profile_id);
CREATE INDEX idx_orders_retailer ON orders(retailer_id, placed_at);
CREATE INDEX idx_orders_status ON orders(fulfillment_status);
CREATE INDEX idx_orders_cancel ON orders(cancel_state);
CREATE INDEX idx_orders_match ON orders(match_status);
CREATE INDEX idx_orders_activity ON orders(last_activity_at);
CREATE INDEX idx_orders_address ON orders(shipping_address_id);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  line_key TEXT NOT NULL,
  title TEXT NOT NULL,
  sku TEXT,
  upc TEXT,
  image_url TEXT,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0,
  canceled_qty INTEGER NOT NULL DEFAULT 0,
  shipped_qty INTEGER NOT NULL DEFAULT 0,
  delivered_qty INTEGER NOT NULL DEFAULT 0,
  returned_qty INTEGER NOT NULL DEFAULT 0,
  backordered INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ordered',
  UNIQUE (order_id, line_key)
);
CREATE INDEX idx_order_items_product ON order_items(product_id);

CREATE TABLE packages (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,
  carrier TEXT NOT NULL,
  tracking_url TEXT,
  status TEXT NOT NULL DEFAULT 'label_created',
  estimated_delivery TEXT,
  delivered_at TEXT,
  last_verified_at TEXT,
  last_event_at TEXT,
  next_check_at TEXT,
  check_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (order_id, tracking_number)
);
CREATE INDEX idx_packages_tracking ON packages(tracking_number);
CREATE INDEX idx_packages_status ON packages(status);
CREATE INDEX idx_packages_next_check ON packages(next_check_at);

CREATE TABLE package_items (
  package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  PRIMARY KEY (package_id, order_item_id)
);

CREATE TABLE tracking_events (
  id INTEGER PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tracking_events_pkg ON tracking_events(package_id, occurred_at);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- charge | refund | adjustment
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source_message_id INTEGER REFERENCES source_messages(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  note TEXT
);
CREATE INDEX idx_payments_order ON payments(order_id);

CREATE TABLE order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,            -- email | carrier | manual | system | import
  source_message_id INTEGER REFERENCES source_messages(id) ON DELETE SET NULL,
  detail_json TEXT,
  dedupe_key TEXT UNIQUE
);
CREATE INDEX idx_order_events_order ON order_events(order_id, occurred_at);

CREATE TABLE order_sources (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source_message_id INTEGER NOT NULL REFERENCES source_messages(id) ON DELETE CASCADE,
  PRIMARY KEY (order_id, source_message_id)
);

-- Identity review -----------------------------------------------------------
CREATE TABLE match_candidates (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  other_member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  email_id INTEGER REFERENCES emails(id) ON DELETE CASCADE,
  address_id INTEGER REFERENCES addresses(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  confidence REAL NOT NULL,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE UNIQUE INDEX uq_match_pending ON match_candidates(dedupe_key) WHERE status = 'pending';
CREATE INDEX idx_match_status ON match_candidates(status, created_at);

CREATE TABLE identity_corrections (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Automation, notifications, reports ---------------------------------------
CREATE TABLE automation_rules (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger TEXT NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  actions_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE automation_executions (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL,            -- ok | skipped | error
  detail TEXT,
  executed_at TEXT NOT NULL,
  UNIQUE (rule_id, event_key)
);
CREATE INDEX idx_auto_exec_time ON automation_executions(executed_at);

CREATE TABLE notifications_outbox (
  id INTEGER PRIMARY KEY,
  channel_kind TEXT NOT NULL,      -- admin_channel | member_dm
  target TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX idx_outbox_status ON notifications_outbox(status, next_attempt_at);

CREATE TABLE export_presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  options_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE generated_reports (
  id INTEGER PRIMARY KEY,
  template TEXT NOT NULL,
  params_json TEXT NOT NULL,
  output_path TEXT NOT NULL,
  format TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  data_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Campaigns ----------------------------------------------------------------
CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  retailer_ids_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE campaign_signups (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  signed_up_at TEXT,
  PRIMARY KEY (campaign_id, member_id)
);

-- Imports (rollback support) ----------------------------------------------
CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL,            -- applied | rolled_back
  stats_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  rolled_back_at TEXT
);
CREATE TABLE import_changes (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  op TEXT NOT NULL,                -- insert | update
  before_json TEXT
);
CREATE INDEX idx_import_changes_batch ON import_changes(batch_id);

CREATE TABLE parser_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  retailer_id TEXT NOT NULL,
  sender_pattern TEXT NOT NULL,
  subject_pattern TEXT,
  rules_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Logs ----------------------------------------------------------------------
CREATE TABLE activity_feed (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  retailer_id TEXT,
  order_id INTEGER,
  member_id INTEGER,
  amount_cents INTEGER,
  currency TEXT,
  units INTEGER,
  label TEXT NOT NULL,
  dedupe_key TEXT UNIQUE
);
CREATE INDEX idx_activity_at ON activity_feed(at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail_json TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE secrets (
  ref TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  scheme TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    // Mail-detection fixes (relay senders, wider confirmation subjects, Mattel Creations):
    // relabel existing rows and rescan each inbox's backfill window once.
    version: 2,
    sql: `
INSERT OR IGNORE INTO retailers (id, name, short_name, region, currency, color) VALUES ('mattel', 'Mattel Creations', 'Mattel', 'US', 'USD', '#e4002b');
UPDATE orders SET retailer_id = 'mattel' WHERE retailer_id = 'shopify' AND order_number LIKE 'CHP%';
UPDATE source_messages SET retailer_id = 'mattel' WHERE retailer_id = 'shopify' AND lower(from_addr) LIKE '%mattel%';

-- Orders whose "number" has no digit (e.g. "HAS" from "Order # has shipped") are parse errors: drop them and re-read their mail.
CREATE TEMP TABLE bogus_orders AS SELECT id FROM orders WHERE order_number NOT GLOB '*[0-9]*';
UPDATE source_messages SET duplicate_of_id = NULL WHERE duplicate_of_id IN (SELECT id FROM source_messages WHERE order_id IN (SELECT id FROM bogus_orders));
DELETE FROM source_messages WHERE order_id IN (SELECT id FROM bogus_orders);
DELETE FROM orders WHERE id IN (SELECT id FROM bogus_orders);
DROP TABLE bogus_orders;

UPDATE source_messages SET duplicate_of_id = NULL WHERE duplicate_of_id IN (SELECT id FROM source_messages WHERE uid IS NOT NULL AND order_id IS NULL AND parse_status IN ('ignored', 'failed'));
DELETE FROM source_messages WHERE uid IS NOT NULL AND order_id IS NULL AND parse_status IN ('ignored', 'failed');
UPDATE sync_checkpoints SET last_uid = 0;
`,
  },
];
