# Identità visiva (placeholder)

Tutto ciò che riguarda nome, colori, logo e icona sta in questa cartella.
Logo e icona sono quelli definitivi di Nimbus; i **colori** sono ancora placeholder: sostituiscili e ricompila.
`logo.svg` è usato nell'interfaccia come maschera (prende il colore del testo del tema), quindi basta un segno monocromatico.

| File | Cosa contiene | Dove viene usato |
|---|---|---|
| `brand.json` → `name` | Nome dell'app | titolo finestra, installer, collegamento desktop, notifiche, cartella dati `%APPDATA%\<name>` |
| `brand.json` → `appId` | ID applicazione Windows | notifiche native, installer (cambiarlo dopo la distribuzione crea un'app "diversa") |
| `brand.json` → `colors.dark` / `colors.light` | Palette completa dei due temi | tutta la UI (variabili CSS `--accent`, `--fg`, …); `surfaceSolid` è anche lo sfondo della finestra senza Mica |
| `logo.svg` | Logo (quadrato, mostrato a 16–36px) | barra del titolo, onboarding |
| `icon.ico` | Icona Windows (multi-risoluzione, almeno 256×256) | `.exe`, installer, collegamenti |
| `icon.png` | Icona 512×512 | finestra in sviluppo |

Colori: `accent` è il colore principale (pulsanti, selezione, badge), `accentStrong` la sua variante hover.
I valori `rgba(...)` semitrasparenti lasciano intravedere l'effetto Mica di Windows 11.

Per generare `icon.ico` da un PNG 1024×1024 puoi usare qualsiasi convertitore che includa le taglie 16, 32, 48, 64, 128, 256.
