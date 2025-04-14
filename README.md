# 🖋️ Mark

**Mark** è un editor Markdown semplice, potente e 100% in locale.  

*Nessun editor mi piaceva, troppa roba inutile e zero controllo.*

Per prendere appunti avevo bisogno di qualcosa che aprisse cartelle, leggesse file `.md` e salvasse. Nulla di più. Per avere un prodotto funzionante nel minor tempo possibile **gran parte delle funzionalità di questo progetto sono state generate da ChatGPT.**
Il mio lavoro è stato principalmente di coerenza, comprensione e fix del codice.

 ⚙️ Scritto in JavaScript

***

## ✨ Features

- 📝 Editor Markdown con preview in tempo reale
- 📁 Apertura di intere cartelle
- 📄 File tree laterale in stile VS Code
- 💾 Salvataggio veloce con `Cmd/Ctrl + S`
- 📤 Conteggio parole automatico
- 🧠 Supporto a formule matematiche (KaTeX)
- 💡 Interfaccia essenziale, niente distrazioni
- 🔒 Tutto locale, zero upload, zero cloud

---

## Installazione

### Linux
```bash
git clone https://github.com/gwetano/mark.git
cd mark
npm install
bash install.sh
```

![Screenshot Mark](./build/preview.gif)

***
## 📝 Utilizzo

### Editor e Preview

Mark ti permette di editare file Markdown e vedere l'anteprima in tempo reale. Puoi scegliere tra le modalità:
- Vista combinata (editor + preview)
- Solo editor (per concentrarti sulla scrittura)

### Explorer di File

L'explorer ti consente di:
- Navigare tra le cartelle del tuo progetto
- Visualizzare e aprire file Markdown
- Accedere rapidamente a tutti i documenti collegati

Per aprire una cartella:
1. Clicca sul pulsante "Explorer" nella barra in alto
2. Usa il pulsante "📁" nell'explorer o usa il menu File -> Apri cartella...
3. Seleziona la cartella desiderata

### Scorciatoie da tastiera

- **Alt+M**: Cambia tema (chiaro/scuro)
- **Alt+E**: Nascondi/mostra anteprima
- **Ctrl+B**: Nascondi/mostra explorer
- **Ctrl+O**: Apri file
- **Ctrl+Shift+O**: Apri cartella
- **Ctrl+S**: Salva file

***

## 📜 Licenza

Fai quello che vuoi.  
Se lo migliori, forkalo. Se ti aiuta, fammelo sapere.