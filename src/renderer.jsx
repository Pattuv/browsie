import { createRoot } from 'react-dom/client';

function Main() {
  return (
    <div className="h-screen flex flex-col">
      <div className="h-10 w-full shrink-0" style={{ WebkitAppRegion: 'drag' }} />
      <div className="flex-1 px-10 font-medium tracking-tighter inter text-center py-10">
        <h1 className="text-4xl">theo.ai</h1>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<Main />);
