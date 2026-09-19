import {useEffect} from 'react';
import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/collections._index';
import {getPaginationVariables, Image} from '@shopify/hydrogen';
import type {CollectionFragment} from 'storefrontapi.generated';
import {PaginatedResourceSection} from '~/components/PaginatedResourceSection';
import {
  khojTrackingEventId,
  trackKhojActivity,
} from '~/components/KhojTracking';

const COLLECTIONS_URL = 'https://shop.khoj.city/collections';

export const meta: Route.MetaFunction = () => [
  {title: 'Handpainted Jewellery Collections | KHOJ.CITY'},
  {
    name: 'description',
    content:
      'Explore KHOJ.CITY handpainted jewellery collections, including necklaces, earrings, festive sets, and wearable Indian art.',
  },
  {tagName: 'link', rel: 'canonical', href: COLLECTIONS_URL},
  {
    property: 'og:title',
    content: 'Handpainted Jewellery Collections | KHOJ.CITY',
  },
  {property: 'og:type', content: 'website'},
  {property: 'og:url', content: COLLECTIONS_URL},
];

export async function loader({context, request}: Route.LoaderArgs) {
  const paginationVariables = getPaginationVariables(request, {pageBy: 12});
  const {collections} = await context.storefront.query(COLLECTIONS_QUERY, {
    cache: context.storefront.CacheShort(),
    variables: paginationVariables,
  });
  return {collections};
}

export default function Collections() {
  const {collections} = useLoaderData<typeof loader>();

  useEffect(() => {
    trackKhojActivity({
      eventType: 'page_viewed',
      eventId: khojTrackingEventId('collections'),
    });
  }, []);

  return (
    <main className="pilot-collection-directory">
      <header className="pilot-collection-directory-header">
        <p className="pilot-kicker">Browse by story</p>
        <h1>Jewellery collections</h1>
        <p>
          Discover handpainted jewellery shaped by Indian art, festive colour,
          and small-batch craft.
        </p>
      </header>
      <PaginatedResourceSection<CollectionFragment>
        ariaLabel="Jewellery collections"
        connection={collections}
        resourcesClassName="pilot-collection-directory-grid"
      >
        {({node: collection, index}) => (
          <CollectionItem
            key={collection.id}
            collection={collection}
            index={index}
          />
        )}
      </PaginatedResourceSection>
    </main>
  );
}

function CollectionItem({
  collection,
  index,
}: {
  collection: CollectionFragment;
  index: number;
}) {
  return (
    <Link
      className="pilot-collection-directory-card"
      to={`/collections/${collection.handle}`}
      prefetch="intent"
    >
      <div className="pilot-collection-directory-media">
        {collection.image ? (
          <Image
            alt={collection.image.altText || collection.title}
            aspectRatio="1/1"
            data={collection.image}
            loading={index < 4 ? 'eager' : 'lazy'}
            sizes="(min-width: 980px) 25vw, (min-width: 640px) 33vw, 50vw"
          />
        ) : (
          <span>{collection.title}</span>
        )}
      </div>
      <div>
        <h2>{collection.title}</h2>
        {collection.description ? <p>{collection.description}</p> : null}
        <span>Shop collection</span>
      </div>
    </Link>
  );
}

const COLLECTIONS_QUERY = `#graphql
  fragment Collection on Collection {
    id
    title
    handle
    description
    image {
      id
      url
      altText
      width
      height
    }
  }
  query StoreCollections(
    $country: CountryCode
    $endCursor: String
    $first: Int
    $language: LanguageCode
    $last: Int
    $startCursor: String
  ) @inContext(country: $country, language: $language) {
    collections(
      first: $first
      last: $last
      before: $startCursor
      after: $endCursor
      sortKey: TITLE
    ) {
      nodes {
        ...Collection
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
` as const;
