import {
  useLoaderData,
  Link,
  Form,
  data,
  redirect,
  useNavigation,
  type HeadersFunction,
} from 'react-router';
import {useEffect, useState} from 'react';
import type {Route} from './+types/cart';
import type {CartQueryDataReturn} from '@shopify/hydrogen';
import {CartForm, Image, Money} from '@shopify/hydrogen';

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

    const checkoutPreference = getCheckoutPreference(formData);
    if (!checkoutPreference) {
      return redirect('/cart?checkoutPreference=required');
    }

    const preparedCart = await prepareKnownVisitorCheckout(
      request,
      context,
      currentCart,
      checkoutPreference,
    );
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
      if (intent === 'replaceVariantWithOne') {
        const currentCart = await cart.get();
        const incomingLine = inputs.lines?.[0];
        const matchingLineIds =
          currentCart?.lines?.nodes
            ?.filter(
              (line: any) =>
                line.merchandise?.id === incomingLine?.merchandiseId,
            )
            .map((line: any) => line.id) || [];

        if (matchingLineIds.length > 0) {
          await cart.removeLines(matchingLineIds);
        }

        result = await cart.addLines(
          incomingLine ? [{...incomingLine, quantity: 1}] : inputs.lines,
        );
      } else {
        result = await cart.addLines(inputs.lines);
      }
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
    const checkoutPreference = getCheckoutPreference(formData);
    if (!checkoutPreference) {
      status = 303;
      headers.set('Location', '/cart?checkoutPreference=required');
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

    const preparedCart = await prepareKnownVisitorCheckout(
      request,
      context,
      cartResult,
      checkoutPreference,
    );
    status = 303;
    headers.set('Location', preparedCart.checkoutUrl || cartResult.checkoutUrl);
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
  const savedCheckoutPreference = getSavedCheckoutPreference(cart);
  const [checkoutPreference, setCheckoutPreference] = useState(
    savedCheckoutPreference || '',
  );
  const codFee = checkoutPreference === 'cod' ? 60 : 0;
  const displayTotal = summary.subtotal + codFee;
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

            <CheckoutPreferenceSelector
              value={checkoutPreference}
              onChange={setCheckoutPreference}
            />

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
                  <dt>Shipping</dt>
                  <dd>
                    {checkoutPreference === 'cod'
                      ? 'COD + ₹60'
                      : 'Free'}
                  </dd>
                </div>
                <div className="pilot-cart-total-row">
                  <dt>Total</dt>
                  <dd>
                    {formatRupees(displayTotal)}
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
                  checkoutPreference={checkoutPreference}
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
                <strong>{formatRupees(displayTotal)}</strong>
                {!checkoutPreference ? (
                  <small>Select shipping type</small>
                ) : null}
              </div>
              <CheckoutForm
                checkoutPreference={checkoutPreference}
                label="Proceed to checkout"
              />
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
  checkoutPreference,
  label,
}: {
  checkoutPreference: string;
  label: string;
}) {
  const navigation = useNavigation();
  const [hasSubmittedCheckout, setHasSubmittedCheckout] = useState(false);
  const isPreparingCheckout = hasSubmittedCheckout;

  useEffect(() => {
    if (navigation.state === 'idle') {
      setHasSubmittedCheckout(false);
    }
  }, [navigation.state]);

  useEffect(() => {
    const resetPreparingCheckout = () => setHasSubmittedCheckout(false);
    const timeout = window.setTimeout(resetPreparingCheckout, 8000);

    window.addEventListener('pageshow', resetPreparingCheckout);
    window.addEventListener('focus', resetPreparingCheckout);
    document.addEventListener('visibilitychange', resetPreparingCheckout);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('pageshow', resetPreparingCheckout);
      window.removeEventListener('focus', resetPreparingCheckout);
      document.removeEventListener('visibilitychange', resetPreparingCheckout);
    };
  }, [hasSubmittedCheckout]);

  return (
    <Form
      method="post"
      className="pilot-checkout-form"
      onSubmit={() => setHasSubmittedCheckout(true)}
    >
      <input type="hidden" name="_intent" value="prepareCheckout" />
      <input
        type="hidden"
        name="checkoutPreference"
        value={checkoutPreference}
      />
      <button
        className="pilot-button pilot-button-primary"
        disabled={!checkoutPreference || isPreparingCheckout}
        type="submit"
      >
        {isPreparingCheckout ? 'Preparing checkout...' : label}
      </button>
      {isPreparingCheckout ? (
        <span className="pilot-checkout-progress" aria-hidden="true" />
      ) : null}
    </Form>
  );
}

function CheckoutPreferenceSelector({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <fieldset className="pilot-checkout-preference">
      <legend>Choose shipping type</legend>
      <label
        aria-label="Prepaid, free shipping"
        className={
          value === 'prepaid'
            ? 'pilot-checkout-option pilot-checkout-option-selected'
            : 'pilot-checkout-option'
        }
        htmlFor="checkout-preference-prepaid"
      >
        <input
          checked={value === 'prepaid'}
          id="checkout-preference-prepaid"
          name="checkoutPreferenceChoice"
          onChange={() => onChange('prepaid')}
          type="radio"
          value="prepaid"
        />
        <span>
          <strong>Prepaid</strong>
          <small>Free shipping</small>
        </span>
      </label>
      <label
        aria-label="Cash on delivery, 60 rupees COD shipping charge"
        className={
          value === 'cod'
            ? 'pilot-checkout-option pilot-checkout-option-selected'
            : 'pilot-checkout-option'
        }
        htmlFor="checkout-preference-cod"
      >
        <input
          checked={value === 'cod'}
          id="checkout-preference-cod"
          name="checkoutPreferenceChoice"
          onChange={() => onChange('cod')}
          type="radio"
          value="cod"
        />
        <span>
          <strong>Cash on delivery</strong>
          <small>₹60 COD shipping charge</small>
        </span>
      </label>
    </fieldset>
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

async function prepareKnownVisitorCheckout(
  request: Request,
  context: Route.ActionArgs['context'],
  currentCart: NonNullable<Awaited<ReturnType<Route.ActionArgs['context']['cart']['get']>>>,
  checkoutPreference?: CheckoutPreference,
) {
  const cartWithPreference = checkoutPreference
    ? await updateCartCheckoutPreference(context, currentCart, checkoutPreference)
    : currentCart;
  const profile = await loadKnownCheckoutProfile(request, context.env);
  if (!profile) {
    return checkoutPreference
      ? await selectCheckoutDeliveryOption(
          context,
          cartWithPreference,
          checkoutPreference,
        )
      : cartWithPreference;
  }

  const buyerIdentity = knownCheckoutProfileToBuyerIdentity(profile);
  const result = await context.cart.updateBuyerIdentity(
    buyerIdentity as any,
  );
  const cartWithBuyer = result.cart || cartWithPreference;
  return checkoutPreference
    ? await selectCheckoutDeliveryOption(context, cartWithBuyer, checkoutPreference)
    : cartWithBuyer;
}

type CheckoutPreference = 'prepaid' | 'cod';
type CheckoutCart = {id: string; checkoutUrl?: string | null};

function getCheckoutPreference(formData: FormData): CheckoutPreference | null {
  const value = String(formData.get('checkoutPreference') || '');
  return value === 'prepaid' || value === 'cod' ? value : null;
}

function getSavedCheckoutPreference(cart: any): CheckoutPreference | '' {
  const value = cart?.attributes?.find(
    (attribute: any) => attribute.key === 'checkout_payment_preference',
  )?.value;
  return value === 'prepaid' || value === 'cod' ? value : '';
}

async function updateCartCheckoutPreference(
  context: Route.ActionArgs['context'],
  currentCart: NonNullable<Awaited<ReturnType<Route.ActionArgs['context']['cart']['get']>>>,
  checkoutPreference: CheckoutPreference,
) {
  const result = await context.storefront.mutate(CART_ATTRIBUTES_UPDATE_MUTATION, {
    variables: {
      cartId: currentCart.id,
      attributes: [
        {
          key: 'checkout_payment_preference',
          value: checkoutPreference,
        },
        {
          key: 'checkout_shipping_label',
          value:
            checkoutPreference === 'cod'
              ? 'Cash on delivery - COD shipping charge ₹60'
              : 'Prepaid - Free shipping',
        },
      ],
    },
  });

  return result?.cartAttributesUpdate?.cart || currentCart;
}

async function selectCheckoutDeliveryOption(
  context: Route.ActionArgs['context'],
  currentCart: CheckoutCart,
  checkoutPreference: CheckoutPreference,
) {
  try {
    const deliveryCart = await context.storefront.query(CART_DELIVERY_OPTIONS_QUERY, {
      variables: {cartId: currentCart.id},
    });
    const groups = deliveryCart?.cart?.deliveryGroups?.nodes || [];
    const selectedDeliveryOptions = groups
      .map((group: any) => {
        const option = chooseDeliveryOption(group.deliveryOptions, checkoutPreference);
        if (!option?.handle) return null;
        return {
          deliveryGroupId: group.id,
          deliveryOptionHandle: option.handle,
        };
      })
      .filter(Boolean);

    if (!selectedDeliveryOptions.length) return currentCart;

    const result = await context.storefront.mutate(
      CART_SELECTED_DELIVERY_OPTIONS_UPDATE_MUTATION,
      {
        variables: {
          cartId: currentCart.id,
          selectedDeliveryOptions,
        },
      },
    );

    return result?.cartSelectedDeliveryOptionsUpdate?.cart || currentCart;
  } catch {
    return currentCart;
  }
}

function chooseDeliveryOption(
  deliveryOptions: any[] = [],
  checkoutPreference: CheckoutPreference,
) {
  if (checkoutPreference === 'cod') {
    return (
      deliveryOptions.find((option) => deliveryOptionMatches(option, ['cod'])) ||
      deliveryOptions.find((option) =>
        deliveryOptionMatches(option, ['cash on delivery']),
      ) ||
      deliveryOptions.find((option) => Number(option.estimatedCost?.amount) === 60)
    );
  }

  return (
    deliveryOptions.find(
      (option) =>
        !deliveryOptionMatches(option, ['cod', 'cash on delivery']) &&
        Number(option.estimatedCost?.amount) === 0,
    ) ||
    deliveryOptions.find((option) =>
      deliveryOptionMatches(option, ['prepaid', 'free']),
    )
  );
}

function deliveryOptionMatches(option: any, terms: string[]) {
  const label = `${option?.title || ''} ${option?.description || ''}`.toLowerCase();
  return terms.some((term) => label.includes(term));
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
              label="Decrease quantity"
            >
              -
            </CartQuantityButton>
            <span aria-label={`Quantity ${quantity}`}>{quantity}</span>
            <CartQuantityButton
              lineId={line.id}
              quantity={quantity + 1}
              label="Increase quantity"
            >
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
  label,
  lineId,
  quantity,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  lineId: string;
  quantity: number;
}) {
  return (
    <CartForm
      route="/cart"
      action={CartForm.ACTIONS.LinesUpdate}
      inputs={{lines: [{id: lineId, quantity}]}}
    >
      <button
        aria-label={label}
        className="pilot-cart-qty-button"
        disabled={disabled}
        type="submit"
      >
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
    subtotal,
  };
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

const CART_ATTRIBUTES_UPDATE_MUTATION = `#graphql
  mutation CartAttributesUpdate(
    $cartId: ID!
    $attributes: [AttributeInput!]!
  ) {
    cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
      cart {
        id
        checkoutUrl
        attributes {
          key
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const CART_DELIVERY_OPTIONS_QUERY = `#graphql
  query CartDeliveryOptions($cartId: ID!) {
    cart(id: $cartId) {
      id
      deliveryGroups(first: 5) {
        nodes {
          id
          deliveryOptions {
            handle
            title
            description
            estimatedCost {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
` as const;

const CART_SELECTED_DELIVERY_OPTIONS_UPDATE_MUTATION = `#graphql
  mutation CartSelectedDeliveryOptionsUpdate(
    $cartId: ID!
    $selectedDeliveryOptions: [CartSelectedDeliveryOptionInput!]!
  ) {
    cartSelectedDeliveryOptionsUpdate(
      cartId: $cartId
      selectedDeliveryOptions: $selectedDeliveryOptions
    ) {
      cart {
        id
        checkoutUrl
        deliveryGroups(first: 5) {
          nodes {
            id
            selectedDeliveryOption {
              handle
              title
              estimatedCost {
                amount
                currencyCode
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;
