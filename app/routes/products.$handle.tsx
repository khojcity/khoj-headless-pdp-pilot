import {Suspense, useMemo, useState} from 'react';
import {Await, data, redirect, useLoaderData} from 'react-router';
import type {Route} from './+types/products.$handle';
import {
  Analytics,
  Image,
  Money,
  getAdjacentAndFirstAvailableVariants,
  getProductOptions,
  getSelectedProductOptions,
  useOptimisticVariant,
  useSelectedOptionInUrlParam,
} from '@shopify/hydrogen';
import {AddToCartButton} from '~/components/AddToCartButton';
import {
  KhojPageTracking,
  trackKhojActivity,
  type TrackEvent,
} from '~/components/KhojTracking';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';

const PILOT_HANDLE =
  'mor-pankh-classic-multi-color-hand-painted-necklace-set-hp-np';
const LIVE_PRODUCT_URL = `https://www.khoj.city/products/${PILOT_HANDLE}`;

export const meta: Route.MetaFunction = ({data}) => {
  const product = data?.product;
  const title =
    product?.seo?.title || product?.title || 'Mor Pankh Necklace Set';
  const description =
    product?.seo?.description ||
    product?.description ||
    'Handmade and hand-painted Mor Pankh necklace set by Khoj.City artisans.';

  return [
    {title},
    {name: 'description', content: description},
    {rel: 'canonical', href: LIVE_PRODUCT_URL},
    {property: 'og:title', content: title},
    {property: 'og:description', content: description},
    {property: 'og:type', content: 'product'},
    {property: 'og:url', content: LIVE_PRODUCT_URL},
  ];
};

export async function loader(args: Route.LoaderArgs) {
  const {handle} = args.params;

  if (handle !== PILOT_HANDLE) {
    return redirect(`/products/${PILOT_HANDLE}`, 302);
  }

  const criticalData = await loadCriticalData(args);
  const deferredData = loadDeferredData(args, criticalData.product.id);

  return data({...criticalData, ...deferredData});
}

async function loadCriticalData({context, params, request}: Route.LoaderArgs) {
  const {handle} = params;
  const {storefront} = context;

  if (!handle) throw new Error('Expected product handle to be defined');

  const {product} = await storefront.query(PRODUCT_QUERY, {
    cache: storefront.CacheShort(),
    variables: {
      handle,
      selectedOptions: getSelectedProductOptions(request),
    },
  });

  if (!product?.id) throw new Response(null, {status: 404});

  redirectIfHandleIsLocalized(request, {handle, data: product});

  return {product};
}

function loadDeferredData({context}: Route.LoaderArgs, productId: string) {
  const {storefront} = context;

  const recommendations = storefront
    .query(RECOMMENDATIONS_QUERY, {
      cache: storefront.CacheShort(),
      variables: {productId},
    })
    .catch((error: Error) => {
      console.error('Recommendation query failed', error);
      return null;
    });

  return {recommendations};
}

export default function Product() {
  const {product, recommendations} = useLoaderData<typeof loader>();
  const selectedVariant = useOptimisticVariant(
    product.selectedOrFirstAvailableVariant,
    getAdjacentAndFirstAvailableVariants(product),
  );

  useSelectedOptionInUrlParam(selectedVariant?.selectedOptions || []);

  const productOptions = getProductOptions({
    ...product,
    selectedOrFirstAvailableVariant: selectedVariant,
  });

  const reviewSummary = getReviewSummary(product);
  const trackingProduct = useMemo(
    () => ({
      id: product.id,
      variantId: selectedVariant?.id || '',
      title: product.title,
      price: selectedVariant?.price,
      quantity: 1,
    }),
    [product.id, product.title, selectedVariant?.id, selectedVariant?.price],
  );

  const addToCartTracking = () => ({
    eventType: 'product_added_to_cart',
    eventId: `hydrogen_atc:${selectedVariant?.id || product.id}:${Date.now()}`,
    product: trackingProduct,
    items: [trackingProduct],
    totalPrice: selectedVariant?.price,
  });

  const checkoutTracking = () => ({
    eventType: 'checkout_started',
    eventId: `hydrogen_checkout:${selectedVariant?.id || product.id}:${Date.now()}`,
    product: trackingProduct,
    items: [trackingProduct],
    totalPrice: selectedVariant?.price,
  });
  const savings = getSavings(selectedVariant);

  return (
    <article className="pilot-pdp">
      <KhojPageTracking product={trackingProduct} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            productJsonLd(product, selectedVariant, reviewSummary),
          ),
        }}
      />

      <section className="pilot-product-grid">
        <ProductMedia media={product.media.nodes} title={product.title} />

        <div className="pilot-product-panel">
          <p className="pilot-kicker">Handmade with love</p>
          <h1>{product.title}</h1>
          <ReviewBadge summary={reviewSummary} />

          {selectedVariant?.availableForSale ? (
            <p className="pilot-stock">In stock · Ready for checkout</p>
          ) : (
            <p className="pilot-stock is-muted">Currently sold out</p>
          )}

          <div className="pilot-price-row">
            {selectedVariant?.price && <Money data={selectedVariant.price} />}
            {selectedVariant?.compareAtPrice && (
              <span className="pilot-compare">
                <Money data={selectedVariant.compareAtPrice} />
              </span>
            )}
            {savings ? (
              <span className="pilot-discount">{savings.percent}% off</span>
            ) : null}
          </div>
          <p className="pilot-tax-note">
            Inclusive of all taxes · Free delivery across India
          </p>

          <PilotProductForm
            productOptions={productOptions}
            selectedVariant={selectedVariant}
            addToCartTracking={addToCartTracking}
            checkoutTracking={checkoutTracking}
          />

          <div className="pilot-trust-strip">
            <span>
              <strong>Free delivery</strong>
              Across India
            </span>
            <span>
              <strong>COD available</strong>
              Pay at delivery on eligible pin codes
            </span>
            <span>
              <strong>Secure checkout</strong>
              Shopify-powered order flow
            </span>
          </div>

          <div className="pilot-highlights">
            <span>Hand-painted</span>
            <span>Statement gifting</span>
            <span>Festive ready</span>
            <span>Lightweight styling</span>
          </div>

          <div className="pilot-copy">
            <p>
              Mor Pankh Classic is a handmade, hand-painted necklace set crafted
              for festive outfits, sarees, kurtis, gifting, and everyday
              statement wear.
            </p>
          </div>

          <ProductDetails descriptionHtml={product.descriptionHtml} />
        </div>
      </section>

      <section className="pilot-story-band" aria-label="Craft promise">
        <div>
          <p className="pilot-kicker">Khoj craft note</p>
          <h2>Made for festive dressing, gifting, and everyday colour.</h2>
        </div>
        <p>
          Each set brings together hand-painted peacock-inspired detail,
          lightweight construction, and an easy saree-to-kurti styling range.
        </p>
      </section>

      <RelatedProducts recommendations={recommendations} />

      <div className="pilot-sticky-atc">
        <span>
          {selectedVariant?.price && <Money data={selectedVariant.price} />}
        </span>
        <AddToCartButton
          className="pilot-button pilot-button-primary"
          disabled={!selectedVariant?.availableForSale}
          redirectTo="/cart"
          lines={
            selectedVariant
              ? [{merchandiseId: selectedVariant.id, quantity: 1}]
              : []
          }
          onClick={() => trackKhojActivity(addToCartTracking())}
        >
          {selectedVariant?.availableForSale ? 'Add to cart' : 'Sold out'}
        </AddToCartButton>
      </div>

      <Analytics.ProductView
        data={{
          products: [
            {
              id: product.id,
              title: product.title,
              price: selectedVariant?.price.amount || '0',
              vendor: product.vendor,
              variantId: selectedVariant?.id || '',
              variantTitle: selectedVariant?.title || '',
              quantity: 1,
            },
          ],
        }}
      />
    </article>
  );
}

function ProductMedia({media, title}: {media: any[]; title: string}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = media[activeIndex] || media[0];

  return (
    <div className="pilot-media">
      <div className="pilot-media-main">
        {active?.mediaContentType === 'VIDEO' && active.sources?.[0] ? (
          <video
            controls
            playsInline
            preload="metadata"
            poster={active.previewImage?.url}
          >
            {active.sources.map((source: any) => (
              <source key={source.url} src={source.url} type={source.mimeType} />
            ))}
          </video>
        ) : active?.image ? (
          <Image
            data={active.image}
            alt={active.image.altText || title}
            sizes="(min-width: 900px) 52vw, 100vw"
            loading="eager"
            aspectRatio="1/1"
          />
        ) : null}
      </div>

      {media.length > 1 && (
        <div className="pilot-thumbs" aria-label="Product media">
          {media.map((item, index) => (
            <button
              className={index === activeIndex ? 'is-active' : ''}
              key={item.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`View media ${index + 1}`}
            >
              {item.previewImage ? (
                <Image
                  data={item.previewImage}
                  alt={item.alt || title}
                  sizes="72px"
                  loading="lazy"
                />
              ) : (
                <span>Video</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PilotProductForm({
  productOptions,
  selectedVariant,
  addToCartTracking,
  checkoutTracking,
}: {
  productOptions: any[];
  selectedVariant: any;
  addToCartTracking: () => TrackEvent;
  checkoutTracking: () => TrackEvent;
}) {
  return (
    <div className="pilot-form">
      {productOptions.map((option) => {
        if (option.optionValues.length === 1) return null;

        return (
          <div className="pilot-options" key={option.name}>
            <p>{option.name}</p>
            <div>
              {option.optionValues.map((value: any) => (
                <a
                  className={value.selected ? 'selected' : ''}
                  href={`?${value.variantUriQuery}`}
                  key={`${option.name}-${value.name}`}
                  aria-disabled={!value.available}
                >
                  {value.name}
                </a>
              ))}
            </div>
          </div>
        );
      })}

      <div className="pilot-actions">
        <AddToCartButton
          className="pilot-button pilot-button-secondary"
          disabled={!selectedVariant?.availableForSale}
          redirectTo="/cart"
          lines={
            selectedVariant
              ? [{merchandiseId: selectedVariant.id, quantity: 1}]
              : []
          }
          onClick={() => trackKhojActivity(addToCartTracking())}
        >
          {selectedVariant?.availableForSale ? 'Add to cart' : 'Sold out'}
        </AddToCartButton>

        <AddToCartButton
          className="pilot-button pilot-button-primary"
          disabled={!selectedVariant?.availableForSale}
          lines={
            selectedVariant
              ? [{merchandiseId: selectedVariant.id, quantity: 1}]
              : []
          }
          redirectTo="checkout"
          onClick={() => trackKhojActivity(checkoutTracking())}
        >
          Buy now
        </AddToCartButton>
      </div>
    </div>
  );
}

function ReviewBadge({summary}: {summary: ReviewSummary | null}) {
  if (!summary) return null;

  return (
    <div
      className="pilot-reviews"
      aria-label={`${summary.rating} out of 5 from ${summary.ratingCount} ratings`}
    >
      <span className="pilot-star">★</span>
      <strong>{summary.rating}</strong>
      <span>/5</span>
      <span>({summary.ratingCount})</span>
      <span className="pilot-review-source">Verified reviews</span>
    </div>
  );
}

function ProductDetails({descriptionHtml}: {descriptionHtml: string}) {
  return (
    <section className="pilot-details" aria-labelledby="details-heading">
      <h2 id="details-heading">Product details</h2>
      <div dangerouslySetInnerHTML={{__html: descriptionHtml}} />
      <dl>
        <div>
          <dt>Craft</dt>
          <dd>Hand-painted and handmade</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>Free delivery across India</dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>COD and prepaid options through Shopify checkout</dd>
        </div>
      </dl>
    </section>
  );
}

function RelatedProducts({recommendations}: {recommendations: Promise<any>}) {
  return (
    <section className="pilot-related" aria-labelledby="related-heading">
      <h2 id="related-heading">You may also like</h2>
      <Suspense fallback={null}>
        <Await resolve={recommendations}>
          {(result) => {
            const products = result?.productRecommendations || [];
            return (
              <div className="pilot-related-grid">
                {products.slice(0, 4).map((product: any) => (
                  <a
                    href={`https://www.khoj.city/products/${product.handle}`}
                    key={product.id}
                  >
                    {product.featuredImage && (
                      <Image
                        data={product.featuredImage}
                        alt={product.featuredImage.altText || product.title}
                        sizes="(min-width: 900px) 20vw, 45vw"
                        loading="lazy"
                      />
                    )}
                    <span>{product.title}</span>
                    <small>
                      <Money data={product.priceRange.minVariantPrice} />
                    </small>
                  </a>
                ))}
              </div>
            );
          }}
        </Await>
      </Suspense>
    </section>
  );
}

type ReviewSummary = {
  rating: string;
  ratingCount: string;
  reviewCount?: string;
};

function getReviewSummary(product: any): ReviewSummary | null {
  const ratingRaw = product.rating?.value;
  const ratingCount = product.ratingCount?.value;
  if (!ratingRaw || !ratingCount) return null;

  let rating = ratingRaw;
  try {
    const parsedRating = JSON.parse(ratingRaw) as {value?: string};
    rating = parsedRating.value || ratingRaw;
  } catch {}

  return {
    rating,
    ratingCount,
    reviewCount: product.razorpayReviewCount?.value,
  };
}

function getSavings(selectedVariant: any) {
  const price = Number(selectedVariant?.price?.amount);
  const compareAtPrice = Number(selectedVariant?.compareAtPrice?.amount);
  if (!price || !compareAtPrice || compareAtPrice <= price) return null;

  return {
    amount: compareAtPrice - price,
    percent: Math.round(((compareAtPrice - price) / compareAtPrice) * 100),
  };
}

function productJsonLd(
  product: any,
  selectedVariant: any,
  reviews: ReviewSummary | null,
) {
  const image = product.media.nodes.find((node: any) => node.image)?.image;
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description,
    image: image?.url,
    url: LIVE_PRODUCT_URL,
    brand: {
      '@type': 'Brand',
      name: 'KHOJ.CITY',
    },
    offers: {
      '@type': 'Offer',
      priceCurrency: selectedVariant?.price?.currencyCode || 'INR',
      price: selectedVariant?.price?.amount,
      availability: selectedVariant?.availableForSale
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url: LIVE_PRODUCT_URL,
    },
  };

  if (reviews) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: reviews.rating,
      ratingCount: reviews.ratingCount,
      reviewCount: reviews.reviewCount || reviews.ratingCount,
    };
  }

  return jsonLd;
}

const PRODUCT_VARIANT_FRAGMENT = `#graphql
  fragment ProductVariant on ProductVariant {
    availableForSale
    compareAtPrice {
      amount
      currencyCode
    }
    id
    product {
      handle
    }
    image {
      __typename
      id
      url
      altText
      width
      height
    }
    price {
      amount
      currencyCode
    }
    selectedOptions {
      name
      value
    }
    sku
    title
  }
` as const;

const PRODUCT_FRAGMENT = `#graphql
  fragment Product on Product {
    id
    title
    vendor
    handle
    descriptionHtml
    description
    encodedVariantExistence
    encodedVariantAvailability
    seo {
      description
      title
    }
    rating: metafield(namespace: "reviews", key: "rating") {
      value
      type
    }
    ratingCount: metafield(namespace: "reviews", key: "rating_count") {
      value
      type
    }
    razorpayReviewCount: metafield(namespace: "razorpay_reviews", key: "review_count") {
      value
      type
    }
    media(first: 8) {
      nodes {
        __typename
        id
        mediaContentType
        alt
        previewImage {
          id
          url
          altText
          width
          height
        }
        ... on MediaImage {
          image {
            id
            url
            altText
            width
            height
          }
        }
        ... on Video {
          sources {
            url
            mimeType
          }
        }
      }
    }
    options {
      name
      optionValues {
        name
        firstSelectableVariant {
          ...ProductVariant
        }
        swatch {
          color
          image {
            previewImage {
              url
            }
          }
        }
      }
    }
    selectedOrFirstAvailableVariant(selectedOptions: $selectedOptions, ignoreUnknownOptions: true, caseInsensitiveMatch: true) {
      ...ProductVariant
    }
    adjacentVariants(selectedOptions: $selectedOptions) {
      ...ProductVariant
    }
  }
  ${PRODUCT_VARIANT_FRAGMENT}
` as const;

const PRODUCT_QUERY = `#graphql
  query Product(
    $country: CountryCode
    $handle: String!
    $language: LanguageCode
    $selectedOptions: [SelectedOptionInput!]!
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      ...Product
    }
  }
  ${PRODUCT_FRAGMENT}
` as const;

const RECOMMENDATIONS_QUERY = `#graphql
  query ProductRecommendations(
    $country: CountryCode
    $language: LanguageCode
    $productId: ID!
  ) @inContext(country: $country, language: $language) {
    productRecommendations(productId: $productId) {
      id
      title
      handle
      featuredImage {
        id
        url
        altText
        width
        height
      }
      priceRange {
        minVariantPrice {
          amount
          currencyCode
        }
      }
    }
  }
` as const;
