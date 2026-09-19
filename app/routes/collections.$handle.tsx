import {useEffect, useMemo, useRef, useState} from 'react';
import {
  Link,
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useLocation,
} from 'react-router';
import type {Route} from './+types/collections.$handle';
import {
  Analytics,
  Image,
  Money,
  getPaginationVariables,
} from '@shopify/hydrogen';
import {AddToCartButton} from '~/components/AddToCartButton';
import {
  khojTrackingEventId,
  trackKhojActivity,
  type TrackEvent,
} from '~/components/KhojTracking';
import {redirectIfHandleIsLocalized} from '~/lib/redirect';

const SHOP_ORIGIN = 'https://shop.khoj.city';
const GANAPATI_COLLECTION_HANDLE = 'ganapati-trunk-of-triumph';
const GANAPATI_COLLECTION_TITLE = 'Ganapati: Trunk of Triumph';
const GANAPATI_PRODUCT_DISPLAY_TITLES: Record<string, string> = {
  'mumbai-cha-ganesha-handpainted-necklace-031-khoj-city':
    'Ambikeya Ganesha Necklace',
  'ambikeya-mumbai-cha-ganesha-traditional-white-hand-painted-earrings-hp-er':
    'Ambikeya Ganesha Earrings',
  'ambikeya-mumbai-cha-ganesha-traditional-multi-color-handmade-necklace-set-hp-np':
    'Ambikeya Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-necklace-029-khoj-city':
    'Amod Ganesha Necklace',
  'mumbai-cha-ganesha-handpainted-necklace-set-027-khoj-city':
    'Anav Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-necklace-035-khoj-city':
    'Gajaraj Ganesha Necklace',
  'mumbai-cha-ganesha-handpainted-earrings-050-khoj-city':
    'Ganapati Ganesha Earrings',
  'mumbai-cha-ganesha-handpainted-necklace-049-khoj-city':
    'Ganapati Ganesha Necklace',
  'ganapati-mumbai-cha-ganesha-traditional-multi-color-hand-painted-necklace-set-hp-np':
    'Ganapati Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-necklace-set-025-khoj-city':
    'Ganarajya Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-earrings-033-khoj-city':
    'Ganarajya Ganesha Earrings',
  'mumbai-cha-ganesha-handpainted-necklace-set-026-khoj-city':
    'Gaurisuta Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-earrings-052-khoj-city':
    'Geet Ganesha Earrings',
  'mumbai-cha-ganesha-handpainted-necklace-053-khoj-city':
    'Geet Ganesha Necklace',
  'geet-mumbai-cha-ganesha-traditional-multi-color-hand-painted-necklace-set-hp-np':
    'Geet Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-necklace-030-khoj-city':
    'Lambodar Ganesha Necklace',
  'lambodar-mumbai-cha-ganesha-traditional-multi-color-handmade-necklace-set-hp-np':
    'Lambodar Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-earrings-051-khoj-city':
    'Taandav Ganesha Earrings',
  'mumbai-cha-ganesha-handpainted-necklace-054-khoj-city':
    'Taandav Ganesha Necklace',
  'taandav-mumbai-cha-ganesha-traditional-multi-color-hand-painted-necklace-set-hp-np':
    'Taandav Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-necklace-set-028-khoj-city':
    'Multicolour Ganesha Necklace Set',
  'mumbai-cha-ganesha-handpainted-necklace-032-khoj-city':
    'Vinayaka Red Ganesha Necklace',
};

type MoneyValue = {
  amount: string;
  currencyCode: string;
};

type CollectionProduct = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  featuredImage?: {
    id?: string | null;
    altText?: string | null;
    url: string;
    width?: number | null;
    height?: number | null;
  } | null;
  priceRange: {
    minVariantPrice: MoneyValue;
  };
  selectedOrFirstAvailableVariant?: {
    id: string;
    title: string;
    availableForSale: boolean;
    price: MoneyValue;
    compareAtPrice?: MoneyValue | null;
  } | null;
};

export const meta: Route.MetaFunction = ({data}) => {
  const collection = data?.collection;
  if (!collection) return [{title: 'Collection not found | KHOJ.CITY'}];

  const title =
    collection?.seo?.title ||
    `${collection.title} | Handpainted Jewellery by KHOJ.CITY`;
  const description =
    collection?.seo?.description ||
    collection?.description ||
    `Shop ${collection.title}, handmade and handpainted jewellery by KHOJ.CITY.`;
  const canonicalUrl = `${SHOP_ORIGIN}/collections/${collection.handle}`;

  return [
    {title},
    {name: 'description', content: description},
    {tagName: 'link', rel: 'canonical', href: canonicalUrl},
    {property: 'og:title', content: title},
    {property: 'og:description', content: description},
    {property: 'og:type', content: 'website'},
    {property: 'og:url', content: canonicalUrl},
    ...(collection.image?.url
      ? [{property: 'og:image', content: collection.image.url}]
      : []),
  ];
};

export async function loader(args: Route.LoaderArgs) {
  const {handle} = args.params;

  if (!handle) return redirect('/collections', 302);

  const {collection} = await loadCollection(args);
  return data({collection});
}

async function loadCollection({context, params, request}: Route.LoaderArgs) {
  const {handle} = params;
  const {storefront} = context;

  if (!handle) throw redirect('/collections');

  const paginationVariables = getPaginationVariables(request, {pageBy: 24});
  const {collection} = await storefront.query(COLLECTION_QUERY, {
    cache: storefront.CacheShort(),
    variables: {handle, ...paginationVariables},
  });

  if (!collection) {
    throw new Response(`Collection ${handle} not found`, {status: 404});
  }

  redirectIfHandleIsLocalized(request, {handle, data: collection});
  return {collection};
}

export default function Collection() {
  const {collection} = useLoaderData<typeof loader>();
  const isGanapati = collection.handle === GANAPATI_COLLECTION_HANDLE;
  const displayTitle = isGanapati
    ? GANAPATI_COLLECTION_TITLE
    : collection.title;

  useEffect(() => {
    trackKhojActivity({
      eventType: 'page_viewed',
      eventId: khojTrackingEventId('collection'),
    });
  }, [collection.id]);

  return (
    <main className="pilot-collection">
      <section className="pilot-collection-hero">
        <div>
          <p className="pilot-kicker">Handpainted jewellery</p>
          <h1>{displayTitle}</h1>
        </div>
        <div className="pilot-collection-stats">
          <strong>
            {collection.products.nodes.length}
            {collection.products.pageInfo.hasNextPage ? '+' : ''}
          </strong>
          <span>pieces to explore</span>
        </div>
      </section>

      <CollectionProducts
        collectionId={collection.id}
        connection={collection.products}
        displayTitle={displayTitle}
      />

      {isGanapati ? (
        <>
          <section
            className="pilot-collection-story"
            aria-label="Ganapati collection story"
          >
            <div>
              <p className="pilot-kicker">Handpainted with devotion</p>
              <h2>Ganesh jewellery for auspicious beginnings</h2>
            </div>
            <p>
              Each piece in this Ganapati collection brings Ganesha motifs into
              lightweight handmade jewellery through folk-art inspired painting,
              small-batch finishing, and colours made for Indian festive
              dressing.
            </p>
          </section>

          <section
            className="pilot-collection-faq"
            aria-label="Ganesh jewellery FAQs"
          >
            <h2>Frequently asked questions</h2>
            {GANAPATI_FAQS.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </section>
        </>
      ) : null}

      <Analytics.CollectionView
        data={{
          collection: {
            id: collection.id,
            handle: collection.handle,
          },
        }}
      />
    </main>
  );
}

function CollectionProducts({
  collectionId,
  connection,
  displayTitle,
}: {
  collectionId: string;
  connection: {
    nodes: CollectionProduct[];
    pageInfo: {
      endCursor?: string | null;
      hasNextPage: boolean;
    };
  };
  displayTitle: string;
}) {
  const fetcher = useFetcher<typeof loader>();
  const location = useLocation();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const requestedCursorRef = useRef('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('featured');
  const [products, setProducts] = useState<CollectionProduct[]>(
    connection.nodes,
  );
  const [pageInfo, setPageInfo] = useState(connection.pageInfo);

  useEffect(() => {
    setProducts(connection.nodes);
    setPageInfo(connection.pageInfo);
    setCategory('all');
    setSort('featured');
    requestedCursorRef.current = '';
  }, [collectionId, connection.nodes, connection.pageInfo]);

  useEffect(() => {
    const nextConnection = fetcher.data?.collection?.products;
    if (!nextConnection || fetcher.state !== 'idle') return;

    setProducts((current) => {
      const knownIds = new Set(current.map((product) => product.id));
      return [
        ...current,
        ...(nextConnection.nodes as CollectionProduct[]).filter(
          (product) => !knownIds.has(product.id),
        ),
      ];
    });
    setPageInfo(nextConnection.pageInfo);
  }, [fetcher.data, fetcher.state]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !pageInfo.hasNextPage || !pageInfo.endCursor) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || fetcher.state !== 'idle') return;
        if (requestedCursorRef.current === pageInfo.endCursor) return;
        const params = new URLSearchParams(location.search);
        params.set('direction', 'next');
        params.set('cursor', pageInfo.endCursor || '');
        requestedCursorRef.current = pageInfo.endCursor || '';
        fetcher.load(`${location.pathname}?${params.toString()}`);
      },
      {rootMargin: '500px 0px'},
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetcher, location.pathname, location.search, pageInfo]);

  const categories = useMemo(() => {
    const found = new Set<string>();
    products.forEach((product) => found.add(collectionCategory(product)));
    return ['all', ...Array.from(found)];
  }, [products]);
  const visibleProducts = useMemo(() => {
    const filtered =
      category === 'all'
        ? products
        : products.filter(
            (product) => collectionCategory(product) === category,
          );
    return sortProducts(filtered, sort);
  }, [category, products, sort]);

  return (
    <>
      <section
        className="pilot-collection-toolbar"
        aria-label="Collection controls"
      >
        <div className="pilot-collection-chips" aria-label="Filter by category">
          {categories.map((item) => (
            <button
              className={category === item ? 'is-active' : ''}
              key={item}
              onClick={() => setCategory(item)}
              type="button"
            >
              {categoryLabel(item)}
            </button>
          ))}
        </div>
        <label>
          <span>Sort</span>
          <select
            onChange={(event) => setSort(event.target.value)}
            value={sort}
          >
            <option value="featured">Featured</option>
            <option value="price-low">Price low to high</option>
            <option value="price-high">Price high to low</option>
            <option value="discount">Biggest discount</option>
          </select>
        </label>
      </section>
      <section
        className="pilot-collection-grid"
        aria-label={`${displayTitle} products`}
      >
        {visibleProducts.map((product, index) => (
          <CollectionProductCard
            key={product.id}
            product={product}
            loading={index < 6 ? 'eager' : 'lazy'}
          />
        ))}
      </section>
      <div className="pilot-collection-scroll-status" ref={loadMoreRef}>
        {fetcher.state !== 'idle'
          ? 'Loading more products...'
          : pageInfo.hasNextPage
            ? ''
            : 'You have reached the end'}
      </div>
    </>
  );
}

function CollectionProductCard({
  loading,
  product,
}: {
  loading?: 'eager' | 'lazy';
  product: CollectionProduct;
}) {
  const variant = product.selectedOrFirstAvailableVariant;
  const price = variant?.price || product.priceRange.minVariantPrice;
  const savings = getSavings(variant);
  const trackingProduct = {
    id: product.id,
    variantId: variant?.id || '',
    handle: product.handle,
    url: `${SHOP_ORIGIN}/products/${product.handle}`,
    title: product.title,
    productType: product.productType,
    variantTitle: variant?.title || '',
    vendor: product.vendor,
    price,
    quantity: 1,
  };
  const addToCartTracking = (): TrackEvent => ({
    eventType: 'product_added_to_cart',
    eventId: khojTrackingEventId('addtocart'),
    product: trackingProduct,
    items: [trackingProduct],
    totalPrice: price,
  });

  return (
    <article className="pilot-collection-card">
      <Link
        className="pilot-collection-card-media"
        prefetch="intent"
        to={`/products/${product.handle}`}
      >
        {product.featuredImage ? (
          <Image
            alt={product.featuredImage.altText || product.title}
            aspectRatio="1/1"
            data={product.featuredImage}
            loading={loading}
            sizes="(min-width: 980px) 25vw, (min-width: 640px) 33vw, 50vw"
          />
        ) : null}
        {savings ? (
          <span className="pilot-collection-discount">
            {savings.percent}% off
          </span>
        ) : null}
      </Link>
      <div className="pilot-collection-card-body">
        <Link prefetch="intent" to={`/products/${product.handle}`}>
          <h2>{displayProductTitle(product)}</h2>
        </Link>
        <p>{categoryLabel(collectionCategory(product))} · Free delivery</p>
        <div className="pilot-collection-price">
          <strong>
            <Money data={price as any} />
          </strong>
          {variant?.compareAtPrice ? (
            <span>
              <Money data={variant.compareAtPrice as any} />
            </span>
          ) : null}
        </div>
        <AddToCartButton
          analytics={{products: [trackingProduct]}}
          className="pilot-button pilot-button-secondary"
          disabled={!variant?.availableForSale}
          lines={variant ? [{merchandiseId: variant.id, quantity: 1}] : []}
          onClick={() => trackKhojActivity(addToCartTracking())}
          redirectTo="/cart"
        >
          {variant?.availableForSale ? 'Add to cart' : 'Sold out'}
        </AddToCartButton>
      </div>
    </article>
  );
}

function collectionCategory(product: CollectionProduct) {
  const source = `${product.productType} ${product.title}`.toLowerCase();
  if (source.includes('earring')) return 'earrings';
  if (source.includes('set')) return 'sets';
  if (source.includes('necklace') || source.includes('choker'))
    return 'necklaces';
  return product.productType?.toLowerCase() || 'jewellery';
}

function categoryLabel(category: string) {
  if (category === 'all') return 'All';
  if (category === 'sets') return 'Sets';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function sortProducts(products: CollectionProduct[], sort: string) {
  const sorted = [...products];
  if (sort === 'price-low') {
    sorted.sort(
      (a, b) => moneyAmount(productPrice(a)) - moneyAmount(productPrice(b)),
    );
  } else if (sort === 'price-high') {
    sorted.sort(
      (a, b) => moneyAmount(productPrice(b)) - moneyAmount(productPrice(a)),
    );
  } else if (sort === 'discount') {
    sorted.sort(
      (a, b) =>
        (getSavings(b.selectedOrFirstAvailableVariant)?.amount || 0) -
        (getSavings(a.selectedOrFirstAvailableVariant)?.amount || 0),
    );
  }
  return sorted;
}

function productPrice(product: CollectionProduct) {
  return (
    product.selectedOrFirstAvailableVariant?.price ||
    product.priceRange.minVariantPrice
  );
}

function moneyAmount(money?: MoneyValue | null) {
  const amount = Number(money?.amount);
  return Number.isFinite(amount) ? amount : 0;
}

function getSavings(
  variant?: CollectionProduct['selectedOrFirstAvailableVariant'],
) {
  const price = moneyAmount(variant?.price);
  const compareAt = moneyAmount(variant?.compareAtPrice);
  if (!price || !compareAt || compareAt <= price) return null;
  return {
    amount: compareAt - price,
    percent: Math.round(((compareAt - price) / compareAt) * 100),
  };
}

function displayProductTitle(product: CollectionProduct) {
  return (
    GANAPATI_PRODUCT_DISPLAY_TITLES[product.handle] ||
    shortProductTitle(product.title)
  );
}

function shortProductTitle(title: string) {
  const cleanedTitle = title
    .replace(/^KHOJ\.CITY\s+Jewellery\s+/i, '')
    .replace(/\s+Classic\b/i, '')
    .replace(/\s+Traditional\b/i, '')
    .replace(/\s+Multi Color\b/i, '')
    .replace(/\s+White\b/i, '')
    .replace(/\s+Orange\b/i, '')
    .replace(/\s+Yellow\b/i, '')
    .replace(/\s+Handmade\s*&\s*Hand Painted\b/i, '')
    .replace(/\s+Hand Painted\b/i, '')
    .replace(/\s+for Girls\s*&\s*Women.*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanedTitle || title;
}

const GANAPATI_FAQS = [
  {
    question: 'Is this jewellery suitable for Ganesh Chaturthi?',
    answer:
      'Yes. The pieces are designed for Ganesh Chaturthi, puja days, pandal visits, and devotional festive dressing.',
  },
  {
    question: 'Is Cash on Delivery available?',
    answer:
      'Yes. COD and prepaid checkout are both available, with shipping and payment options confirmed before placing the order.',
  },
  {
    question: 'How should I care for handpainted jewellery?',
    answer:
      'Keep it dry, avoid direct perfume or water on painted surfaces, and store it separately after use.',
  },
];

const COLLECTION_PRODUCT_FRAGMENT = `#graphql
  fragment CollectionProduct on Product {
    id
    handle
    title
    vendor
    productType
    featuredImage {
      id
      altText
      url
      width
      height
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    selectedOrFirstAvailableVariant {
      id
      title
      availableForSale
      price {
        amount
        currencyCode
      }
      compareAtPrice {
        amount
        currencyCode
      }
    }
  }
` as const;

const COLLECTION_QUERY = `#graphql
  ${COLLECTION_PRODUCT_FRAGMENT}
  query Collection(
    $handle: String!
    $country: CountryCode
    $language: LanguageCode
    $first: Int
    $last: Int
    $startCursor: String
    $endCursor: String
  ) @inContext(country: $country, language: $language) {
    collection(handle: $handle) {
      id
      handle
      title
      description
      image {
        url
        altText
        width
        height
      }
      seo {
        title
        description
      }
      products(first: $first, last: $last, before: $startCursor, after: $endCursor) {
        nodes {
          ...CollectionProduct
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  }
` as const;
