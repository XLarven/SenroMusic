import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Loader2, Search, UsersRound } from 'lucide-react';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { t } from '../../lib/i18n';
import type { UserSearchResult } from '../../types';

/**
 * Real people search: reuses /api/users/search (public profiles only) and links
 * straight to the profile page. No placeholder accounts, no invented numbers.
 */
export function PeopleSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void api
        .searchUsers(needle)
        .then((payload) => {
          if (!cancelled) setResults(payload.users ?? []);
        })
        .catch((cause) => {
          if (!cancelled) {
            setResults([]);
            setError(cause instanceof Error ? cause.message : t('Arama başarısız.', 'Search failed.'));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="people-search">
      <div className="search-box people-search-field">
        {loading ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setTouched(true);
          }}
          placeholder={t('Kullanıcı adı veya görünen ad ara…', 'Search a username or display name…')}
          aria-label={t('Kullanıcı ara', 'Search people')}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {!loading && query.trim().length >= 2 && results.length === 0 && !error ? (
        <p className="community-empty">
          {t('Eşleşen kullanıcı yok.', 'No matching people.')}
        </p>
      ) : null}

      {!touched || query.trim().length < 2 ? (
        <p className="community-empty">
          <UsersRound size={16} /> {t(
            'NorieMusic kullanıcılarını arayarak profillerine gidebilirsin.',
            'Search NorieMusic users to open their profiles.',
          )}
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="surface-panel people-list">
          {results.map((person) => (
            <Link
              key={person.id}
              className="person-row"
              to={person.username ? `/u/${person.username}` : `/profile/${person.id}`}
            >
              <Cover
                src={person.avatarUrl}
                alt=""
                seed={person.id}
                className="person-avatar"
                iconSize={16}
                eager
              />
              <span className="person-copy">
                <strong>{person.displayName}</strong>
                <small>{person.username ? `@${person.username}` : t('Profil', 'Profile')}</small>
              </span>
              {person.bio ? <span className="person-bio">{person.bio}</span> : null}
              <ArrowUpRight size={16} className="person-arrow" />
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
