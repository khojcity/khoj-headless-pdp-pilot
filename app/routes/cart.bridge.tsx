import {redirect} from 'react-router';
import type {Route} from './+types/cart.bridge';

type AjaxCart = {
  items?: AjaxCartItem[];
  note?: string | null;
};

type AjaxCartItem = {
    id?: number | string;
    variant_id?: number | string;
    quantity?: number | string;
    properties?: Record<string, unknown> | null;
};

const MAX_BRIDGE_LINES = 50;
const ATTRIBUTION_PARAM_NAMES = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_id',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
] as const;

export async function action({request, context}: Route.ActionArgs) {
  const formData = await request.formData();
  const payload = String(formData.get('payload') || '');
  const source = String(formData.get('source') || '');

  return importThemeCart({
    attributionParams: getAttributionParams(formData),
    context,
    discountCodes: getDiscountCodes(formData),
    mode: getBridgeMode(formData),
    payload,
    source,
  });
}

export function loader({request, context}: Route.LoaderArgs) {
  const url = new URL(request.url);
  return importThemeCart({
    attributionParams: getAttributionParams(url.searchParams),
    context,
    discountCodes: getDiscountCodes(url.searchParams),
    mode: getBridgeMode(url.searchParams),
    payload: url.searchParams.get('payload') || '',
    source: url.searchParams.get('source') || '',
  });
}

export default function Component() {
  return null;
}

function parseBridgePayload(payload: string): AjaxCart {
  const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
  const paddedPayload =
    normalizedPayload + '='.repeat((4 - (normalizedPayload.length % 4)) % 4);

  try {
    return JSON.parse(decodeURIComponent(escape(atob(paddedPayload)))) as AjaxCart;
  } catch {
    try {
      return JSON.parse(atob(paddedPayload)) as AjaxCart;
    } catch {
      return {};
    }
  }
}

async function importThemeCart({
  attributionParams,
  context,
  discountCodes,
  mode,
  payload,
  source,
}: {
  attributionParams: URLSearchParams;
  context: Route.ActionArgs['context'];
  discountCodes: string[];
  mode: BridgeMode;
  payload: string;
  source: string;
}) {
  if (!payload || source !== 'khoj-theme-cart') {
    return redirect(cartRedirectUrl('invalid', attributionParams));
  }

  const sourceCart = parseBridgePayload(payload);
  const lines = ajaxCartToCartLines(sourceCart);
  const bridgeAttributes = getBridgeCartAttributes(attributionParams);

  if (!lines.length) {
    return redirect(cartRedirectUrl('empty', attributionParams));
  }

  const existingCart = mode === 'append' ? await context.cart.get() : null;
  const result =
    existingCart?.id
      ? await context.cart.addLines(lines)
      : await context.cart.create({
          lines,
          discountCodes,
          note: sourceCart.note || undefined,
          attributes: bridgeAttributes,
        });

  let cartResult = result.cart;

  if (result.errors?.length || !cartResult) {
    throw new Response('Unable to import cart. Please try again.', {
      status: 422,
    });
  }

  if (existingCart?.id) {
    const attributeResult = await context.cart.updateAttributes(bridgeAttributes);
    if (attributeResult.errors?.length || !attributeResult.cart) {
      throw new Response('Unable to save cart attribution. Please try again.', {
        status: 422,
      });
    }
    cartResult = attributeResult.cart;
  }

  const headers = context.cart.setCartId(cartResult.id);
  return redirect(cartRedirectUrl('imported', attributionParams), {headers});
}

function getAttributionParams(input: FormData | URLSearchParams) {
  const params = new URLSearchParams();
  for (const name of ATTRIBUTION_PARAM_NAMES) {
    const value = String(input.get(name) || '').trim().slice(0, 512);
    if (value) params.set(name, value);
  }
  return params;
}

function getBridgeCartAttributes(attributionParams: URLSearchParams) {
  return [
    {
      key: 'cart_bridge_source',
      value: 'www.khoj.city',
    },
    ...Array.from(attributionParams, ([name, value]) => ({
      key: `khoj_attribution_${name}`,
      value: value.slice(0, 255),
    })),
  ];
}

function cartRedirectUrl(
  bridge: 'invalid' | 'empty' | 'imported',
  attributionParams: URLSearchParams,
) {
  const params = new URLSearchParams();
  params.set('bridge', bridge);
  for (const [name, value] of attributionParams) {
    params.set(name, value);
  }
  return `/cart?${params.toString()}`;
}

function ajaxCartToCartLines(cart: AjaxCart) {
  return (cart.items || [])
    .slice(0, MAX_BRIDGE_LINES)
    .map((item) => {
      const variantId = normalizeNumericId(item.variant_id || item.id);
      const quantity = Math.max(1, Number(item.quantity || 1));
      if (!variantId || !Number.isFinite(quantity)) return null;

      return {
        merchandiseId: `gid://shopify/ProductVariant/${variantId}`,
        quantity,
        attributes: propertiesToAttributes(item.properties),
      };
    })
    .filter(Boolean);
}

function normalizeNumericId(value: unknown) {
  const id = String(value || '').trim();
  return /^\d+$/.test(id) ? id : '';
}

function propertiesToAttributes(properties: AjaxCartItem['properties']) {
  if (!properties || typeof properties !== 'object') return [];

  return Object.entries(properties)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      key,
      value: String(value),
    }));
}

function getDiscountCodes(formData: FormData | URLSearchParams) {
  const discount = String(formData.get('discount') || '').trim();
  return discount ? [discount] : [];
}

type BridgeMode = 'replace' | 'append';

function getBridgeMode(formData: FormData | URLSearchParams): BridgeMode {
  return formData.get('mode') === 'append' ? 'append' : 'replace';
}
