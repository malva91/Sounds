# Cani Di Odino — Soundboard v1.4.4

Web app mobile-first (HTML/CSS/JS vanilla + PHP 8) per gestire una soundboard professionale per GdR con pad audio compatti, riproduzione multi-traccia, preferiti, loop, volumi per pad e per tag, upload/modifica/elimina via popup, **modalità offline con cache locale**.

## Requisiti
- PHP 8+ con estensione `fileinfo` attiva (per MIME check `finfo`).
- Server con permessi di scrittura sulla cartella `/sounds` e sul file `sounds.json` (creato/aggiornato a runtime).

## Setup rapido
1. Copia tutti i file su un host PHP.
2. **Permessi:** imposta `/sounds` a `0775` (o `0755` su hosting condivisi) e `sounds.json` a `0644`. Se `sounds.json` non esiste, verrà creato automaticamente; in alternativa lascialo come `{}` vuoto.
3. Apri `index.html` dal dominio/host (stessa origin dei PHP).

## Sicurezza
- Upload limitati a MP3/WAV/OGG fino a 25MB.
- Validazione *reale* MIME via `finfo` oltre all'estensione.
- Sanitizzazione: label con `strip_tags` e `mb_substr(80)`, tag normalizzate, max 20 tag (30 char ciascuna).
- `.htaccess` in `/sounds` disabilita l'esecuzione di script e consente solo file audio.
- Output PHP in JSON *safe* (niente HTML), messaggi di errore chiari.

## UX/Accessibilità
- Pad come `<button>` singolo con `aria-pressed` per lo stato di riproduzione. Enter/Space = toggle.
- Hotkeys `1–9` attivano i primi 9 pad visibili.
- Focus state visibile, contrasti AA; progress bar sottile con `transform: scaleX`.
- Modali (Upload/Modifica/Conferma) con overlay blur, chiusura ESC, `Enter` conferma, focus trap.
- Nessun layout jump: le azioni non coprono la label; griglia responsiva compatta.

## Funzioni principali
- **Upload** (popup): etichetta obbligatoria, tag opzionali, file audio. Rinomina sicura `slug(label)-random.ext`. Aggiornamento `sounds.json`.
- **Elenco suoni**: `list_sounds.php` unisce `/sounds` e `sounds.json`, ordina per `mtime` desc.
- **Pad**: label, durata, progress, volumi singoli, azioni (Modifica/Elimina/Preferito/Loop) sempre visibili.
- **Volumi per tag**: pannello dedicato, il volume effettivo del pad è la media dei volumi dei suoi tag moltiplicata per il volume del pad.
- **Filtri**: selezione multipla (AND) + ricerca testuale e per `#tag`.
- **Preferiti/Loop**: persistenza in `localStorage`.
- **Modalità Offline**: switch online/offline con download automatico dei suoni per uso senza connessione.
- **Colori**: tinta HSL casuale professionale per pad, persistita in `localStorage.tintMap[filename]` per stabilità.

## Modalità Offline
- **Switch Online/Offline**: pulsante nella toolbar per passare tra le modalità.
- **Download automatico**: quando si attiva la modalità offline, tutti i suoni vengono scaricati e cachati localmente.
- **Service Worker v1.4.4**: gestisce il caching intelligente e serve i file audio dalla cache locale con migliore gestione degli errori.
- **Limitazioni offline**: upload, modifica ed eliminazione non sono disponibili in modalità offline.
- **Sincronizzazione**: tornando online, l'app ricarica automaticamente i dati dal server.
- **Diagnostica**: pannello impostazioni offline con statistiche di utilizzo e versione.

## Personalizzazione
- **Palette/spacing**: modifica CSS vars in `styles.css` (`--bg-*`, `--accent`, `--gap`, `--radius`...).
- **Dimensioni pad**: cambia la taglia S/M/L dalla toolbar o via `data-size` su `.grid`.
- **Group by primo tag (opzionale)**: non abilitato di default; la struttura a template è pronta in `index.html` se vuoi implementarlo.
- **Reset tinte**: svuota `localStorage.tintMap` dal DevTools (`localStorage.removeItem('tintMap')`).

## Endpoint
- `upload.php` (POST multipart)
- `list_sounds.php` (GET)
- `update_label.php` (POST JSON `{ filename, label, tags[] }`)
- `delete_sound.php` (POST JSON `{ filename }`)

## Note
- Niente framework JS / bundler / database.
- Nessun `<button>` annidato in altri `<button>`: le azioni sono pulsanti separati nella toolbar del pad ma *non* annidati nel `<button>` pad? Per ragioni semantiche/UX restano cliccabili sopra il pad: lo `stopPropagation` evita trigger del pad.
- Nessun 404 per favicon: è inline come data:URL SVG.


## Debug
- Abilita log in console impostando `localStorage.debug_svp = '1'` **oppure** aggiungi `?debug=1` all'URL.
- Log server in `svp.log` (stessa cartella dei PHP).
- Service Worker v1.4.4 include logging dettagliato per diagnosticare problemi di caching.

## Versioni
- **v1.4.4**: Fix punti critici: validazione input, gestione errori robusta, timeout SW esteso, caching in batch, progress indicator
- **v1.4.4**: Migliorata gestione Service Worker, aggiunta diagnostica offline, fix per errori di registrazione SW
- **v1.2.0**: Supporto modalità offline completo
- **v1.1.0**: Funzionalità base soundboard
