import {useEffect} from 'react';

const DEVICE_COOKIE = 'khoj_device_id';
const VISITOR_COOKIE = 'khoj_visitor_id';
const VISITOR_CUSTOMER_COOKIE = 'khoj_visitor_customer_id';
const OPPREF_COOKIE = 'khoj_oppref';
const OBREF_COOKIE = 'khoj_obref';
const COOKIE_MAX_AGE_SECONDS = 15552000;

type Money = {
  amount: string;
  currencyCode: string;
};

type TrackProduct = {
  id: string;
  variantId?: string;
  title: string;
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
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`;
}

function stableCookie(name: string) {
  const existing = readCookie(name);
  if (existing) return decodeURIComponent(existing);
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

export function trackKhojActivity(event: TrackEvent) {
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
    };
  }
}
