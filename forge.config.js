const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const ICONS_DIR = 'src/renderer/assets/icons';

module.exports = {
  packagerConfig: {
    asar: true,
    // No extension: the packager adds .icns on macOS and .ico on Windows.
    icon: process.platform === 'darwin' ? `${ICONS_DIR}/macos/icon` : `${ICONS_DIR}/windows/icon`,
    // macOS only (Finder / App Store category). Ignored on Windows.
    appCategoryType: 'public.app-category.productivity',
    // macOS: the line shown in the microphone prompt. Without it, macOS refuses the mic outright.
    extendInfo: {
      NSMicrophoneUsageDescription: 'Browsie listens while you hold the spacebar, so you can tell it what to do.',
    },
  },
  rebuildConfig: {},
  // `npm run make` builds the installer for the OS it runs on.
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        setupIcon: `${ICONS_DIR}/windows/icon.ico`,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main/main.ts',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            // The agent utilityProcess: its own bundle, forked by src/main/agent/host.ts.
            entry: 'src/agent/worker.ts',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload.ts',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
