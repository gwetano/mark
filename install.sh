#!/usr/bin/env bash

# Imposta variabili per i percorsi
DIST_DIR="$PWD/dist/linux-unpacked"
APPIMAGE_PATH="$DIST_DIR/mark"
INSTALL_DIR="/opt/mark"
DESKTOP_FILE="$HOME/.local/share/applications/Mark.desktop"
BIN_DIR="/usr/local/bin"

# Copia l'icona nella directory delle icone locali
ICON_SOURCE="$PWD/build/mark.png"
ICON_DEST="$HOME/.local/share/icons/mark.png"
mkdir -p "$(dirname "$ICON_DEST")"
cp "$ICON_SOURCE" "$ICON_DEST"

# Esegui la build del progetto
echo "Esecuzione della build..."
npm install
npm run build

# Controlla se il file eseguibile esiste
if [ ! -f "$APPIMAGE_PATH" ]; then
  echo "Errore: file eseguibile non trovato in $APPIMAGE_PATH"
  exit 1
fi

# Crea la directory di installazione e copia l'applicazione
echo "Installazione dell'applicazione in $INSTALL_DIR..."
sudo mkdir -p "$INSTALL_DIR"
sudo cp -r "$DIST_DIR"/* "$INSTALL_DIR/"
sudo chmod +x "$INSTALL_DIR/mark"

# Imposta i permessi corretti per chrome-sandbox
if [ -f "$INSTALL_DIR/chrome-sandbox" ]; then
  echo "Impostazione dei permessi corretti per chrome-sandbox..."
  sudo chown root:root "$INSTALL_DIR/chrome-sandbox"
  sudo chmod 4755 "$INSTALL_DIR/chrome-sandbox"
fi

# Verifica se libffmpeg.so esiste nella directory di distribuzione
if [ -f "$DIST_DIR/libffmpeg.so" ]; then
  echo "Copiando libffmpeg.so..."
  sudo cp "$DIST_DIR/libffmpeg.so" "$INSTALL_DIR/"
else
  echo "Attenzione: libffmpeg.so non trovato in $DIST_DIR"
  # Cercare libffmpeg.so nella directory node_modules
  FFMPEG_PATH=$(find "$PWD/node_modules" -name "libffmpeg.so" | head -n 1)
  if [ -n "$FFMPEG_PATH" ]; then
    echo "libffmpeg.so trovato in $FFMPEG_PATH"
    sudo cp "$FFMPEG_PATH" "$INSTALL_DIR/"
  else
    echo "libffmpeg.so non trovato. L'applicazione potrebbe non funzionare correttamente."
  fi
fi

# Compilazione e installazione del comando mark da terminale
echo "Compilazione del programma mark.c per l'esecuzione da terminale..."
gcc -o mark mark.c
if [ $? -ne 0 ]; then
  echo "Errore durante la compilazione di mark.c"
  exit 1
fi

echo "Installazione del comando 'mark' nel sistema..."
sudo cp mark "$BIN_DIR/mark"
sudo chmod +x "$BIN_DIR/mark"

# Crea il file desktop
echo "Creazione del collegamento nel menu applicazioni..."
echo "[Desktop Entry]
Version=1.0
Name=Mark
Comment=App Mark
Exec=$INSTALL_DIR/mark
Icon=mark
Terminal=false
Type=Application
Categories=Utility;
" > "$DESKTOP_FILE"
chmod +x "$DESKTOP_FILE"

# Aggiorna il database del desktop
update-desktop-database ~/.local/share/applications/

echo "Mark è stato installato correttamente. Puoi trovarlo nel menu delle applicazioni."
echo "Puoi anche eseguire Mark da terminale usando il comando 'mark' o 'mark nomefile.md'"
