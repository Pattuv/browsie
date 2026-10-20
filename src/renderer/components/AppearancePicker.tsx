import darkPreview from "../assets/appearanceicons/dark.png";
import highContrastPreview from "../assets/appearanceicons/high contrast.png";
import lightPreview from "../assets/appearanceicons/light.png";
import systemPreview from "../assets/appearanceicons/system.png";
import type { Appearance } from "../theme";

const OPTIONS: { value: Appearance; label: string; preview: string }[] = [
  { value: "light", label: "Light", preview: lightPreview },
  { value: "dark", label: "Dark", preview: darkPreview },
  { value: "system", label: "System", preview: systemPreview },
  { value: "high-contrast", label: "High Contrast", preview: highContrastPreview },
];

type AppearancePickerProps = {
  value: Appearance;
  onChange: (appearance: Appearance) => void;
  className?: string;
};

// The four preview cards (setup and Settings). The chosen one gets the purple ring.
function AppearancePicker({ value, onChange, className = "" }: AppearancePickerProps) {
  return (
    <div role="radiogroup" aria-label="Appearance" className={`grid grid-cols-4 gap-4 ${className}`}>
      {OPTIONS.map((option) => {
        const selected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={`smooth app-region-no-drag cursor-pointer overflow-hidden rounded-2xl transition-[transform,box-shadow] duration-200 ease-out hover:scale-[1.03] active:scale-[0.98] ${
              selected
                ? "shadow-[0_0_0_3px_#9572FF,0_10px_28px_-10px_rgba(149,114,255,0.6)]"
                : "shadow-[0_0_0_1px_var(--color-zinc-300)]"
            }`}
          >
            <img
              src={option.preview}
              alt=""
              draggable={false}
              className="block aspect-[777/483] w-full object-cover"
            />
          </button>
        );
      })}
    </div>
  );
}

export default AppearancePicker;
