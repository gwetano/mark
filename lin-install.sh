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

# Funzione per barra di avanzamento testuale
progress_bar() {
  local progress=$1
  local total=$2
  local width=40
  local percent=$((progress * 100 / total))
  local filled=$((progress * width / total))
  local empty=$((width - filled))
  printf "["
  for ((i=0; i<filled; i++)); do printf "#"; done
  for ((i=0; i<empty; i++)); do printf "-"; done
  printf "] %d%%\r" "$percent"
}

steps=("Installazione dipendenze" "Build progetto" "Copia file" "Compilazione mark.c" "Installazione completata")
total=${#steps[@]}

clear

for i in "${!steps[@]}"; do
  step=${steps[$i]}
  echo "\n$step..."
  progress_bar $((i+1)) $total
  sleep 1 # Simula tempo di esecuzione
  case $step in
    "Installazione dipendenze")
      npm install > /dev/null 2>&1
      ;;
    "Build progetto")
      npm run build > /dev/null 2>&1
      ;;
    "Copia file")
      sudo mkdir -p "$INSTALL_DIR"
      sudo cp -r "$DIST_DIR"/* "$INSTALL_DIR/"
      sudo chmod +x "$INSTALL_DIR/mark"
      ;;
    "Compilazione mark.c")
      gcc -o mark mark.c > /dev/null 2>&1
      sudo cp mark "$BIN_DIR/mark"
      sudo chmod +x "$BIN_DIR/mark"
      ;;
    "Installazione completata")
      echo "Mark è stato installato correttamente!"
      ;;
  esac
  sleep 0.5
  echo ""
done

cat <<EOF > "$DESKTOP_FILE"
[Desktop Entry]
Version=1.0
Name=Mark
Comment=App Mark
Exec=$INSTALL_DIR/mark
Icon=mark
Terminal=false
Type=Application
Categories=Utility;
EOF
chmod +x "$DESKTOP_FILE"
update-desktop-database ~/.local/share/applications/

echo "\nPuoi trovare Mark nel menu applicazioni o eseguirlo da terminale con 'mark' o 'mark nomefile.md'"
