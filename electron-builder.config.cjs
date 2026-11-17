/**
 * Configurazione installer. Nome, appId e icona arrivano da brand/brand.json,
 * così l'identità visiva si cambia in un solo posto.
 */
const brand = require('./brand/brand.json')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: brand.appId,
  productName: brand.name,
  directories: { buildResources: 'brand', output: 'dist' },
  files: ['out/**', 'package.json', '!**/*.map'],
  asarUnpack: ['**/node_modules/better-sqlite3/**'],
  npmRebuild: true,
  // Icona per la system tray (letta a runtime da process.resourcesPath).
  extraResources: [{ from: `brand/${brand.iconPng}`, to: brand.iconPng }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: `brand/${brand.icon}`,
    executableName: brand.name
  },
  // macOS (non ancora provato: vedi CLAUDE.md, "Spostarsi su Mac"). L'icona .icns viene
  // generata da electron-builder a partire dal PNG 512×512.
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    icon: `brand/${brand.iconPng}`,
    category: 'public.app-category.productivity'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: brand.name,
    artifactName: `${brand.name} Setup \${version}.\${ext}`
  }
}
