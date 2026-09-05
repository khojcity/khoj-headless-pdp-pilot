import {useLoaderData, Link, data, type HeadersFunction} from 'react-router';
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
        <Link to="/products/mor-pankh-classic-multi-color-hand-painted-necklace-set-hp-np">
          Continue shopping
        </Link>
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
          <section className="pilot-cart-progress" aria-label="Delivery reward">
            <div>
              <strong>Free delivery + automatic savings</strong>
              <span>Discounts are applied automatically based on cart value.</span>
            </div>
            <div className="pilot-cart-progress-bar">
              <span />
            </div>
          </section>

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

              {cart?.checkoutUrl ? (
                <a
                  className="pilot-button pilot-button-primary"
                  href={cart.checkoutUrl}
                  onClick={() => trackKhojActivity(checkoutTracking())}
                >
                  Proceed to checkout
                </a>
              ) : null}

              <AutomaticDiscountLadder subtotal={summary.compareAtTotal} />

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
              <a
                className="pilot-button pilot-button-primary"
                href={cart.checkoutUrl}
                onClick={() => trackKhojActivity(checkoutTracking())}
              >
                Checkout
              </a>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
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
    {label: '₹0-499', discount: 'No discount', min: 0},
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
        Current tier: {activeTier.discount}. Higher order values unlock bigger
        savings.
      </span>
      <div>
        {tiers.map((tier) => (
          <span
            className={tier.min === activeTier.min ? 'is-active' : undefined}
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
