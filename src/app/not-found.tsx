import Link from 'next/link';

export const metadata = {
  title: 'Page not found',
  description: 'This page does not exist or has moved.',
};

// 404 в стиле внутренних страниц (legal-page: eyebrow, заголовок, lede, действия).
export default function NotFound() {
  return (
    <div className="site-container legal-page">
      <span className="eyebrow">404</span>
      <h1>
        Page not<span>
          <br />
          found.
        </span>
      </h1>
      <p className="legal-lede">
        The page you are looking for does not exist or has moved. Everything
        else is where it should be.
      </p>
      <div className="hero-actions">
        <Link href="/challenges" className="button-primary">
          View challenges
        </Link>
        <Link href="/" className="button-secondary">
          Back to overview
        </Link>
      </div>
    </div>
  );
}
