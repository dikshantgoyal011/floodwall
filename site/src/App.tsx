import { useEffect, useRef, useState } from "react";

const VIDEO_URL = "/hero-sf.mp4";
const FOOTER_POSTER_URL = "/footer-sf-poster.jpg";

const repoUrl = "https://github.com/erphq/floodwall";

function useHeroVideoEligibility() {
  const [canUseVideo, setCanUseVideo] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tablet = window.matchMedia("(min-width: 760px)");
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean };
      }
    ).connection;

    const update = () => {
      setCanUseVideo(!reducedMotion.matches && tablet.matches && !connection?.saveData);
    };

    update();
    reducedMotion.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      reducedMotion.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);

  return canUseVideo;
}

function LoopingHeroVideo() {
  const canUseVideo = useHeroVideoEligibility();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!canUseVideo) return;

    const video = videoRef.current;
    if (!video) return;

    let frame = 0;
    let restartTimer: number | undefined;

    const setOpacity = (opacity: number) => {
      video.style.opacity = opacity.toFixed(3);
    };

    const monitor = () => {
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) {
        const current = video.currentTime;
        const remaining = duration - current;
        const fadeIn = Math.min(1, current / 0.5);
        const fadeOut = Math.max(0, Math.min(1, remaining / 0.5));
        setOpacity(Math.min(fadeIn, fadeOut));
      }
      frame = requestAnimationFrame(monitor);
    };

    const restart = () => {
      setOpacity(0);
      restartTimer = window.setTimeout(() => {
        video.currentTime = 0;
        void video.play();
      }, 100);
    };

    video.addEventListener("ended", restart);
    setOpacity(0);
    void video.play();
    frame = requestAnimationFrame(monitor);

    return () => {
      cancelAnimationFrame(frame);
      if (restartTimer) window.clearTimeout(restartTimer);
      video.removeEventListener("ended", restart);
    };
  }, [canUseVideo]);

  if (!canUseVideo) return null;

  return (
    <video
      ref={videoRef}
      className="hero-video"
      src={VIDEO_URL}
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
    />
  );
}

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`brand-mark ${className}`} aria-hidden="true" viewBox="0 0 64 64">
      <rect x="7" y="7" width="50" height="50" rx="13" />
      <path d="M32 11v42" />
      <path d="M14 32h17M33 32h17" />
      <path d="M19 48c6-12 6-20 0-32M45 16c-6 12-6 20 0 32" />
    </svg>
  );
}

function HeroFallbackScene() {
  return (
    <div className="hero-fallback" aria-hidden="true">
      <div className="fog-lane fog-lane-one" />
      <div className="fog-lane fog-lane-two" />
      <div className="bay-lights" />
      <svg className="bridge-lines" viewBox="0 0 1200 640" preserveAspectRatio="none">
        <path d="M-40 426C220 340 430 322 646 352s384 8 594-104" />
        <path d="M-40 472C230 382 438 366 650 392s386 10 590-92" />
        <path d="M352 328v224M814 282v268" />
        <path d="M352 328C466 404 682 412 814 282" />
        <path d="M352 328C394 420 458 478 548 526" />
        <path d="M814 282C760 404 680 478 548 526" />
      </svg>
      <svg className="skyline-lines" viewBox="0 0 1200 280" preserveAspectRatio="none">
        <path d="M0 232h146v-42h70v-80h54v122h88v-64h58v64h92v-102h52v102h76v-170h42v170h86v-84h64v84h90v-58h76v58h126" />
        <path className="pyramid" d="M722 232 759 72l38 160" />
        <path className="sutro" d="M956 232l34-130 34 130M990 104v128M948 145h84M936 185h108" />
      </svg>
      <div className="wall-diagram">
        <span>admission</span>
        <span>gate</span>
        <span>ledger</span>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero-section" id="home" aria-labelledby="hero-title">
      <HeroFallbackScene />
      <LoopingHeroVideo />
      <div className="hero-video-gradient" aria-hidden="true" />
      <nav className="nav-bar" aria-label="Primary">
        <a className="logo" href="#home" aria-label="Floodwall home">
          <BrandMark />
          <span>
            Floodwall<sup>&reg;</sup>
          </span>
        </a>
        <div className="nav-links">
          <a className="active" href="#home">
            Home
          </a>
          <a href="#model">Model</a>
          <a href="#gate">Gate</a>
          <a href="#ledger">Ledger</a>
          <a href="#roadmap">Roadmap</a>
        </div>
        <a className="nav-cta" href={repoUrl}>
          View the Crate
        </a>
      </nav>
      <div className="hero-content">
        <p className="hero-kicker">San Francisco / agent ops / production gate</p>
        <h1 id="hero-title">
          <span>
            When <em>agents flood</em>
          </span>
          {" "}
          <span>
            production, <em>hold the line.</em>
          </span>
        </h1>
        <p>
          Floodwall meters agent-generated infrastructure changes, verifies each intent at a policy
          gate, and records every admit, defer, and reject in a tamper-evident ledger.
        </p>
        <div className="hero-actions">
          <a className="hero-button" href={repoUrl}>
            View the Crate
          </a>
          <a className="hero-link" href="#model">
            Read the model
          </a>
        </div>
      </div>
      <div className="hero-status" aria-label="Current crate state">
        <span>
          <b>{__CRATE_STATS__.version}</b>
          shipped
        </span>
        <span>
          <b>{__CRATE_STATS__.dependencies}</b>
          dependencies
        </span>
        <span>
          <b>{__CRATE_STATS__.tests}</b>
          tests
        </span>
      </div>
    </section>
  );
}

function ModelSection() {
  return (
    <section className="section model-section" id="model" aria-labelledby="model-title">
      <div className="section-copy">
        <p className="section-kicker">The model</p>
        <h2 id="model-title">Agents submit intents. Production gets decisions.</h2>
      </div>
      <div className="model-rail">
        {[
          ["Admission", "Per-agent token buckets and a bounded priority queue keep one loop from taking the whole lane."],
          ["Scheduler", "Wide changes run alone, narrow ones run in parallel per resource, and a waiting change is never overtaken by lower-priority work."],
          ["Gate", "A deny-overrides policy stack and a conflict check rule on every intent. Deferred changes wait on hold for a human."],
          ["Ledger", "Every verdict is appended to a hash chain so retroactive edits break verification."],
        ].map(([title, copy]) => (
          <article key={title}>
            <span>{title}</span>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GateLedgerSection() {
  return (
    <section className="section split-section">
      <article className="feature-block" id="gate">
        <p className="section-kicker">Policy gate</p>
        <h2>One hard reject blocks the change.</h2>
        <p>
          Reference policies cover global destructive actions, blast-radius urgency, and resource
          allowlists. The policy trait stays small so teams can add rules that match their own
          release discipline. A deferred change is held, not dropped, until a human releases or
          expires it.
        </p>
      </article>
      <article className="ledger-panel" id="ledger">
        <div className="ledger-head">
          <span>tamper-evident ledger</span>
          <b>valid chain</b>
        </div>
        {[
          ["admit", "reconciler-7", "scale web"],
          ["defer", "deployer", "billing off allowlist"],
          ["reject", "chaos-loop", "global destroy"],
          ["admit", "autoscaler", "cache replicas"],
        ].map(([verdict, agent, intent]) => (
          <div className="ledger-row" key={`${verdict}-${agent}-${intent}`}>
            <span className={`verdict ${verdict}`}>{verdict}</span>
            <span>{agent}</span>
            <span>{intent}</span>
          </div>
        ))}
      </article>
    </section>
  );
}

function Roadmap() {
  return (
    <section className="section roadmap-section" id="roadmap" aria-labelledby="roadmap-title">
      <div className="section-copy">
        <p className="section-kicker">Roadmap</p>
        <h2 id="roadmap-title">From a wall to a replayable control plane.</h2>
      </div>
      <div className="roadmap-grid">
        {[
          ["0.1", "The wall", "Intent model, admission control, policy gate, ledger, and demo."],
          ["0.2", "Scheduler", "Wide changes serialize, narrow work runs in parallel per resource, and contradictions wait for a human."],
          ["0.3", "Trustworthy ledger", "SHA-256 chain, signed records, and Merkle checkpoints."],
          ["0.4", "Replay", "Durable append-only state that rebuilds the plane after restart."],
        ].map(([version, title, copy]) => (
          <article key={version}>
            <span>{version}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FooterScene() {
  const canUseVideo = useHeroVideoEligibility();

  return (
    <footer className="sf-footer">
      {canUseVideo ? (
        <video
          className="footer-video"
          src={VIDEO_URL}
          poster={FOOTER_POSTER_URL}
          muted
          playsInline
          loop
          autoPlay
          preload="metadata"
          aria-hidden="true"
        />
      ) : null}
      <div className="footer-fog" aria-hidden="true" />
      <div className="footer-lights" aria-hidden="true" />
      <svg className="footer-bridge" viewBox="0 0 1400 620" preserveAspectRatio="none" aria-hidden="true">
        <path className="deck" d="M-60 414C222 330 468 322 704 368s442 10 756-116" />
        <path className="deck deck-low" d="M-60 474C230 388 476 376 708 414s444 18 752-98" />
        <path className="tower" d="M348 286v250M1000 220v316" />
        <path className="tower" d="M320 344h56M970 286h60M320 424h56M970 390h60" />
        <path className="cable" d="M348 286C500 414 786 430 1000 220" />
        <path className="cable" d="M348 286C412 426 522 514 682 552" />
        <path className="cable" d="M1000 220C910 404 794 506 682 552" />
      </svg>
      <svg className="footer-skyline" viewBox="0 0 1400 320" preserveAspectRatio="none" aria-hidden="true">
        <path className="skyline-base" d="M0 270h120v-48h72v-60h54v108h94v-78h62v78h130v-126h46v126h92v-72h70v72h98v-108h46v108h104v-54h92v54h130" />
        <path className="transamerica" d="M770 270l42-182 42 182M812 96v174" />
        <path className="sutro" d="M1086 270l36-132 36 132M1122 142v128M1080 184h84M1068 224h108" />
      </svg>
      <div className="footer-content">
        <div className="footer-main">
          <a className="footer-logo" href="#home" aria-label="Floodwall home">
            <BrandMark />
            <span>Floodwall</span>
          </a>
          <p className="section-kicker">San Francisco Bay / production traffic</p>
          <h2>Built where fog meets production traffic.</h2>
          <p>
            A bright control-plane surface for the moment agents start moving faster than human
            review queues.
          </p>
        </div>
        <nav className="footer-grid footer-link-grid" aria-label="Footer">
          <div>
            <h3>Explore</h3>
            <a href="#model">Model</a>
            <a href="#gate">Gate</a>
            <a href="#ledger">Ledger</a>
          </div>
          <div>
            <h3>Crate</h3>
            <a href="#roadmap">Roadmap</a>
            <a href={repoUrl}>Repository</a>
            <a href="https://github.com/erphq/floodwall/blob/main/GOALS.md">Goals</a>
          </div>
          <div>
            <h3>Related projects</h3>
            <a href="https://vmyard.com/">VMyard agent runtimes</a>
            <a href="https://knockstat.com/">knockstat server-log analytics</a>
            <a href="https://github.com/erphq/floodwall/blob/main/STATUS.md">Status</a>
            <a href="https://erp.ai">ERP.AI</a>
          </div>
        </nav>
        <div className="footer-bottom">
          <strong>SAN FRANCISCO BAY</strong>
          <span>&copy; 2026 Floodwall. An ERP.AI project. · built with <a href="https://proto.erp.ai">Proto</a></span>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <>
      <Hero />
      <main>
        <ModelSection />
        <GateLedgerSection />
        <Roadmap />
      </main>
      <FooterScene />
    </>
  );
}
