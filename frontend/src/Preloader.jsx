export default function Preloader() {
  return <main className="library-preloader" role="status" aria-live="polite" aria-label="Opening CampusShelf">
    <div className="loader-halo" aria-hidden="true"><div className="loader-book"><span className="loader-cover" /><span className="loader-page page-one" /><span className="loader-page page-two" /><span className="loader-page page-three" /><span className="loader-spine" /></div><span className="loader-spark">✦</span></div>
    <img className="loader-logo" src="/assets/campusshelf-logo.svg" alt="" />
    <h1>CampusShelf</h1><p>A new chapter awaits.</p>
    <div className="loader-track" aria-hidden="true"><span /></div><span className="loader-caption">Opening your library…</span>
  </main>;
}
