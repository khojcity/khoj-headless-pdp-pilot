import {
  useLoaderData,
  Link,
  Form,
  data,
  redirect,
  useNavigation,
  useFetcher,
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

const KHOJ_WORKING_SITE_ACTIVITY_ENDPOINT =
  'https://khoj-wa-inbox-capi-test-ko6t5h22wq-el.a.run.app/api/shopify/site-activity';
const KHOJ_STUCK_SITE_ACTIVITY_HOSTS = [
  'khoj-wa-inbox-ko6t5h22wq-el.a.run.app',
  'khoj-wa-inbox-364232686531.asia-south1.run.app',
];

function khojSiteActivityEndpoint(endpoint?: string) {
  const rawEndpoint = endpoint || '';
  if (!rawEndpoint) return KHOJ_WORKING_SITE_ACTIVITY_ENDPOINT;
  return KHOJ_STUCK_SITE_ACTIVITY_HOSTS.some((host) =>
    rawEndpoint.includes(host),
  )
    ? KHOJ_WORKING_SITE_ACTIVITY_ENDPOINT
    : rawEndpoint;
}

export async function action({request, context}: Route.ActionArgs) {
  const {cart} = context;

  const formData = await request.formData();
  const intent = String(formData.get('_intent') || '');

  if (intent === 'shiprocketAddressInitiate') {
    return data(await initiateShiprocketAddressLogin(formData, context.env));
  }

  if (intent === 'shiprocketAddressVerify') {
    return data(await verifyShiprocketAddressLogin(formData, context.env));
  }

  if (intent === 'prepareCheckout') {
    const currentCart = await cart.get();
    if (!currentCart?.checkoutUrl) {
      return redirect('/cart');
    }

    const checkoutPreference = getCheckoutPreference(formData);
    if (!checkoutPreference) {
      return redirect('/cart?checkoutPreference=required');
    }

    const checkoutIdentity = checkoutIdentityFromForm(formData);
    if (formData.get('addressFlow') === 'completed' && !checkoutIdentity) {
      return data(
        {error: 'Enter a valid email and complete delivery address.'},
        {status: 400},
      );
    }
    let preparedCart;
    if (checkoutIdentity) {
      preparedCart = await prepareCheckoutWithIdentity(
        context,
        currentCart,
        checkoutPreference,
        checkoutIdentity,
      );
    } else {
      const knownProfile = await loadKnownCheckoutProfile(request, context.env);
      if (!isCompleteKnownCheckoutProfile(knownProfile)) {
        return redirect('/cart?address=required');
      }
      preparedCart = await prepareKnownVisitorCheckout(
        request,
        context,
        currentCart,
        checkoutPreference,
        knownProfile,
      );
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

export async function loader({context, request}: Route.LoaderArgs) {
  const {cart} = context;
  const [cartResult, knownProfile] = await Promise.all([
    cart.get(),
    loadKnownCheckoutProfile(request, context.env),
  ]);
  const forceAddressFlow =
    new URL(request.url).searchParams.get('address') === 'required';
  return {
    cart: cartResult,
    knownCheckoutReady:
      !forceAddressFlow && isCompleteKnownCheckoutProfile(knownProfile),
  };
}

export default function Cart() {
  const {cart, knownCheckoutReady} = useLoaderData<typeof loader>();
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
  const [addressFlowOpen, setAddressFlowOpen] = useState(false);
  return (
    <main className="pilot-cart">
      <div className="pilot-cart-header">
        <div>
          <p className="pilot-kicker">Review your order</p>
          <h1>Your cart</h1>
          <p>Review your handmade jewellery order before moving to checkout.</p>
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
                  <dd>{checkoutPreference === 'cod' ? 'COD + ₹60' : 'Free'}</dd>
                </div>
                <div className="pilot-cart-total-row">
                  <dt>Total</dt>
                  <dd>{formatRupees(displayTotal)}</dd>
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
                <CheckoutStartButton
                  checkoutPreference={checkoutPreference}
                  knownCheckoutReady={knownCheckoutReady}
                  label="Proceed to checkout"
                  onClick={() => setAddressFlowOpen(true)}
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
              <CheckoutStartButton
                checkoutPreference={checkoutPreference}
                knownCheckoutReady={knownCheckoutReady}
                label="Proceed to checkout"
                onClick={() => setAddressFlowOpen(true)}
              />
            </div>
          ) : null}
          {addressFlowOpen ? (
            <AddressCheckoutFlow
              checkoutPreference={checkoutPreference}
              onClose={() => setAddressFlowOpen(false)}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

function CartInfographic({alt, src}: {alt: string; src: string}) {
  return (
    <section className="pilot-cart-infographic" aria-label="Khoj cart benefits">
      <img alt={alt} decoding="async" loading="lazy" src={src} />
    </section>
  );
}

function CheckoutStartButton({
  checkoutPreference,
  knownCheckoutReady,
  label,
  onClick,
}: {
  checkoutPreference: string;
  knownCheckoutReady: boolean;
  label: string;
  onClick: () => void;
}) {
  if (knownCheckoutReady) {
    return (
      <CheckoutForm checkoutPreference={checkoutPreference} label={label} />
    );
  }
  return (
    <button
      className="pilot-button pilot-button-primary"
      disabled={!checkoutPreference}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

type DeliveryAddress = {
  first_name?: string;
  last_name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  phone?: string;
};

function AddressCheckoutFlow({
  checkoutPreference,
  onClose,
}: {
  checkoutPreference: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<any>();
  const [step, setStep] = useState<'phone' | 'otp' | 'address' | 'manual'>(
    'phone',
  );
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loginToken, setLoginToken] = useState('');
  const [address, setAddress] = useState<DeliveryAddress | null>(null);
  useEffect(() => {
    if (fetcher.data?.loginToken) {
      setLoginToken(fetcher.data.loginToken);
      setStep('otp');
    }
    if (fetcher.data?.addresses) {
      setAddress(fetcher.data.addresses[0] || null);
      setStep(fetcher.data.addresses.length ? 'address' : 'manual');
    }
  }, [fetcher.data]);
  const busy = fetcher.state !== 'idle';
  const error = fetcher.data?.error;
  return (
    <div
      className="pilot-address-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Delivery details"
    >
      <section className="pilot-address-sheet">
        <header>
          <button aria-label="Close" onClick={onClose} type="button">
            ×
          </button>
          <strong>KHOJ.CITY</strong>
          <span />
        </header>
        <div className="pilot-address-body">
          <div className="pilot-address-summary">
            <span>Order summary</span>
            <strong>Secure checkout</strong>
          </div>
          {error ? <p className="pilot-address-error">{error}</p> : null}
          {step === 'phone' ? (
            <fetcher.Form method="post">
              <input
                name="_intent"
                type="hidden"
                value="shiprocketAddressInitiate"
              />
              <p className="pilot-kicker">Faster checkout</p>
              <h2>Enter mobile number</h2>
              <p>Verify your mobile to retrieve saved delivery addresses.</p>
              <label>
                Mobile number
                <input
                  name="phone"
                  inputMode="numeric"
                  pattern="[0-9]{10}"
                  required
                  value={phone}
                  onChange={(e) =>
                    setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                />
              </label>
              <label className="pilot-address-consent">
                <input name="consent" required type="checkbox" />I consent to
                retrieving my saved delivery addresses for this checkout.
              </label>
              <button
                className="pilot-button pilot-button-primary"
                disabled={busy || phone.length !== 10}
              >
                Send OTP
              </button>
              <button
                className="pilot-address-secondary"
                onClick={() => setStep('manual')}
                type="button"
              >
                Enter address manually
              </button>
            </fetcher.Form>
          ) : null}
          {step === 'otp' ? (
            <fetcher.Form method="post">
              <input
                name="_intent"
                type="hidden"
                value="shiprocketAddressVerify"
              />
              <input name="loginToken" type="hidden" value={loginToken} />
              <input name="phone" type="hidden" value={phone} />
              <p className="pilot-kicker">Verify mobile</p>
              <h2>Enter OTP</h2>
              <p>Sent to +91 {phone}</p>
              <label className="pilot-otp-label">
                One-time password
                <span className="pilot-otp-input">
                  <input
                    aria-label="Six-digit one-time password"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    name="otp"
                    pattern="[0-9]{6}"
                    required
                    value={otp}
                    onChange={(event) =>
                      setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                  />
                  <span aria-hidden="true" className="pilot-otp-boxes">
                    {Array.from({length: 6}, (_, index) => (
                      <span
                        className={index === otp.length ? 'active' : ''}
                        key={index}
                      >
                        {otp[index] || ''}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
              <button
                className="pilot-button pilot-button-primary"
                disabled={busy || otp.length !== 6}
              >
                Verify and fetch address
              </button>
              <button
                className="pilot-address-secondary"
                onClick={() => setStep('manual')}
                type="button"
              >
                Enter address manually
              </button>
            </fetcher.Form>
          ) : null}
          {step === 'address' && address ? (
            <CheckoutIdentityForm
              address={address}
              checkoutPreference={checkoutPreference}
              onManual={() => setStep('manual')}
            />
          ) : null}
          {step === 'manual' ? (
            <CheckoutIdentityForm
              address={{phone}}
              checkoutPreference={checkoutPreference}
              manual
              onManual={() => setStep('phone')}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CheckoutIdentityForm({
  address,
  checkoutPreference,
  manual = false,
  onManual,
}: {
  address: DeliveryAddress;
  checkoutPreference: string;
  manual?: boolean;
  onManual: () => void;
}) {
  if (!manual) {
    return (
      <Form method="post" className="pilot-address-form">
        <input name="_intent" type="hidden" value="prepareCheckout" />
        <input name="addressFlow" type="hidden" value="completed" />
        <input
          name="checkoutPreference"
          type="hidden"
          value={checkoutPreference}
        />
        <input
          name="firstName"
          type="hidden"
          value={address.first_name || ''}
        />
        <input name="lastName" type="hidden" value={address.last_name || ''} />
        <input name="address1" type="hidden" value={address.line1 || ''} />
        <input name="address2" type="hidden" value={address.line2 || ''} />
        <input name="zip" type="hidden" value={address.pincode || ''} />
        <input name="city" type="hidden" value={address.city || ''} />
        <input name="province" type="hidden" value={address.state || ''} />
        <input name="phone" type="hidden" value={address.phone || ''} />
        <p className="pilot-kicker">Saved address found</p>
        <h2>Confirm delivery details</h2>
        <section className="pilot-saved-address">
          <strong>
            {[address.first_name, address.last_name].filter(Boolean).join(' ')}
          </strong>
          <p>
            {[
              address.line1,
              address.line2,
              address.city,
              address.state,
              address.pincode,
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
          <span>{address.phone}</span>
        </section>
        <label>
          Email address
          <input name="email" type="email" required />
        </label>
        <p className="pilot-address-email-note">
          Required for order confirmation and delivery updates.
        </p>
        <button className="pilot-button pilot-button-primary" type="submit">
          Continue to secure checkout
        </button>
        <button
          className="pilot-address-secondary"
          onClick={onManual}
          type="button"
        >
          Change delivery address
        </button>
      </Form>
    );
  }
  return (
    <Form method="post" className="pilot-address-form">
      <input name="_intent" type="hidden" value="prepareCheckout" />
      <input name="addressFlow" type="hidden" value="completed" />
      <input
        name="checkoutPreference"
        type="hidden"
        value={checkoutPreference}
      />
      <p className="pilot-kicker">
        {manual ? 'Manual delivery address' : 'Saved address found'}
      </p>
      <h2>
        {manual ? 'Where should we deliver?' : 'Confirm delivery details'}
      </h2>
      <p>Email is required for order confirmation and delivery updates.</p>
      <div className="pilot-address-grid">
        <label className="wide">
          Email address
          <input name="email" type="email" required />
        </label>
        <label>
          First name
          <input
            defaultValue={address.first_name || ''}
            name="firstName"
            required
          />
        </label>
        <label>
          Last name
          <input
            defaultValue={address.last_name || ''}
            name="lastName"
            required
          />
        </label>
        <label className="wide">
          House number and street
          <input defaultValue={address.line1 || ''} name="address1" required />
        </label>
        <label className="wide">
          Area and landmark
          <input defaultValue={address.line2 || ''} name="address2" />
        </label>
        <label>
          Pincode
          <input
            defaultValue={address.pincode || ''}
            name="zip"
            inputMode="numeric"
            required
          />
        </label>
        <label>
          City
          <input defaultValue={address.city || ''} name="city" required />
        </label>
        <label>
          State
          <input defaultValue={address.state || ''} name="province" required />
        </label>
        <label>
          Mobile
          <input defaultValue={address.phone || ''} name="phone" required />
        </label>
      </div>
      <button className="pilot-button pilot-button-primary" type="submit">
        Continue to secure checkout
      </button>
      <button
        className="pilot-address-secondary"
        onClick={onManual}
        type="button"
      >
        {manual ? 'Use saved address' : 'Enter a different address'}
      </button>
    </Form>
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
  const isPending = !value;
  return (
    <fieldset
      className={
        isPending
          ? 'pilot-checkout-preference pilot-checkout-preference-pending'
          : 'pilot-checkout-preference'
      }
    >
      <legend>
        Choose shipping type
        {isPending ? <span>Select one to continue</span> : null}
      </legend>
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

async function shiprocketRequest(
  env: Env,
  path: string,
  body: Record<string, unknown>,
  signed = false,
) {
  const baseUrl =
    env.SHIPROCKET_CHECKOUT_BASE_URL || 'https://checkout-api.shiprocket.com';
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  const payload = JSON.stringify(body);
  if (signed) {
    if (!env.SHIPROCKET_CHECKOUT_API_KEY || !env.SHIPROCKET_CHECKOUT_API_SECRET)
      throw new Error('Saved-address service is not configured.');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.SHIPROCKET_CHECKOUT_API_SECRET),
      {name: 'HMAC', hash: 'SHA-256'},
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload),
    );
    headers['X-Api-Key'] = env.SHIPROCKET_CHECKOUT_API_KEY;
    headers['X-Api-HMAC-SHA256'] = btoa(
      String.fromCharCode(...new Uint8Array(signature)),
    );
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: payload,
  });
  const result = (await response.json()) as any;
  if (!response.ok || result?.ok === false)
    throw new Error(
      result?.error?.message || 'Saved-address service request failed.',
    );
  return result;
}

async function initiateShiprocketAddressLogin(formData: FormData, env: Env) {
  const phone = String(formData.get('phone') || '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(phone) || formData.get('consent') !== 'on')
    return {error: 'Enter a valid 10-digit mobile number and accept consent.'};
  try {
    const result = await shiprocketRequest(
      env,
      '/api/v1/access-token/s2s-login/initiate',
      {
        country_code: '91',
        phone,
        modes: ['SMS'],
        timestamp: new Date().toISOString(),
      },
      true,
    );
    return {loginToken: result?.result?.token, phone};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not send OTP.',
    };
  }
}

async function verifyShiprocketAddressLogin(formData: FormData, env: Env) {
  const otp = String(formData.get('otp') || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(otp)) return {error: 'Enter the six-digit OTP.'};
  try {
    const verified = await shiprocketRequest(
      env,
      '/api/v1/access-token/s2s-login/verify',
      {
        token: String(formData.get('loginToken') || ''),
        otp,
        user_address_consent: true,
      },
    );
    const customerToken = verified?.result?.authorised_customer_token;
    if (!customerToken)
      return {error: 'OTP verification did not return an address token.'};
    const customer = await shiprocketRequest(env, '/api/v1/customer-data', {
      token: customerToken,
    });
    return {addresses: customer?.result?.addresses || []};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not verify OTP.',
    };
  }
}

function checkoutIdentityFromForm(formData: FormData) {
  const value = (name: string) => String(formData.get(name) || '').trim();
  const email = value('email');
  const phone = value('phone').replace(/\D/g, '');
  if (
    !/^\S+@\S+\.\S+$/.test(email) ||
    !value('firstName') ||
    !value('lastName') ||
    !value('address1') ||
    !value('city') ||
    !value('province') ||
    !/^\d{6}$/.test(value('zip')) ||
    phone.length < 10
  )
    return null;
  return {
    countryCode: 'IN',
    email,
    phone: `+91${phone.slice(-10)}`,
    deliveryAddressPreferences: [
      {
        deliveryAddress: {
          firstName: value('firstName'),
          lastName: value('lastName'),
          address1: value('address1'),
          address2: value('address2'),
          city: value('city'),
          province: value('province'),
          country: 'India',
          zip: value('zip'),
          phone: `+91${phone.slice(-10)}`,
        },
      },
    ],
  };
}

async function prepareCheckoutWithIdentity(
  context: Route.ActionArgs['context'],
  currentCart: NonNullable<
    Awaited<ReturnType<Route.ActionArgs['context']['cart']['get']>>
  >,
  checkoutPreference: CheckoutPreference,
  buyerIdentity: Record<string, unknown>,
) {
  const preferred = await updateCartCheckoutPreference(
    context,
    currentCart,
    checkoutPreference,
  );
  const result = await context.cart.updateBuyerIdentity(buyerIdentity as any);
  return await selectCheckoutDeliveryOption(
    context,
    result.cart || preferred,
    checkoutPreference,
  );
}

async function loadKnownCheckoutProfile(request: Request, env: Env) {
  const endpoint = khojSiteActivityEndpoint(
    env.PUBLIC_KHOJ_SITE_ACTIVITY_ENDPOINT,
  );
  const token = env.PUBLIC_KHOJ_SITE_ACTIVITY_PUBLIC_TOKEN;
  if (!endpoint || !token) return null;

  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  const visitorId = cookies.khoj_visitor_id || '';
  const deviceId = cookies.khoj_device_id || '';
  const visitorCustomerId = cookies.khoj_visitor_customer_id || '';
  if (!visitorId && !visitorCustomerId) return null;

  const url = endpoint.replace(
    /\/site-activity\/?$/,
    '/site-activity/checkout-prefill',
  );
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

function isCompleteKnownCheckoutProfile(
  profile: KnownCheckoutProfile | null,
): profile is KnownCheckoutProfile {
  const address = profile?.address;
  return Boolean(
    profile?.email &&
    /^\S+@\S+\.\S+$/.test(profile.email) &&
    profile.phone &&
    address?.firstName &&
    address.lastName &&
    address.address1 &&
    address.city &&
    (address.province || address.provinceCode) &&
    address.zip,
  );
}

async function prepareKnownVisitorCheckout(
  request: Request,
  context: Route.ActionArgs['context'],
  currentCart: NonNullable<
    Awaited<ReturnType<Route.ActionArgs['context']['cart']['get']>>
  >,
  checkoutPreference?: CheckoutPreference,
  knownProfile?: KnownCheckoutProfile | null,
) {
  const cartWithPreference = checkoutPreference
    ? await updateCartCheckoutPreference(
        context,
        currentCart,
        checkoutPreference,
      )
    : currentCart;
  const profile =
    knownProfile || (await loadKnownCheckoutProfile(request, context.env));
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
  const result = await context.cart.updateBuyerIdentity(buyerIdentity as any);
  const cartWithBuyer = result.cart || cartWithPreference;
  return checkoutPreference
    ? await selectCheckoutDeliveryOption(
        context,
        cartWithBuyer,
        checkoutPreference,
      )
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
  currentCart: NonNullable<
    Awaited<ReturnType<Route.ActionArgs['context']['cart']['get']>>
  >,
  checkoutPreference: CheckoutPreference,
) {
  const result = await context.storefront.mutate(
    CART_ATTRIBUTES_UPDATE_MUTATION,
    {
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
    },
  );

  return result?.cartAttributesUpdate?.cart || currentCart;
}

async function selectCheckoutDeliveryOption(
  context: Route.ActionArgs['context'],
  currentCart: CheckoutCart,
  checkoutPreference: CheckoutPreference,
) {
  try {
    const deliveryCart = await context.storefront.query(
      CART_DELIVERY_OPTIONS_QUERY,
      {
        variables: {cartId: currentCart.id},
      },
    );
    const groups = deliveryCart?.cart?.deliveryGroups?.nodes || [];
    const selectedDeliveryOptions = groups
      .map((group: any) => {
        const option = chooseDeliveryOption(
          group.deliveryOptions,
          checkoutPreference,
        );
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
      deliveryOptions.find((option) =>
        deliveryOptionMatches(option, ['cod']),
      ) ||
      deliveryOptions.find((option) =>
        deliveryOptionMatches(option, ['cash on delivery']),
      ) ||
      deliveryOptions.find(
        (option) => Number(option.estimatedCost?.amount) === 60,
      )
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
  const label =
    `${option?.title || ''} ${option?.description || ''}`.toLowerCase();
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
    Object.entries(record).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
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
  const linePrice = getCartLinePrice(line);

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
          <CartLinePrice price={linePrice} />
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

function CartLinePrice({price}: {price: ReturnType<typeof getCartLinePrice>}) {
  if (!price.saleAmount) return null;

  return (
    <div className="pilot-cart-line-price">
      <strong>{formatRupees(price.saleAmount)}</strong>
      {price.compareAtAmount > price.saleAmount ? (
        <>
          <span>{formatRupees(price.compareAtAmount)}</span>
          <em>{price.discountPercent}% off</em>
        </>
      ) : null}
    </div>
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

function getCartLinePrice(line: any) {
  const quantity = Number(line.quantity || 1);
  const saleAmount = Number(line.cost?.totalAmount?.amount || 0);
  const compareAtPerQuantity = Number(
    line.cost?.compareAtAmountPerQuantity?.amount ||
      line.merchandise?.compareAtPrice?.amount ||
      0,
  );
  const compareAtAmount = compareAtPerQuantity
    ? compareAtPerQuantity * quantity
    : saleAmount;
  const discountPercent =
    compareAtAmount > saleAmount
      ? Math.round(((compareAtAmount - saleAmount) / compareAtAmount) * 100)
      : 0;

  return {
    compareAtAmount,
    discountPercent,
    saleAmount,
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
