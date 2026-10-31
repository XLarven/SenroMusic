import { Link } from 'react-router-dom';
import { Home, Music2, Search } from 'lucide-react';
import { Logo } from '../components/Logo';

export function NotFoundPage() {
  return (
    <div className="page not-found-page">
      <div className="not-found-art" aria-hidden="true">
        <span>4</span>
        <span className="not-found-disc">
          <Music2 size={42} />
        </span>
        <span>4</span>
      </div>
      <span className="eyebrow">Kayıp parça</span>
      <h1>Bu sayfa kütüphanede yok.</h1>
      <p>Aradığın sayfa taşınmış, silinmiş ya da hiç var olmamış olabilir.</p>
      <div className="not-found-actions">
        <Link to="/" className="button primary">
          <Home size={16} />
          Ana sayfa
        </Link>
        <Link to="/search" className="button secondary">
          <Search size={16} />
          Müzik ara
        </Link>
      </div>
      <div className="not-found-logo">
        <Logo />
      </div>
    </div>
  );
}
