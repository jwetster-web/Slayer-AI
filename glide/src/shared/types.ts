// Domain types shared by the main process, background workers and the renderer.
// Money is always stored as integer minor units (cents/pence) plus an ISO
// currency code. Timestamps are ISO-8601 strings in UTC.

export type Cents = number;
export type ISODate = string;

export type RetailerId =
  | 'target'
  | 'walmart'
  | 'pokemoncenter_us'
  | 'pokemoncenter_uk'
  | 'pokemoncenter_ca'
  | 'pokemoncenter_de'
  | 'amazon'
  | 'bestbuy'
  | 'costco'
  | 'samsclub'
  | 'gamestop'
  | 'hottopic'
  | 'barnesnoble'
  | 'macys'
  | 'lego'
  | 'shopify'
  | 'custom';

export type MessageType =
  | 'order_confirmation'
  | 'order_update'
  | 'shipping'
  | 'out_for_delivery'
  | 'delivery'
  | 'cancellation'
  | 'partial_cancellation'
  | 'review_hold'
  | 'backorder'
  | 'delay'
  | 'return'
  | 'refund'
  | 'unknown';

/** Fulfillment progress. Independent from cancellation, money and review state. */
export type FulfillmentStatus =
  | 'ordered'
  | 'processing'
  | 'backordered'
  | 'partially_shipped'
  | 'shipped'
  | 'out_for_delivery'
  | 'partially_delivered'
  | 'delivered'
  | 'exception'
  | 'delayed'
  | 'canceled'
  | 'returned';

export type CancelState = 'none' | 'partial' | 'full';
export type FinancialStatus = 'charged' | 'partially_refunded' | 'refunded';
export type ReviewStatus = 'none' | 'hold' | 'cleared';
export type MatchStatus = 'unmatched' | 'auto' | 'verified' | 'review';

export type PackageStatus =
  | 'label_created'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'delayed'
  | 'returned'
  | 'unknown';

export type Carrier = 'ups' | 'fedex' | 'usps' | 'dhl' | 'ontrac' | 'lasership' | 'amazon' | 'royalmail' | 'canadapost' | 'other';

export type ProductCategory =
  | 'elite_trainer_box'
  | 'booster_box'
  | 'booster_bundle'
  | 'booster_pack'
  | 'ultra_premium_collection'
  | 'premium_collection'
  | 'collection_box'
  | 'tin'
  | 'blister'
  | 'build_and_battle'
  | 'binder_collection'
  | 'other_tcg'
  | 'other';

// ---------------------------------------------------------------------------
// Parsed email output (the contract every retailer adapter returns)

export interface ParsedMoney {
  cents: Cents;
  currency: string;
}

export interface ParsedAddress {
  name?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postal: string;
  country?: string;
}

export interface ParsedItem {
  title: string;
  sku?: string;
  upc?: string;
  quantity: number;
  unitPriceCents?: Cents;
  lineTotalCents?: Cents;
  imageUrl?: string;
  productUrl?: string;
  /** Item-level status signalled by this email (e.g. canceled line). */
  status?: 'ordered' | 'canceled' | 'shipped' | 'delivered' | 'returned' | 'refunded' | 'backordered';
}

export interface ParsedShipment {
  trackingNumber?: string;
  carrier?: Carrier;
  trackingUrl?: string;
  estimatedDelivery?: ISODate;
  items?: ParsedItem[];
}

export interface ParsedOrderEmail {
  retailer: RetailerId;
  type: MessageType;
  orderNumber: string;
  placedAt?: ISODate;
  currency: string;
  subtotalCents?: Cents;
  taxCents?: Cents;
  shippingCents?: Cents;
  discountCents?: Cents;
  totalCents?: Cents;
  refundCents?: Cents;
  items: ParsedItem[];
  shipments: ParsedShipment[];
  shippingAddress?: ParsedAddress;
  billingAddress?: ParsedAddress;
  recipientName?: string;
  customerEmail?: string;
  phone?: string;
  /** Free-form confidence/warnings from the adapter. */
  warnings: string[];
}

export interface EmailEnvelope {
  messageId?: string;
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  date?: ISODate;
  html?: string;
  text?: string;
  /** Inline images (cid:) resolved to data URIs where present. */
  inlineImages?: Record<string, string>;
}

/** The innermost retailer message after unwrapping forwards. */
export interface UnwrappedEmail extends EmailEnvelope {
  forwarded: boolean;
  forwardedBy?: string;
  forwardDepth: number;
}

// ---------------------------------------------------------------------------
// Rows returned to the UI

export interface OrderRow {
  id: number;
  retailerId: RetailerId;
  retailerName: string;
  orderNumber: string;
  placedAt: ISODate;
  currency: string;
  totalCents: Cents;
  netCents: Cents;
  units: number;
  fulfillmentStatus: FulfillmentStatus;
  cancelState: CancelState;
  financialStatus: FinancialStatus;
  reviewStatus: ReviewStatus;
  matchStatus: MatchStatus;
  matchConfidence: number | null;
  memberId: number | null;
  memberName: string | null;
  memberAvatar: string | null;
  profileId: number | null;
  profileName: string | null;
  purchaseEmail: string | null;
  firstImage: string | null;
  firstTitle: string | null;
  packageCount: number;
  lastActivityAt: ISODate;
}

export interface OrderItemRow {
  id: number;
  productId: number | null;
  title: string;
  sku: string | null;
  upc: string | null;
  imageUrl: string | null;
  category: ProductCategory | null;
  quantity: number;
  canceledQty: number;
  shippedQty: number;
  deliveredQty: number;
  unitPriceCents: Cents;
  lineTotalCents: Cents;
  status: string;
}

export interface TrackingEventRow {
  id: number;
  status: PackageStatus;
  description: string;
  location: string | null;
  occurredAt: ISODate;
  source: 'email' | 'carrier_api' | 'manual' | 'provider';
}

export interface PackageRow {
  id: number;
  trackingNumber: string;
  carrier: Carrier;
  carrierName: string;
  trackingUrl: string | null;
  status: PackageStatus;
  estimatedDelivery: ISODate | null;
  deliveredAt: ISODate | null;
  lastVerifiedAt: ISODate | null;
  events: TrackingEventRow[];
}

export interface OrderEventRow {
  id: number;
  kind: string;
  label: string;
  occurredAt: ISODate;
  source: string;
  detail: Record<string, unknown> | null;
}

export interface SourceMessageRow {
  id: number;
  subject: string;
  fromAddr: string;
  sentAt: ISODate | null;
  messageType: MessageType;
  accountLabel: string | null;
  forwarded: boolean;
  parseStatus: string;
}

export interface MatchEvidence {
  signal: string;
  detail: string;
  weight: number;
  memberId?: number;
}

export interface OrderDetail extends OrderRow {
  subtotalCents: Cents;
  taxCents: Cents;
  shippingCents: Cents;
  discountCents: Cents;
  refundedCents: Cents;
  canceledCents: Cents;
  recipientName: string | null;
  phoneMasked: string | null;
  shippingAddress: AddressRow | null;
  emailAccountLabel: string | null;
  notes: string;
  matchEvidence: MatchEvidence[];
  items: OrderItemRow[];
  packages: PackageRow[];
  events: OrderEventRow[];
  sources: SourceMessageRow[];
}

export interface AddressRow {
  id: number;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal: string;
  country: string;
  verified: boolean;
  variantCount: number;
  ownerCount: number;
}

export interface MemberRow {
  id: number;
  discordId: string | null;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  tags: string[];
  profileCount: number;
  emailCount: number;
  addressCount: number;
  orderCount: number;
  successfulOrders: number;
  units: number;
  grossCents: Cents;
  netCents: Cents;
  lastActivityAt: ISODate | null;
}

export interface ProfileRow {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  memberId: number | null;
  memberName: string | null;
  emails: string[];
  addressCount: number;
  orderCount: number;
  retailers: string[];
}

export interface EmailAccountRow {
  id: number;
  label: string;
  kind: 'imap' | 'gmail' | 'outlook' | 'import';
  address: string;
  host: string | null;
  port: number | null;
  enabled: boolean;
  status: 'connected' | 'syncing' | 'error' | 'idle' | 'needs_auth' | 'disabled';
  lastSyncAt: ISODate | null;
  lastError: string | null;
  processedCount: number;
  orderCount: number;
  errorCount: number;
  ownerMemberId: number | null;
  backfillDays: number;
}

export interface ProductRow {
  id: number;
  retailerId: RetailerId | null;
  sku: string | null;
  upc: string | null;
  title: string;
  brand: string | null;
  category: ProductCategory;
  imageUrl: string | null;
  url: string | null;
  units: number;
  orderCount: number;
  lastPriceCents: Cents | null;
  currency: string | null;
}

export interface MatchCandidateRow {
  id: number;
  kind: 'order_assignment' | 'email_link' | 'address_link' | 'member_merge' | 'profile_link' | 'new_profile';
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  confidence: number;
  title: string;
  summary: string;
  orderId: number | null;
  proposedMemberId: number | null;
  proposedMemberName: string | null;
  alternatives: { memberId: number; name: string; confidence: number }[];
  evidence: MatchEvidence[];
  createdAt: ISODate;
}

export interface ActivityRow {
  id: number;
  at: ISODate;
  kind: ActivityKind;
  retailerId: RetailerId | null;
  retailerName: string | null;
  orderId: number | null;
  memberId: number | null;
  memberName: string | null;
  amountCents: Cents | null;
  currency: string | null;
  units: number | null;
  label: string;
}

export type ActivityKind =
  | 'new_order'
  | 'order_confirmed'
  | 'tracking_found'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'canceled'
  | 'partial_cancel'
  | 'review_hold'
  | 'refund'
  | 'match'
  | 'review_needed'
  | 'parser_failure'
  | 'sync'
  | 'import';

// ---------------------------------------------------------------------------
// Filters and analytics

export interface OrderFilter {
  search?: string;
  retailers?: RetailerId[];
  memberIds?: number[];
  profileIds?: number[];
  productIds?: number[];
  emailAccountIds?: number[];
  fulfillment?: FulfillmentStatus[];
  cancel?: CancelState[];
  review?: ReviewStatus[];
  match?: MatchStatus[];
  from?: ISODate;
  to?: ISODate;
  sort?: 'placed_desc' | 'placed_asc' | 'total_desc' | 'total_asc' | 'activity_desc';
  limit?: number;
  offset?: number;
}

export interface KpiSummary {
  orders: number;
  successfulOrders: number;
  canceledOrders: number;
  partiallyCanceledOrders: number;
  liveOrders: number;
  awaitingShipment: number;
  inTransitOrders: number;
  deliveredOrders: number;
  reviewHolds: number;
  returns: number;
  refunds: number;
  units: number;
  netUnits: number;
  grossCents: Cents;
  canceledCents: Cents;
  refundedCents: Cents;
  netCents: Cents;
  taxCents: Cents;
  shippingCents: Cents;
  avgOrderCents: Cents;
  successRate: number;
  cancellationRate: number;
  fulfillmentRate: number;
  activeBuyers: number;
  avgSpendPerMemberCents: Cents;
  avgUnitsPerMember: number;
  currency: string;
  mixedCurrency: boolean;
}

export interface SeriesPoint {
  bucket: string;
  orders: number;
  grossCents: Cents;
  netCents: Cents;
  units: number;
  canceled: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  orders: number;
  successfulOrders: number;
  units: number;
  grossCents: Cents;
  netCents: Cents;
  canceled: number;
  imageUrl?: string | null;
  extra?: Record<string, unknown>;
}

export interface AnalyticsBundle {
  kpis: KpiSummary;
  timeline: SeriesPoint[];
  byRetailer: BreakdownRow[];
  byMember: BreakdownRow[];
  byProduct: BreakdownRow[];
  byProfile: BreakdownRow[];
  byStatus: { status: string; count: number }[];
  heatmap: { dow: number; hour: number; orders: number }[];
  cancellationReasons: { label: string; count: number }[];
  inactiveMembers: { memberId: number; name: string; lastOrderAt: ISODate | null }[];
}

export interface CampaignStats {
  campaignId: number;
  name: string;
  signups: number;
  membersWithSuccess: number;
  conversionRate: number;
}

// ---------------------------------------------------------------------------
// Sync / runtime events pushed to the renderer

export interface SyncProgress {
  accountId: number;
  accountLabel: string;
  phase: 'connecting' | 'listing' | 'fetching' | 'processing' | 'idle' | 'error' | 'done';
  mailbox?: string;
  processed: number;
  total?: number;
  ordersCreated: number;
  ordersUpdated: number;
  failures: number;
  message?: string;
}

export interface SyncHealth {
  running: boolean;
  paused: boolean;
  accounts: number;
  healthyAccounts: number;
  lastSyncAt: ISODate | null;
  messagesLastHour: number;
  throughputPerMin: number;
  parserFailures24h: number;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  isSample: boolean;
  createdAt: ISODate;
  setupComplete: boolean;
}

export interface AppSettings {
  brandName: string;
  brandTagline: string;
  accentColor: string;
  theme: 'dark' | 'light';
  reducedMotion: 'system' | 'on' | 'off';
  soundEffects: boolean;
  pollIntervalSec: number;
  autoMatchThreshold: number;
  reviewThreshold: number;
  autoLinkNewEmails: boolean;
  autoLinkEmailThreshold: number;
  storeRawEmails: boolean;
  encryptRawEmails: boolean;
  fetchRemoteProductImages: boolean;
  backupIntervalHours: number;
  backupKeep: number;
  displayCurrency: string;
  fxRates: Record<string, number>;
  dailyRecapTime: string | null;
  discordEnabled: boolean;
  timezone: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  brandName: 'PokeSlayerz',
  brandTagline: 'Order Command Center',
  accentColor: '#5b8cff',
  theme: 'dark',
  reducedMotion: 'system',
  soundEffects: false,
  pollIntervalSec: 120,
  autoMatchThreshold: 0.9,
  reviewThreshold: 0.35,
  autoLinkNewEmails: false,
  autoLinkEmailThreshold: 0.97,
  storeRawEmails: true,
  encryptRawEmails: true,
  fetchRemoteProductImages: true,
  backupIntervalHours: 24,
  backupKeep: 7,
  displayCurrency: 'USD',
  fxRates: {},
  dailyRecapTime: null,
  discordEnabled: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};
