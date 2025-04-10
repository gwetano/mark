#!/bin/bash

# Imposta variabili per il percorso dell'AppImage e del file .desktop
APPIMAGE_PATH="$PWD/dist/Mark-1.0.1.AppImage"
INSTALL_DIR="/opt/mark"  # Puoi usare una directory di tua scelta
DESKTOP_FILE="$HOME/.local/share/applications/Mark.desktop"
# Copia l'icona nella directory delle icone locali

ICON_SOURCE="$PWD/build/mark.png"
ICON_DEST="$HOME/.local/share/icons/mark.png"
mkdir -p "$(dirname "$ICON_DEST")"
cp "$ICON_SOURCE" "$ICON_DEST"

#installo patches
#npm run build

# Controlla se il file AppImage esiste
if [[ ! -f "$APPIMAGE_PATH" ]]; then
  echo "Errore: file AppImage non trovato in $APPIMAGE_PATH"
  exit 1
fi

# Crea la directory di destinazione se non esiste
sudo mkdir -p "$INSTALL_DIR"



# Copia l'AppImage nella directory di destinazione
sudo cp "$APPIMAGE_PATH" "$INSTALL_DIR/"

# Rendi l'AppImage eseguibile
sudo chmod +x "$INSTALL_DIR/Mark-1.0.1.AppImage"


# Crea un file .desktop per l'app
echo "[Desktop Entry]
Version=1.0
Name=Mark
Comment=App Mark
Exec=$INSTALL_DIR/Mark-1.0.1.AppImage
Icon=mark
Terminal=false
Type=Application
Categories=Utility;
" > "$DESKTOP_FILE"

# Rendi eseguibile il file .desktop
chmod +x "$DESKTOP_FILE"

# Aggiungi l'app al menu delle applicazioni
update-desktop-database ~/.local/share/applications/

# Mostra un messaggio di successo
echo "Mark è stato installato correttamente. Puoi trovarlo nel menu delle applicazioni."
