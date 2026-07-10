import { createRoot } from 'react-dom/client';

function Main() {
  return (
    <div className="h-screen px-10 font-medium tracking-tighter inter text-center py-10">
      <h1 className="text-4xl">theo.ai</h1>
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<Main />);
