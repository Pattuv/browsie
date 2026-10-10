import wordmark from '../assets/wordmark.svg';

type SplashScreenProps = {
  /** True once the chrome is ready: the glass clears and the gradient fades away. */
  leaving: boolean;
};

/**
 * The launch screen: frosted glass over the chrome while it loads. Three stacked layers:
 * a backdrop blur (the browser assembling behind it, out of focus), a see-through
 * white-to-purple gradient, and film grain. The root itself never animates opacity or filter:
 * either would cut the backdrop blur off from the chrome behind it.
 */
function SplashScreen({ leaving }: SplashScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden ${
        leaving ? 'splash-leaving pointer-events-none' : ''
      }`}
    >
      <div className="splash-backdrop absolute inset-0" aria-hidden="true" />
      <div className="splash-gradient absolute inset-0" aria-hidden="true" />
      <div className="splash-grain absolute inset-0" aria-hidden="true" />
      {/* The wrapper animates; the image keeps its own filter that turns the wordmark white. */}
      <div className="splash-wordmark-wrap enter-blur-slow relative" style={{ animationDelay: '350ms' }}>
        <img src={wordmark} alt="" className="splash-wordmark h-11" />
      </div>
      {/* The wordmark is decoration; screen readers hear this instead. */}
      <span className="sr-only">{leaving ? 'Browsie is ready.' : 'Browsie is starting.'}</span>
    </div>
  );
}

export default SplashScreen;
