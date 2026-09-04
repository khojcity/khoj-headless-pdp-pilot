import {
  index,
  route,
  type RouteConfig,
} from '@react-router/dev/routes';
import {hydrogenRoutes} from '@shopify/hydrogen';

export default hydrogenRoutes([
  index('routes/_index.tsx'),
  route('products/:handle', 'routes/products.$handle.tsx'),
  route('cart', 'routes/cart.tsx'),
  route('robots.txt', 'routes/[robots.txt].tsx'),
  route('sitemap.xml', 'routes/[sitemap.xml].tsx'),
  route('*', 'routes/$.tsx'),
]) satisfies RouteConfig;
