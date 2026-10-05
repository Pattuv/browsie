import type { ButtonHTMLAttributes } from 'react';

// The black, rounded-corner action button (Log out, Continue). Pass className for layout only
// (width, margins); the look lives here so every primary button matches.
function PrimaryButton({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`h-12 cursor-pointer rounded-xl bg-black text-base tracking-tight text-white transition-transform duration-200 ease-out active:scale-[0.98] disabled:cursor-default disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}

export default PrimaryButton;
