import {redirect} from 'react-router';
import type {Route} from './+types/cart.bridge';

type AjaxCart = {
  items?: Array<{
    id?: number | string;
    variant_id?: number | string;
    quantity?: number | string;
    properties?: Record<string, unknown> | null;
  }>;
  note?: string | null;
};

const MAX_BRIDGE_LINES = 50;

export async function action({request, context}: Route.ActionArgs) {
  const formData = await request.formData();
  const payload = String(formData.get('payload') || '');
  const source = String(formData.get('source') || '');

  return importThemeCart({
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
  context,
  discountCodes,
  mode,
  payload,
  source,
}: {
  context: Route.ActionArgs['context'];
  discountCodes: string[];
  mode: BridgeMode;
  payload: string;
  source: string;
}) {
  if (!payload || source !== 'khoj-theme-cart') {
    return redirect('/cart?bridge=invalid');
  }

  const sourceCart = parseBridgePayload(payload);
  const lines = ajaxCartToCartLines(sourceCart);

  if (!lines.length) {
    return redirect('/cart?bridge=empty');
  }

  const existingCart = mode === 'append' ? await context.cart.get() : null;
  const result =
    existingCart?.id
      ? await context.cart.addLines(lines)
      : await context.cart.create({
          lines,
          discountCodes,
          note: sourceCart.note || undefined,
          attributes: [
            {
              key: 'cart_bridge_source',
              value: 'www.khoj.city',
            },
          ],
        });

  const cartResult = result.cart;

  if (result.errors?.length || !cartResult) {
    throw new Response('Unable to import cart. Please try again.', {
      status: 422,
    });
  }

  const headers = context.cart.setCartId(cartResult.id);
  return redirect('/cart?bridge=imported', {headers});
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

function propertiesToAttributes(properties: AjaxCart['items'][number]['properties']) {
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
