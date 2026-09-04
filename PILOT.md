# Khoj Headless PDP Pilot

This repository is a controlled Hydrogen proof of concept for one product:

`mor-pankh-classic-multi-color-hand-painted-necklace-set-hp-np`

It intentionally does not migrate homepage, collections, search, account, or the full Shopify storefront.

## Architecture

- Shopify remains the commerce backend.
- Hydrogen reads product, variants, media, recommendations, prices, and metafields from the Storefront API.
- Add to cart uses Shopify cart mutations.
- Buy now adds the selected variant and redirects to Shopify checkout.
- Purchase tracking remains backend-side through existing Shopify order/webhook handling.
- Canonical points to the existing Prestige PDP until the pilot is approved.

## Tracking

The pilot sends normalized events to the existing Khoj site activity endpoint:

- `page_viewed`
- `product_viewed`
- `product_added_to_cart`
- `checkout_started`

Identifiers are stored as first-party cookies:

- `khoj_device_id`
- `khoj_visitor_id`
- `khoj_visitor_customer_id`
- `khoj_oppref`
- `khoj_obref`

## Environment

Copy `.env.example` to `.env` and fill:

- `SESSION_SECRET`
- `PUBLIC_STOREFRONT_API_TOKEN`
- `PUBLIC_KHOJ_SITE_ACTIVITY_PUBLIC_TOKEN`

## Local Development

```bash
pnpm install
pnpm dev
```

## Oxygen

Connect this repo to Oxygen after the PDP renders locally:

```bash
pnpm shopify hydrogen link
pnpm shopify hydrogen deploy
```

Keep the first deployment on an Oxygen preview URL. Do not point production DNS at this pilot until performance and CRO results justify it.
