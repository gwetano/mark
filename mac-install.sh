#!/bin/bash

# Aggiorna Homebrew
echo "Updating Homebrew..."
brew update

# Installa Node.js se non è già installato
if ! command -v node &> /dev/null
then
    echo "Node.js not found. Installing..."
    brew install node
else
    echo "Node.js is already installed."
fi

# Installa Electron e Electron Builder
echo "Installing dependencies..."
npm install

# Costruisce l'app per macOS
echo "Building the app for macOS..."
npm run build

# Crea il pacchetto DMG
echo "Creating DMG package..."
electron-builder --mac

echo "Installation complete!"

