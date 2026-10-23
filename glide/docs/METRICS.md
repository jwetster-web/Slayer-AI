# Metric definitions

Every number in Overview, Analytics and Cook Export comes from the same order fields, so they always agree with each other.

## Order states (independent fields)

| Field | Values |
|---|---|
| Fulfillment | ordered, processing, backordered, partially shipped, shipped, out for delivery, partially delivered, delivered, exception, delayed, canceled, returned |
| Cancellation | none, partial, full |
| Financial | charged, partially refunded, refunded |
| Review | none, hold, cleared |

A **review hold** only sets `review = hold`. It never counts as a cancellation. A later shipping email clears it.

## Counts

| Metric | Definition |
|---|---|
| Orders | all orders in the filter |
| **Live** | orders that are not fully canceled (partial cancels count as live) |
| Canceled | `cancellation = full` |
| Partially canceled | `cancellation = partial` |
| Awaiting shipment | live, and fulfillment is ordered, processing or backordered |
| In transit | live, and fulfillment is shipped, partially shipped, out for delivery, partially delivered, delayed or exception |
| Delivered | fulfillment = delivered |
| Review holds | review = hold |
| Units | Σ ordered quantity |
| Units secured | Σ (quantity − canceled quantity) |
| Active buyers | distinct members with at least one live order |

## Rates

| Metric | Definition |
|---|---|
| **Success rate** | live ÷ orders |
| Cancellation rate | canceled ÷ orders |
| Fulfillment rate | delivered ÷ live |
| Campaign conversion | signed-up members with at least one live order in the campaign window (and retailers, if set) ÷ signups |

## Money

| Metric | Definition |
|---|---|
| Gross order value | Σ order totals as placed (including tax and shipping, minus discounts) |
| Canceled value | partial cancel: Σ canceled units × unit price (pre-tax); full cancel: the whole order total |
| Refunded | Σ refunds from refund, return and cancellation emails |
| **Net secured** | Σ (total − max(canceled value, refunded)) |
| Average order value | gross ÷ orders with a convertible currency |
| Average spend per member | net of member-assigned orders ÷ active buyers |

Net uses `max(canceled, refunded)` so a cancellation followed by its refund is not subtracted twice.

## Currencies

Orders keep their original currency. Totals are converted to the display currency using the rates in **Settings → General** (1 unit = X display currency). Orders in a currency with no rate still count, but are left out of money totals, and the UI shows a warning.

## Time

Placed times are stored in UTC. Daily, weekly and hourly buckets and the heatmap use the timezone from Settings. The offset is taken at query time, so buckets on a DST change day can be off by an hour.

## Cook Export

Exports use the same filter-scoped KPIs. Product quantities are units secured from live orders only. Catalog entries with *identical* normalized titles (the same item bought at different retailers) are combined into one tile; titles that are only similar never are. Members are ranked by net secured. Nothing is estimated or padded, and sample workspaces stamp "SAMPLE DATA — NOT REAL ORDERS" on every export.
