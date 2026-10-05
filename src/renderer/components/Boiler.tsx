import type { ReactNode } from 'react';

type BoilerProps = {
  background?: boolean;
  children: ReactNode;
};

function Boiler({ background = false, children }: BoilerProps) {
  return (
    <div
      className="flex h-full min-h-full flex-col bg-cover bg-center bg-no-repeat p-4 pt-14"
    >
      {children}
    </div>
  );
}

export default Boiler;
