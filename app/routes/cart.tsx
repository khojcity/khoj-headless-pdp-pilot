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
          <p className="pilot-kicker">Shopify checkout</p>
          <h1>Your cart</h1>
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
        <section className="pilot-cart-layout">
          <div className="pilot-cart-lines">
            {lines.map((line: any) => (
              <CartLine key={line.id} line={line} />
            ))}
          </div>

          <aside className="pilot-cart-summary">
            <h2>Order summary</h2>
            <dl>
              <div>
                <dt>Subtotal</dt>
                <dd>
                  {cart?.cost?.subtotalAmount ? (
                    <Money data={cart.cost.subtotalAmount} />
                  ) : (
                    '-'
                  )}
                </dd>
              </div>
              <div>
                <dt>Quantity</dt>
                <dd>{cart?.totalQuantity || 0}</dd>
              </div>
            </dl>

            {cart?.checkoutUrl ? (
              <a
                className="pilot-button pilot-button-primary"
                href={cart.checkoutUrl}
                onClick={() => trackKhojActivity(checkoutTracking())}
              >
                Checkout
              </a>
            ) : null}

            <p>Free delivery and COD availability are confirmed in Shopify checkout.</p>
          </aside>
        </section>
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
        <Link to={`/products/${product.handle || ''}`}>
          {product.title || merchandise.title}
        </Link>

        {line.cost?.totalAmount ? <Money data={line.cost.totalAmount} /> : null}

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
