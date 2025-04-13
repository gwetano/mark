# 🖋️ Mark

**Mark** è un editor di file Markdown semplice, elegante e potente, pensato per prendere appunti in modo efficace. Include il supporto integrato a **Mermaid.js**, permettendoti di creare diagrammi direttamente nei tuoi documenti.

## 🚀 Funzionalità principali

- ✍️ Editor Markdown con anteprima in tempo reale
- 🧠 Supporto completo a [Mermaid](https://mermaid-js.github.io/) per diagrammi (flowchart, sequence, classi, ecc.)
- 📁 Explorer per navigare tra file e cartelle del progetto
- 💾 Salvataggio e caricamento di file `.md`
- 🌙 Modalità chiaro/scuro per una scrittura confortevole in ogni situazione
- ⚡ Interfaccia semplice e senza distrazioni

## 🛠️ Tecnologie utilizzate

- [React](https://react.dev/) 
- [Marked.js](https://marked.js.org/) o [Markdown-it](https://github.com/markdown-it/markdown-it)
- [Mermaid.js](https://mermaid-js.github.io/)

## 📦 Installazione

Segui questi semplici passaggi per installare e avviare Mark:

**Installa le dipendenze del progetto**

```bash
npm install
```
**Esegui lo script di installazione**

Lo script compilerà l'app, installerà le dipendenze necessarie, copierà l'icona, e creerà una voce nel menu delle applicazioni.

```bash
bash install.sh
```

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