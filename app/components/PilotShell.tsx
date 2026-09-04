import {Link} from 'react-router';

export function PilotShell({
  children,
  shopName,
}: {
  children: React.ReactNode;
  shopName: string;
}) {
  return (
    <div className="pilot-shell">
      <header className="pilot-header">
        <Link className="pilot-logo" to="/">
          {shopName}
        </Link>
        <a className="pilot-back-link" href="https://www.khoj.city">
          Main store
        </a>
      </header>
      <div className="pilot-promise-bar">
        <span>Handmade jewellery</span>
        <span>Free delivery</span>
        <span>COD available</span>
      </div>
      {children}
    </div>
  );
}
