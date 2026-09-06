import {useEffect} from 'react';

const DEVICE_COOKIE = 'khoj_device_id';
const VISITOR_COOKIE = 'khoj_visitor_id';
const VISITOR_CUSTOMER_COOKIE = 'khoj_visitor_customer_id';
const OPPREF_COOKIE = 'khoj_oppref';
const OBREF_COOKIE = 'khoj_obref';
const COOKIE_MAX_AGE_SECONDS = 15552000;
const SHARED_COOKIE_DOMAIN = '.khoj.city';
const META_PIXEL_SCRIPT_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

type Money = {
  amount: string;
  currencyCode: string;
};

type TrackProduct = {
  id: string;
  variantId?: string;
  handle?: string;
  url?: string;
  title: string;
  productType?: string;
  variantTitle?: string;
  vendor?: string;
  price?: Money | null;
  quantity?: number;
};

export type TrackEvent = {
  eventType: string;
  eventId: string;
  product?: TrackProduct;
  items?: TrackProduct[];
  totalPrice?: Money | null;
  checkoutUrl?: string;
};

type MetaPixel = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  push?: MetaPixel;
  loaded?: boolean;
  version?: string;
};

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function writeCookie(name: string, value: string) {
  const domain =
    window.location.hostname === 'khoj.city' ||
    window.location.hostname.endsWith('.khoj.city')
      ? `; Domain=${SHARED_COOKIE_DOMAIN}`
      : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure${domain}`;
}

function stableCookie(name: string) {
  const existing = readCookie(name);
  if (existing) {
    const value = decodeURIComponent(existing);
    writeCookie(name, value);
    return value;
  }
  const value = randomId();
  writeCookie(name, value);
  return value;
}

function rememberAttribution() {
  const url = new URL(window.location.href);
  const oppref = url.searchParams.get('oppref');
  const obref = url.searchParams.get('__obref');
  if (oppref) writeCookie(OPPREF_COOKIE, oppref);
  if (obref) writeCookie(OBREF_COOKIE, obref);
}

function installMetaPixelStub() {
  const w = window as Window & {fbq?: MetaPixel; _fbq?: MetaPixel};
  if (w.fbq) return w.fbq;

  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
      return;
    }
    fbq.queue?.push(args);
  } as MetaPixel;

  if (!w._fbq) w._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  w.fbq = fbq;
  return fbq;
}

function ensureMetaPixel() {
  const pixelId = window.ENV?.META_PIXEL_ID;
  if (!pixelId) return null;

  const fbq = installMetaPixelStub();
  const w = window as Window & {__khojMetaPixelId?: string};

  if (w.__khojMetaPixelId !== pixelId) {
    fbq('init', pixelId);
    w.__khojMetaPixelId = pixelId;
  }

  if (!document.querySelector(`script[src="${META_PIXEL_SCRIPT_SRC}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = META_PIXEL_SCRIPT_SRC;
    document.head.appendChild(script);
  }

  return fbq;
}

function amount(money?: Money | null) {
  const value = Number(money?.amount);
  return Number.isFinite(value) ? value : undefined;
}

function cleanParams(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    }),
  );
}

function productContent(product: TrackProduct) {
  const id = shopifyNumericId(product.variantId || product.id);
  return cleanParams({
    id,
    quantity: product.quantity || 1,
    item_price: amount(product.price),
  });
}

function metaProductParams(event: TrackEvent) {
  const items = event.items || (event.product ? [event.product] : []);
  const value =
    amount(event.totalPrice) ||
    items.reduce((total, item) => {
      const itemPrice = amount(item.price) || 0;
      return total + itemPrice * (item.quantity || 1);
    }, 0);

  return cleanParams({
    content_ids: items
      .map((item) => shopifyNumericId(item.variantId || item.id))
      .filter(Boolean),
    content_name: event.product?.title || items[0]?.title,
    content_category: event.product?.productType || items[0]?.productType,
    content_type: 'product',
    contents: items.map(productContent),
    value,
    currency:
      event.totalPrice?.currencyCode || items[0]?.price?.currencyCode || 'INR',
  });
}

function shopifyNumericId(id?: string) {
  return id?.split('/').pop() || id;
}

function trackMetaPixelActivity(event: TrackEvent) {
  const fbq = ensureMetaPixel();
  if (!fbq) return;

  if (event.eventType === 'page_viewed') {
    fbq('track', 'PageView', {}, {eventID: event.eventId});
    return;
  }

  if (event.eventType === 'product_viewed') {
    fbq('track', 'ViewContent', metaProductParams(event), {
      eventID: event.eventId,
    });
    return;
  }

  if (event.eventType === 'product_added_to_cart') {
    fbq('track', 'AddToCart', metaProductParams(event), {
      eventID: event.eventId,
    });
    return;
  }

  // Shopify checkout already fires InitiateCheckout. Keep Hydrogen Meta events
  // limited to the pre-checkout storefront funnel to avoid duplicate signals.
}

export function trackKhojActivity(event: TrackEvent) {
  trackMetaPixelActivity(event);

  const endpoint = window.ENV?.KHOJ_SITE_ACTIVITY_ENDPOINT;
  const token = window.ENV?.KHOJ_SITE_ACTIVITY_PUBLIC_TOKEN;
  if (!endpoint || !token) return;

  rememberAttribution();

  const payload = {
    token,
    event_type: event.eventType,
    event_id: event.eventId,
    timestamp: new Date().toISOString(),
    source: 'hydrogen_pdp_pilot',
    source_url: window.location.href,
    referrer: document.referrer,
    oppref: readCookie(OPPREF_COOKIE) || '',
    obref: readCookie(OBREF_COOKIE) || '',
    device_id: stableCookie(DEVICE_COOKIE),
    visitor_id: stableCookie(VISITOR_COOKIE),
    visitor_customer_id: readCookie(VISITOR_CUSTOMER_COOKIE) || '',
    product: event.product,
    items: event.items,
    total_price: event.totalPrice?.amount,
    currency: event.totalPrice?.currencyCode || 'INR',
    checkout_url: event.checkoutUrl,
  };

  fetch(endpoint, {
    method: 'POST',
    mode: 'no-cors',
    headers: {'Content-Type': 'text/plain;charset=UTF-8'},
    keepalive: true,
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function KhojPageTracking({product}: {product: TrackProduct}) {
  useEffect(() => {
    const base = `${product.id}:${product.variantId || ''}:${Date.now()}`;
    trackKhojActivity({
      eventType: 'page_viewed',
      eventId: `hydrogen_page:${base}`,
    });
    trackKhojActivity({
      eventType: 'product_viewed',
      eventId: `hydrogen_product:${base}`,
      product,
    });
  }, [product.id, product.variantId]);

  return null;
}

declare global {
  interface Window {
    ENV?: {
      KHOJ_SITE_ACTIVITY_ENDPOINT?: string;
      KHOJ_SITE_ACTIVITY_PUBLIC_TOKEN?: string;
      META_PIXEL_ID?: string;
    };
    fbq?: MetaPixel;
    __khojMetaPixelId?: string;
  }
}
