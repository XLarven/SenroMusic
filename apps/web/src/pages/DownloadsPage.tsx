import { DownloadsPanel } from '../features/downloads/DownloadsPanel';
import { t } from '../lib/i18n';

/**
 * Legacy /downloads route. The panel itself lives in the Library now; this keeps
 * old links, bookmarks and the mobile shortcut working.
 */
export function DownloadsPage() {
  return (
    <section className="page downloads-page" aria-labelledby="downloads-title">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('Yerel indirmeler', 'Local downloads')}</span>
          <h1 id="downloads-title">{t('Bu cihazdaki müzik', 'Music on this device')}</h1>
          <p>
            {t(
              'İndirilen ses yalnızca bu cihazda saklanır; sunucuda dosya tutulmaz.',
              'Downloaded audio stays on this device; nothing is stored on the server.',
            )}
          </p>
        </div>
      </header>
      <DownloadsPanel />
    </section>
  );
}
