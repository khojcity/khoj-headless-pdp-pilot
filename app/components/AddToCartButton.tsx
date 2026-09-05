import {type FetcherWithComponents} from 'react-router';
import {CartForm, type OptimisticCartLineInput} from '@shopify/hydrogen';

export function AddToCartButton({
  analytics,
  children,
  className,
  disabled,
  lines,
  onClick,
  redirectTo,
  replaceExisting,
}: {
  analytics?: unknown;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  lines: Array<OptimisticCartLineInput>;
  onClick?: () => void;
  redirectTo?: string;
  replaceExisting?: boolean;
}) {
  return (
    <CartForm route="/cart" inputs={{lines}} action={CartForm.ACTIONS.LinesAdd}>
      {(fetcher: FetcherWithComponents<any>) => (
        <>
          {replaceExisting ? (
            <input name="_intent" type="hidden" value="replaceVariantWithOne" />
          ) : null}
          <input
            name="analytics"
            type="hidden"
            value={JSON.stringify(analytics)}
          />
          {redirectTo ? (
            <input name="redirectTo" type="hidden" value={redirectTo} />
          ) : null}
          <button
            className={className}
            type="submit"
            onClick={onClick}
            disabled={disabled || fetcher.state !== 'idle'}
          >
            {children}
          </button>
        </>
      )}
    </CartForm>
  );
}
