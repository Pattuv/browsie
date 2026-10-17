import spinner from "../assets/spinner.svg";

type SplashScreenProps = {
  /** True once the chrome is ready: the tint and the spinner fade away. */
  leaving: boolean;
};

/**
 * The launch screen, already in its resting state when the window appears: the OS-blurred
 * wallpaper through the transparent window, a translucent black tint, and the spinner.
 * One blur only. The tint and spinner fade off once the chrome is in.
 */
function SplashScreen({ leaving }: SplashScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden ${
        leaving ? "splash-leaving pointer-events-none" : ""
      }`}
    >
      <div className="splash-tint absolute inset-0" aria-hidden="true" />
      <div className="splash-spinner-wrap relative">
        <img src={spinner} alt="" className="splash-spinner h-14 w-14" />
      </div>
      {/* The spinner is decoration; screen readers hear this instead. */}
      <span className="sr-only">
        {leaving ? "Browsie is ready." : "Browsie is starting."}
      </span>
    </div>
  );
}

export default SplashScreen;
