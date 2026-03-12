#!/bin/bash
# ============================================================
# build-extension.sh — Empacota o KeepLocal como Chrome Extension
# ============================================================
set -euo pipefail

VERSION="1.0.0"
EXT_DIR="chrome-extension"
DIST_DIR="dist"
ZIP_NAME="keep_local_extension_v${VERSION}.zip"

echo "🔨 KeepLocal Extension Builder v${VERSION}"
echo "============================================"

# Verify extension scaffolding exists
for f in "$EXT_DIR/manifest.json" "$EXT_DIR/service-worker.js" "$EXT_DIR/privacy.html"; do
  if [[ ! -f "$f" ]]; then
    echo "❌ Arquivo não encontrado: $f"
    exit 1
  fi
done

if [[ ! -d "$EXT_DIR/icons" ]] || [[ ! -f "$EXT_DIR/icons/icon-128.png" ]]; then
  echo "❌ Ícones não encontrados em $EXT_DIR/icons/"
  exit 1
fi

# Copy app files into extension directory
echo "📂 Copiando arquivos do app..."

# CSS
rm -rf "$EXT_DIR/css"
cp -r css "$EXT_DIR/css"
echo "   ✅ css/"

# JS
rm -rf "$EXT_DIR/js"
cp -r js "$EXT_DIR/js"
echo "   ✅ js/"

# Lib (vendor)
rm -rf "$EXT_DIR/lib"
cp -r lib "$EXT_DIR/lib"
echo "   ✅ lib/"

# HTML
cp index.html "$EXT_DIR/index.html"
echo "   ✅ index.html"

# Create dist directory
mkdir -p "$DIST_DIR"

# Remove old ZIP if exists
rm -f "$DIST_DIR/$ZIP_NAME"

# Create ZIP
echo ""
echo "📦 Criando pacote ZIP..."
cd "$EXT_DIR"
zip -r -q "../$DIST_DIR/$ZIP_NAME" . -x ".*"
cd ..

echo ""
echo "✅ Pacote criado: $DIST_DIR/$ZIP_NAME"
echo ""

# Show contents
echo "📋 Conteúdo do pacote:"
unzip -l "$DIST_DIR/$ZIP_NAME" | tail -n +4 | head -n -2 | awk '{print "   " $4}'

echo ""
SIZE=$(du -h "$DIST_DIR/$ZIP_NAME" | cut -f1)
echo "📊 Tamanho: $SIZE"
echo ""
echo "🚀 Pronto para upload na Chrome Web Store!"
echo "   Ou teste localmente: chrome://extensions > Modo desenvolvedor > Carregar sem compactação > selecione a pasta '$EXT_DIR/'"
