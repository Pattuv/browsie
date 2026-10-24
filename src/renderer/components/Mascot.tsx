import type { CSSProperties } from "react";
import mascotSvg from "../assets/mascot.svg?raw";

type MascotProps = {
  className?: string;
  style?: CSSProperties;
  /** Omit for decorative artwork. */
  alt?: string;
};

// Inline so the artwork uses currentColor. Dark and high contrast remap text-black to white
// (index.css). An <img> plus filter: invert() loses that color: the entrance animations also
// set filter, and the later one wins, which left the mascot black on those appearances.
function Mascot({ className = "", style, alt = "" }: MascotProps) {
  return (
    <span
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={`inline-block aspect-[118/132] text-black leading-none [&_svg]:block [&_svg]:h-full [&_svg]:w-full ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: mascotSvg }}
    />
  );
}

export default Mascot;
