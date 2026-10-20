import SettingsContent from '../../components/SettingsContent';
import { useLockdownStore } from '../../stores/browserStore';

// browsie://settings. The Dashboard shows the same settings in a popup.
function SettingsPage() {
  const locked = useLockdownStore((state) => state.enabled);

  return (
    <div className={`absolute inset-0 overflow-y-auto ${locked ? 'pointer-events-none' : ''}`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-10 pb-16">
        <h1 className="bric text-[2.4rem] tracking-tighter text-black">Settings</h1>
        <SettingsContent />
      </div>
    </div>
  );
}

export default SettingsPage;
