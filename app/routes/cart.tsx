import {
  useLoaderData,
  Link,
  Form,
  data,
  redirect,
  type HeadersFunction,
} from 'react-router';
import type {Route} from './+types/cart';
import type {CartQueryDataReturn} from '@shopify/hydrogen';
import {CartForm, Image, Money} from '@shopify/hydrogen';
import {trackKhojActivity} from '~/components/KhojTracking';

export const meta: Route.MetaFunction = () => {
  return [{title: `Cart | KHOJ.CITY`}];
};

export const headers: HeadersFunction = ({actionHeaders}) => actionHeaders;

export async function action({request, context}: Route.ActionArgs) {
  const {cart} = context;

  const formData = await request.formData();
  const intent = String(formData.get('_intent') || '');

  if (intent === 'prepareCheckout') {
    const currentCart = await cart.get();
    if (!currentCart?.checkoutUrl) {
      return redirect('/cart');
    }

    const profile = await loadKnownCheckoutProfile(request, context.env);
    let preparedCart = currentCart;

    if (profile) {
      const result = await cart.updateBuyerIdentity(
        knownCheckoutProfileToBuyerIdentity(profile) as any,
      );
      preparedCart = result.cart || currentCart;
    }

    return redirect(preparedCart.checkoutUrl || currentCart.checkoutUrl);
  }

  const {action, inputs} = CartForm.getFormInput(formData);

  if (!action) {
    throw new Error('No action provided');
  }

  let status = 200;
  let result: CartQueryDataReturn;

  switch (action) {
    case CartForm.ACTIONS.LinesAdd:
      result = await cart.addLines(inputs.lines);
      break;
    case CartForm.ACTIONS.LinesUpdate:
      result = await cart.updateLines(inputs.lines);
      break;
    case CartForm.ACTIONS.LinesRemove:
      result = await cart.removeLines(inputs.lineIds);
      break;
    case CartForm.ACTIONS.DiscountCodesUpdate: {
      const formDiscountCode = inputs.discountCode;

      // User inputted discount code
      const discountCodes = (
        formDiscountCode ? [formDiscountCode] : []
      ) as string[];

      // Combine discount codes already applied on cart
      discountCodes.push(...inputs.discountCodes);

      result = await cart.updateDiscountCodes(discountCodes);
      break;
    }
    case CartForm.ACTIONS.GiftCardCodesAdd: {
      const formGiftCardCode = inputs.giftCardCode;

      const giftCardCodes = (
        formGiftCardCode ? [formGiftCardCode] : []
      ) as string[];

      result = await cart.addGiftCardCodes(giftCardCodes);
      break;
    }
    case CartForm.ACTIONS.GiftCardCodesRemove: {
      const appliedGiftCardIds = inputs.giftCardCodes as string[];
      result = await cart.removeGiftCardCodes(appliedGiftCardIds);
      break;
    }
    case CartForm.ACTIONS.BuyerIdentityUpdate: {
      result = await cart.updateBuyerIdentity({
        ...inputs.buyerIdentity,
      });
      break;
    }
    default:
      throw new Error(`${action} cart action is not defined`);
  }

  const cartId = result?.cart?.id;
  const headers = cartId ? cart.setCartId(result.cart.id) : new Headers();
  const {cart: cartResult, errors, warnings} = result;

  const redirectTo = formData.get('redirectTo') ?? null;
  if (redirectTo === 'checkout' && cartResult?.checkoutUrl) {
    status = 303;
    headers.set('Location', cartResult.checkoutUrl);
  } else if (typeof redirectTo === 'string') {
    status = 303;
    headers.set('Location', redirectTo);
  }

  return data(
    {
      cart: cartResult,
      errors,
      warnings,
      analytics: {
        cartId,
      },
    },
    {status, headers},
  );
}

export async function loader({context}: Route.LoaderArgs) {
  const {cart} = context;
  return await cart.get();
}

export default function Cart() {
  const cart = useLoaderData<typeof loader>();
  const lines = cart?.lines?.nodes || [];
  const hasItems = lines.length > 0;
  const totalQuantity = cart?.totalQuantity || 0;
  const summary = getCartSummary(cart, lines);
  const checkoutTracking = () => ({
    eventType: 'checkout_started',
    eventId: `hydrogen_cart_checkout:${cart?.id || 'cart'}:${Date.now()}`,
    items: lines.map((line: any) => {
      const merchandise = line.merchandise || {};
      return {
        id: merchandise.product?.id || merchandise.id || line.id,
        variantId: merchandise.id,
        handle: merchandise.product?.handle,
        url: merchandise.product?.handle
          ? `https://www.khoj.city/products/${merchandise.product.handle}`
          : undefined,
        title: merchandise.product?.title || merchandise.title || 'Cart item',
        variantTitle: merchandise.title,
        vendor: merchandise.product?.vendor,
        price: line.cost?.totalAmount,
        quantity: line.quantity || 1,
      };
    }),
    totalPrice: cart?.cost?.subtotalAmount,
    checkoutUrl: cart?.checkoutUrl,
  });

  return (
    <main className="pilot-cart">
      <div className="pilot-cart-header">
        <div>
          <p className="pilot-kicker">Review your order</p>
          <h1>Your cart</h1>
          <p>
            Review your handmade jewellery order before moving to checkout.
          </p>
        </div>
      </div>

      {!hasItems ? (
        <section className="pilot-cart-empty">
          <h2>Your cart is empty</h2>
          <p>Choose the Mor Pankh necklace set to continue the pilot flow.</p>
          <Link
            className="pilot-button pilot-button-primary"
            to="/products/mor-pankh-classic-multi-color-hand-painted-necklace-set-hp-np"
          >
            View product
          </Link>
        </section>
      ) : (
        <>
          <AutomaticDiscountLadder subtotal={summary.compareAtTotal} />
          <CartInfographic
            alt="Automatic savings. Discounts apply automatically based on your cart value."
            src="/infographics/automatic-savings.jpg"
          />

          <section className="pilot-cart-layout">
            <div className="pilot-cart-lines">
              <div className="pilot-cart-section-heading">
                <h2>Review your order</h2>
                <span>
                  {totalQuantity} {totalQuantity === 1 ? 'item' : 'items'}
                </span>
              </div>
              {lines.map((line: any) => (
                <CartLine key={line.id} line={line} />
              ))}
            </div>

            <aside className="pilot-cart-summary">
              <h2>Price breakdown</h2>
              <dl>
                <div>
                  <dt>MRP</dt>
                  <dd>{formatRupees(summary.compareAtTotal)}</dd>
                </div>
                <div>
                  <dt>Discount</dt>
                  <dd className="pilot-cart-saving">
                    -{formatRupees(summary.savings)}
                  </dd>
                </div>
                <div>
                  <dt>Delivery fee</dt>
                  <dd>
                    <span className="pilot-cart-strike">₹49</span> Free
                  </dd>
                </div>
                <div className="pilot-cart-total-row">
                  <dt>Total</dt>
                  <dd>
                    {cart?.cost?.subtotalAmount ? (
                      <Money data={cart.cost.subtotalAmount} />
                    ) : (
                      '-'
                    )}
                  </dd>
                </div>
              </dl>

              {summary.savings > 0 ? (
                <p className="pilot-cart-savings">
                  You save {formatRupees(summary.savings)} on this order.
                </p>
              ) : null}

              <CartInfographic
                alt="Free delivery and COD. Shop comfortably with delivery across India."
                src="/infographics/free-delivery-cod.jpg"
              />

              {cart?.checkoutUrl ? (
                <CheckoutForm
                  checkoutTracking={checkoutTracking}
                  label="Proceed to checkout"
                />
              ) : null}

              <div className="pilot-cart-trust">
                <span>COD available</span>
                <span>Secure checkout</span>
                <span>Easy order support</span>
              </div>
            </aside>
          </section>

          {cart?.checkoutUrl ? (
            <div className="pilot-cart-sticky">
              <div>
                <span>Total</span>
                <strong>
                  {cart?.cost?.subtotalAmount ? (
                    <Money data={cart.cost.subtotalAmount} />
                  ) : (
                    '-'
                  )}
                </strong>
              </div>
              <CheckoutForm checkoutTracking={checkoutTracking} label="Checkout" />
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

function CartInfographic({alt, src}: {alt: string; src: string}) {
  return (
    <section
      className="pilot-cart-infographic"
      aria-label="Khoj cart benefits"
    >
      <img
        alt={alt}
        decoding="async"
        loading="lazy"
        src={src}
      />
    </section>
  );
}

function CheckoutForm({
  checkoutTracking,
  label,
}: {
  checkoutTracking: () => Parameters<typeof trackKhojActivity>[0];
  label: string;
}) {
  return (
    <Form
      method="post"
      className="pilot-checkout-form"
      onSubmit={() => trackKhojActivity(checkoutTracking())}
    >
      <input type="hidden" name="_intent" value="prepareCheckout" />
      <button className="pilot-button pilot-button-primary" type="submit">
        {label}
      </button>
    </Form>
  );
}

type KnownCheckoutProfile = {
  email?: string;
  phone?: string;
  address?: {
    firstName?: string;
    lastName?: string;
    company?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    provinceCode?: string;
    country?: string;
    countryCode?: string;
    zip?: string;
    phone?: string;
  };
};

async function loadKnownCheckoutProfile(request: Request, env: Env) {
  const endpoint = env.PUBLIC_KHOJ_SITE_ACTIVITY_ENDPOINT;
  const token = env.PUBLIC_KHOJ_SITE_ACTIVITY_PUBLIC_TOKEN;
  if (!endpoint || !token) return null;

  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  const visitorId = cookies.khoj_visitor_id || '';
  const deviceId = cookies.khoj_device_id || '';
  const visitorCustomerId = cookies.khoj_visitor_customer_id || '';
  if (!visitorId && !visitorCustomerId) return null;

  const url = endpoint.replace(/\/site-activity\/?$/, '/site-activity/checkout-prefill');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        token,
        visitor_id: visitorId,
        device_id: deviceId,
        visitor: visitorCustomerId ? {id: visitorCustomerId} : undefined,
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as KnownCheckoutProfile & {
      found?: boolean;
      success?: boolean;
    };
    if (!payload.success || !payload.found) return null;
    return payload;
  } catch {
    return null;
  }
}

function knownCheckoutProfileToBuyerIdentity(profile: KnownCheckoutProfile) {
  const address = removeEmptyValues(profile.address || {});
  const buyerIdentity: Record<string, unknown> = {
    countryCode: 'IN',
  };
  if (profile.email) buyerIdentity.email = profile.email;
  if (profile.phone) buyerIdentity.phone = profile.phone;
  if (address.address1) {
    buyerIdentity.deliveryAddressPreferences = [
      {
        deliveryAddress: {
          firstName: address.firstName,
          lastName: address.lastName,
          company: address.company,
          address1: address.address1,
          address2: address.address2,
          city: address.city,
          province: address.province,
          country: address.country || 'India',
          zip: address.zip,
          phone: address.phone || profile.phone,
        },
      },
    ];
  }
  return removeEmptyValues(buyerIdentity);
}

function removeEmptyValues<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ''),
  );
}

function parseCookieHeader(header: string) {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...value] = part.split('=');
        try {
          return [name, decodeURIComponent(value.join('='))];
        } catch {
          return [name, value.join('=')];
        }
      }),
  ) as Record<string, string>;
}

function CartLine({line}: {line: any}) {
  const quantity = line.quantity || 1;
  const merchandise = line.merchandise || {};
  const product = merchandise.product || {};
  const selectedOptions = merchandise.selectedOptions || [];

  return (
    <article className="pilot-cart-line">
      {merchandise.image ? (
        <Image
          data={merchandise.image}
          alt={merchandise.image.altText || product.title || merchandise.title}
          sizes="120px"
          loading="lazy"
        />
      ) : null}

      <div className="pilot-cart-line-body">
        <div className="pilot-cart-line-title">
          <Link to={`/products/${product.handle || ''}`}>
            {product.title || merchandise.title}
          </Link>
          {line.cost?.totalAmount ? <Money data={line.cost.totalAmount} /> : null}
        </div>

        <p>Handmade jewellery · Free delivery</p>

        {selectedOptions.length ? (
          <ul>
            {selectedOptions
              .filter((option: any) => option.value !== 'Default Title')
              .map((option: any) => (
                <li key={option.name}>
                  {option.name}: {option.value}
                </li>
              ))}
          </ul>
        ) : null}

        <div className="pilot-cart-controls">
          <div className="pilot-cart-stepper" aria-label="Quantity">
            <CartQuantityButton
              lineId={line.id}
              quantity={Math.max(0, quantity - 1)}
              disabled={quantity <= 1}
            >
              -
            </CartQuantityButton>
            <span>{quantity}</span>
            <CartQuantityButton lineId={line.id} quantity={quantity + 1}>
              +
            </CartQuantityButton>
          </div>
          <CartRemoveButton lineId={line.id} />
        </div>
      </div>
    </article>
  );
}

function CartQuantityButton({
  children,
  disabled,
  lineId,
  quantity,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  lineId: string;
  quantity: number;
}) {
  return (
    <CartForm
      route="/cart"
      action={CartForm.ACTIONS.LinesUpdate}
      inputs={{lines: [{id: lineId, quantity}]}}
    >
      <button disabled={disabled} type="submit">
        {children}
      </button>
    </CartForm>
  );
}

function getCartSummary(cart: any, lines: any[]) {
  const subtotal = Number(cart?.cost?.subtotalAmount?.amount || 0);
  const compareAtTotal = lines.reduce((total, line) => {
    const quantity = Number(line.quantity || 1);
    const compareAt = Number(
      line.cost?.compareAtAmountPerQuantity?.amount ||
        line.merchandise?.compareAtPrice?.amount ||
        line.cost?.amountPerQuantity?.amount ||
        0,
    );
    return total + compareAt * quantity;
  }, 0);

  return {
    compareAtTotal: Math.max(compareAtTotal, subtotal),
    savings: Math.max(0, compareAtTotal - subtotal),
  };
}

function AutomaticDiscountLadder({subtotal}: {subtotal: number}) {
  const tiers = [
    {label: '₹500-999', discount: '5% off', min: 500},
    {label: '₹1000-1499', discount: '10% off', min: 1000},
    {label: '₹1500-1999', discount: '15% off', min: 1500},
    {label: '₹2000+', discount: '20% off', min: 2000},
  ];

  const activeTier = tiers.reduce(
    (active, tier) => (subtotal >= tier.min ? tier : active),
    tiers[0],
  );

  return (
    <div className="pilot-cart-ladder" aria-label="Automatic discount tiers">
      <strong>Automatic discount applied</strong>
      <span>
        Current tier: {subtotal >= 500 ? activeTier.discount : 'unlocked above ₹500'}.
        Higher cart values unlock bigger savings.
      </span>
      <div>
        {tiers.map((tier) => (
          <span
            className={
              subtotal >= tier.min && tier.min === activeTier.min
                ? 'is-active'
                : undefined
            }
            key={tier.label}
          >
            {tier.label}
            <b>{tier.discount}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function formatRupees(amount: number) {
  return `₹${amount.toLocaleString('en-IN', {
    maximumFractionDigits: amount % 1 ? 2 : 0,
    minimumFractionDigits: amount % 1 ? 2 : 0,
  })}`;
}

function CartRemoveButton({lineId}: {lineId: string}) {
  return (
    <CartForm
      route="/cart"
      action={CartForm.ACTIONS.LinesRemove}
      inputs={{lineIds: [lineId]}}
    >
      <button className="pilot-cart-remove" type="submit">
        Remove
      </button>
    </CartForm>
  );
}
