#!/bin/bash

# Funzione barra di avanzamento testuale
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

steps=("Aggiornamento Homebrew" "Installazione Node.js" "Installazione dipendenze" "Build app" "Creazione DMG" "Installazione completata")
total=${#steps[@]}

clear
for i in "${!steps[@]}"; do
  step=${steps[$i]}
  echo "$step..."
  progress_bar $((i+1)) $total
  sleep 1 # Simula tempo di esecuzione
  case $step in
    "Aggiornamento Homebrew")
      brew update > /dev/null 2>&1
      ;;
    "Installazione Node.js")
      if ! command -v node &> /dev/null; then
        brew install node > /dev/null 2>&1
      fi
      ;;
    "Installazione dipendenze")
      npm install > /dev/null 2>&1
      ;;
    "Build app")
      npm run build > /dev/null 2>&1
      ;;
    "Creazione DMG")
      electron-builder --mac > /dev/null 2>&1
      ;;
    "Installazione completata")
      echo "Mark è stato installato correttamente!"
      ;;
  esac
  sleep 0.5
  echo ""
done

echo "Trovi Mark nella cartella Applicazioni o puoi avviarlo direttamente."

