import Boiler from '../../components/Boiler';

function Auth() {
  return (
    <Boiler background>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-5">
        <p className="text-3xl text-center bric tracking-tighter">Let's get started.</p>
        <button className="bg-black text-white px-8 py-4 rounded-2xl tracking-tight transition-all duration-300 ease-out group-hover:py-6 group-hover:ring-0">
          <p className="text-base font-medium"><i className="bi bi-google mr-3"></i>Continue with Google</p>
        </button>
      </div>
    </Boiler>
  );
}

export default Auth;
