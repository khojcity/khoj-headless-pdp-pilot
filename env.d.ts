/// <reference types="vite/client" />
/// <reference types="react-router" />
/// <reference types="@shopify/oxygen-workers-types" />
/// <reference types="@shopify/hydrogen/react-router-types" />

// Enhance TypeScript's built-in typings.
import '@total-typescript/ts-reset';

declare global {
  interface Env {
    SESSION_SECRET: string;
    PUBLIC_STORE_DOMAIN: string;
    PUBLIC_CHECKOUT_DOMAIN: string;
    PUBLIC_STOREFRONT_API_TOKEN: string;
    PUBLIC_STOREFRONT_ID: string;
    PUBLIC_SHOP_NAME?: string;
    PUBLIC_KHOJ_SITE_ACTIVITY_ENDPOINT?: string;
    PUBLIC_KHOJ_SITE_ACTIVITY_PUBLIC_TOKEN?: string;
    PUBLIC_META_PIXEL_ID?: string;
  }
}
