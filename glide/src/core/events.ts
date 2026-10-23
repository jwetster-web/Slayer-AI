// Domain events emitted by ingestion and tracking. The automation engine,
// notification outbox and UI live feed all consume these.

export type DomainEventKind =
  | 'order_created'
  | 'order_updated'
  | 'order_duplicate'
  | 'tracking_added'
  | 'package_status'
  | 'out_for_delivery'
  | 'delivered'
  | 'order_canceled'
  | 'partial_cancel'
  | 'review_hold'
  | 'refund'
  | 'returned'
  | 'match_auto'
  | 'match_review'
  | 'parser_failure';

export interface DomainEvent {
  kind: DomainEventKind;
  key: string; // stable id used for idempotent automation
  orderId?: number;
  memberId?: number | null;
  packageId?: number;
  retailerId?: string;
  at: string;
  detail?: Record<string, unknown>;
}

export class EventSink {
  readonly events: DomainEvent[] = [];
  push(e: DomainEvent) {
    this.events.push(e);
  }
}
