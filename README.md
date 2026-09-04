# Khoj Headless PDP Pilot

Hydrogen/Oxygen proof of concept for one Khoj.city product detail page.

Pilot product:

`mor-pankh-classic-multi-color-hand-painted-necklace-set-hp-np`

This repo intentionally does not migrate the homepage, collections, search, customer account, or the full storefront.

## Setup

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Fill `.env` with the real Storefront API token and Khoj site-activity public token before running.

## Useful Commands

```bash
pnpm typecheck
pnpm build
pnpm shopify hydrogen link
pnpm shopify hydrogen deploy
```

Keep the first deployment on an Oxygen preview URL. The canonical URL points to the existing Prestige PDP until the pilot is reviewed.
