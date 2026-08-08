import type { ReactNode } from 'react';
import onboardingBg from '../assets/onboardingbg.png';

type BoilerProps = {
  background?: boolean;
  children: ReactNode;
};

function Boiler({ background = false, children }: BoilerProps) {
  return (
    <div
      className="flex h-full min-h-full flex-col bg-cover bg-center bg-no-repeat p-4 pt-14"
      style={background ? { backgroundImage: `url(${onboardingBg})` } : undefined}
    >
      {children}
    </div>
  );
}

export default Boiler;
