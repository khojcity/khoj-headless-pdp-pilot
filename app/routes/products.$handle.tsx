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

const DEFAULT_PILOT_HANDLE =
  'mor-pankh-classic-multi-color-hand-painted-necklace-set-hp-np';
const PILOT_HANDLES = new Set([
  DEFAULT_PILOT_HANDLE,
  'mor-pankh-neel-handpainted-choker-set',
  'mumbai-cha-ganesha-handpainted-necklace-032-khoj-city',
]);

function mainStoreProductUrl(handle?: string) {
  return `https://www.khoj.city/products/${handle || DEFAULT_PILOT_HANDLE}`;
}

function pilotProductUrl(handle?: string) {
  if (handle && PILOT_HANDLES.has(handle)) return `/products/${handle}`;
  return mainStoreProductUrl(handle);
}

export const meta: Route.MetaFunction = ({data}) => {
  const product = data?.product;
  const productUrl = mainStoreProductUrl(product?.handle);
  const title =
    product?.seo?.title || product?.title || 'Mor Pankh Necklace Set';
  const description =
    product?.seo?.description ||
    product?.description ||
    'Handmade and hand-painted Mor Pankh necklace set by Khoj.City artisans.';

  return [
    {title},
    {name: 'description', content: description},
    {rel: 'canonical', href: productUrl},
    {property: 'og:title', content: title},
    {property: 'og:description', content: description},
    {property: 'og:type', content: 'product'},
    {property: 'og:url', content: productUrl},
  ];
};

export async function loader(args: Route.LoaderArgs) {
  const {handle} = args.params;

  if (!handle || !PILOT_HANDLES.has(handle)) {
    return redirect(`/products/${DEFAULT_PILOT_HANDLE}`, 302);
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
  const content = getProductPageContent(product.handle);
  const productUrl = mainStoreProductUrl(product.handle);
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
      handle: product.handle,
      url: productUrl,
      title: product.title,
      productType: product.productType,
      variantTitle: selectedVariant?.title || '',
      vendor: product.vendor,
      price: selectedVariant?.price,
      quantity: 1,
    }),
    [
      product.handle,
      product.id,
      productUrl,
      product.title,
      product.productType,
      product.vendor,
      selectedVariant?.id,
      selectedVariant?.price,
      selectedVariant?.title,
    ],
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
          <div className="pilot-title-block">
            <p className="pilot-kicker">Hand-painted jewellery</p>
            <h1>{product.title}</h1>
            <p>{content.intro}</p>
          </div>

          {selectedVariant?.availableForSale ? (
            <p className="pilot-stock">In stock · Ready for checkout</p>
          ) : (
            <p className="pilot-stock is-muted">Currently sold out</p>
          )}

          <div className="pilot-commerce-card">
            <ReviewBadge summary={reviewSummary} />

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

            <div className="pilot-checkout-notes" aria-label="Checkout benefits">
              <span>Cash on delivery available</span>
              <span>Secure Shopify checkout</span>
              <span>Ships across India</span>
            </div>
          </div>

          <div className="pilot-assurance">
            <div>
              <span>Delivery</span>
              <strong>Free delivery</strong>
              <p>Across India, with shipping confirmed at checkout.</p>
            </div>
            <div>
              <span>Payment</span>
              <strong>COD and prepaid</strong>
              <p>Use the payment option that feels comfortable.</p>
            </div>
            <div>
              <span>Craft</span>
              <strong>Handmade finish</strong>
              <p>Painted and assembled in small batches.</p>
            </div>
          </div>

          <InfographicStrip
            images={[
              {
                src: '/infographics/crafted-by-hand.jpg',
                alt: 'Crafted by hand. Each piece is painted and finished in small batches.',
              },
              {
                src: '/infographics/style-ready.jpg',
                alt: 'Style-ready. Pairs beautifully with sarees, kurtis, and festive looks.',
              },
            ]}
          />

          <div className="pilot-highlight-panel">
            <h2>Why it works</h2>
            <ul>
              <li>
                <strong>{content.highlights[0].title}</strong>
                <span>{content.highlights[0].body}</span>
              </li>
              <li>
                <strong>{content.highlights[1].title}</strong>
                <span>{content.highlights[1].body}</span>
              </li>
              <li>
                <strong>{content.highlights[2].title}</strong>
                <span>{content.highlights[2].body}</span>
              </li>
            </ul>
          </div>

          <ProductDetails content={content} />
        </div>
      </section>

      <section className="pilot-story-band" aria-label="Craft promise">
        <div>
          <p className="pilot-kicker">Khoj craft note</p>
          <h2>{content.storyTitle}</h2>
        </div>
        <p>{content.storyBody}</p>
      </section>

      <InfographicStrip
        className="pilot-infographics-wide"
        images={[
          {
            src: '/infographics/free-delivery-cod.jpg',
            alt: 'Free delivery and COD. Shop comfortably with delivery across India.',
          },
        ]}
      />

      <RelatedProducts recommendations={recommendations} />

      <div className="pilot-sticky-atc">
        <div>
          <span>
            {selectedVariant?.price && <Money data={selectedVariant.price} />}
          </span>
          <small>Free delivery</small>
        </div>
        <AddToCartButton
          className="pilot-button pilot-button-primary"
          disabled={!selectedVariant?.availableForSale}
          redirectTo="/cart"
          replaceExisting
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

function InfographicStrip({
  className = '',
  images,
}: {
  className?: string;
  images: Array<{src: string; alt: string}>;
}) {
  return (
    <section
      className={`pilot-infographics ${className}`}
      aria-label="Khoj shopping benefits"
    >
      {images.map((image) => (
        <img
          alt={image.alt}
          decoding="async"
          key={image.src}
          loading="lazy"
          src={image.src}
        />
      ))}
    </section>
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
        <span className="pilot-media-badge">Hand-painted set</span>
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
          replaceExisting
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
          replaceExisting
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

type ProductPageContent = {
  intro: string;
  highlights: Array<{title: string; body: string}>;
  storyTitle: string;
  storyBody: string;
  detailsIntro: string;
  details: Array<{label: string; value: string}>;
};

const DEFAULT_PRODUCT_CONTENT: ProductPageContent = {
  intro:
    'Peacock-inspired necklace set for sarees, kurtis, festive looks, and gifting.',
  highlights: [
    {
      title: 'Statement without bulk',
      body: 'Designed to sit comfortably with festive outfits.',
    },
    {
      title: 'Gift-ready colour',
      body: 'Peacock blue and green tones pair easily with Indian wear.',
    },
    {
      title: 'Hand-painted detail',
      body: 'Each piece carries visible handmade variation.',
    },
  ],
  storyTitle: 'Made for festive dressing, gifting, and everyday colour.',
  storyBody:
    'Each set brings together hand-painted peacock-inspired detail, lightweight construction, and an easy saree-to-kurti styling range.',
  detailsIntro:
    'A handmade necklace and earrings set with hand-painted peacock-inspired artwork, glass bead accents, and a lightweight festive finish.',
  details: [
    {label: 'Craft', value: 'Hand-painted, handmade, and handcrafted'},
    {label: 'Includes', value: 'Necklace and matching earrings'},
    {label: 'Material', value: 'Cardboard, fabric, acrylic paint, and glass beads'},
    {label: 'Colour', value: 'Black and white base with peacock blue-green accents'},
    {label: 'Weight', value: 'Approx. 50 grams'},
    {label: 'Size', value: 'Approx. 20 x 4 inches'},
    {
      label: 'Best worn with',
      value: 'Sarees, kurtis, festive wear, and traditional occasions',
    },
    {label: 'Delivery', value: 'Free delivery across India'},
    {label: 'Payment', value: 'COD and prepaid options through Shopify checkout'},
  ],
};

const PRODUCT_CONTENT_BY_HANDLE: Record<string, ProductPageContent> = {
  [DEFAULT_PILOT_HANDLE]: DEFAULT_PRODUCT_CONTENT,
  'mor-pankh-neel-handpainted-choker-set': {
    intro:
      'A blue Mor Pankh choker set for sarees, kurtis, festive looks, and handmade gifting.',
    highlights: [
      {
        title: 'Choker-style statement',
        body: 'Sits closer to the neckline for a polished festive look.',
      },
      {
        title: 'Peacock blue detail',
        body: 'Neel tones bring the Mor Pankh colour story into a bolder choker shape.',
      },
      {
        title: 'Hand-painted finish',
        body: 'Each piece is painted and assembled in small handmade batches.',
      },
    ],
    storyTitle: 'Made for colour-rich festive styling.',
    storyBody:
      'This choker set carries the Mor Pankh mood in a closer neckline silhouette, pairing handmade detail with easy saree and kurti styling.',
    detailsIntro:
      'A handmade choker set with hand-painted Mor Pankh-inspired detail, glass bead accents, and a lightweight festive finish.',
    details: [
      {label: 'Craft', value: 'Hand-painted, handmade, and handcrafted'},
      {label: 'Includes', value: 'Choker and matching earrings'},
      {label: 'Material', value: 'Fabric, acrylic paint, and glass beads'},
      {label: 'Colour', value: 'Blue and multicolour Mor Pankh accents'},
      {label: 'Weight', value: 'Approx. 50 grams'},
      {label: 'Size', value: 'Approx. 20 x 4 inches'},
      {
        label: 'Best worn with',
        value: 'Sarees, kurtis, festive wear, and traditional occasions',
      },
      {label: 'Delivery', value: 'Free delivery across India'},
      {label: 'Payment', value: 'COD and prepaid options through Shopify checkout'},
    ],
  },
  'mumbai-cha-ganesha-handpainted-necklace-032-khoj-city': {
    intro:
      'A Mumbai cha Ganesha hand-painted necklace for traditional wear, festive styling, and gifting.',
    highlights: [
      {
        title: 'Festive Ganesha motif',
        body: 'Brings a devotional, celebratory accent to traditional outfits.',
      },
      {
        title: 'Lightweight statement',
        body: 'Designed to add colour and craft without feeling heavy.',
      },
      {
        title: 'Hand-painted detail',
        body: 'Each necklace carries small-batch handmade variation.',
      },
    ],
    storyTitle: 'Made for Ganesh festive styling and meaningful gifting.',
    storyBody:
      'This necklace brings together a Mumbai cha Ganesha theme, hand-painted colour, and a lightweight handmade form for festive and traditional occasions.',
    detailsIntro:
      'A handmade necklace with hand-painted Ganesha-inspired artwork, multicolour detailing, and a lightweight festive finish.',
    details: [
      {label: 'Craft', value: 'Hand-painted, handmade, and handcrafted'},
      {label: 'Includes', value: 'Necklace'},
      {label: 'Material', value: 'Cardboard, fabric, acrylic paint, and glass beads'},
      {label: 'Colour', value: 'Multicolour Ganesha-inspired artwork'},
      {label: 'Weight', value: 'Approx. 50 grams'},
      {label: 'Size', value: 'Approx. 20 x 4 inches'},
      {
        label: 'Best worn with',
        value: 'Sarees, kurtis, festive wear, and traditional occasions',
      },
      {label: 'Delivery', value: 'Free delivery across India'},
      {label: 'Payment', value: 'COD and prepaid options through Shopify checkout'},
    ],
  },
};

function getProductPageContent(handle: string) {
  return PRODUCT_CONTENT_BY_HANDLE[handle] || DEFAULT_PRODUCT_CONTENT;
}

function ProductDetails({content}: {content: ProductPageContent}) {
  return (
    <section className="pilot-details" aria-labelledby="details-heading">
      <h2 id="details-heading">Product details</h2>
      <p>{content.detailsIntro}</p>
      <dl>
        {content.details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>{detail.value}</dd>
          </div>
        ))}
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
                    href={pilotProductUrl(product.handle)}
                    key={product.id}
                  >
                    {product.featuredImage && (
                      <div className="pilot-related-media">
                        <Image
                          data={product.featuredImage}
                          alt={product.featuredImage.altText || product.title}
                          sizes="(min-width: 900px) 18vw, 45vw"
                          loading="lazy"
                        />
                      </div>
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
    url: mainStoreProductUrl(product.handle),
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
      url: mainStoreProductUrl(product.handle),
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
    productType
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
