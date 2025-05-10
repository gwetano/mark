# 🖋️ Mark

**Mark** is a simple, powerful, and 100% local Markdown editor.  

*I didn’t vibe with any of the existing editors — too bloated, not enough control.*

I needed something that could open folders, read .md files, and save. Nothing more. To get a working product as fast as possible, **most of the features in this project were generated with ChatGPT.**  
My job was mostly about keeping it consistent, understanding how stuff worked, and fixing the code.

⚡ It’s vibe-coded. Not over-engineered.  
⚙️ Built with JavaScript

***

## ✨ Features

- 📝 Live Markdown editor with real-time preview
- 📁 Open full folders with ease
- 📄 Sidebar file tree, VS Code-style
- 💾 Quick save with Cmd/Ctrl + S
- 📤 Word count at a glance
- 🧠 Math formula support (KaTeX)
- 💡 Minimal UI, zero distractions
- 🔒 Fully local – no uploads, no cloud
- 🖼️ Custom image sizing for PDF export via caption tags  

---

## Installation

```bash
git clone https://github.com/gwetano/mark.git
cd mark
```

### Linux
```bash
npm install
bash install.sh
```
### Windows
```bash
./install.bat
```

![Screenshot Mark](./build/preview.gif)

***
## 📝 Usage

### Editor e Preview
Mark lets you edit Markdown and instantly preview the result. You can switch between:

- Split view (editor + preview)
- Editor-only mode for focused writing

### File Explorer

The file explorer helps you:
- Navigate through your folders
- Open Markdown files
- Quickly access all your docs

To open a folder:
1. Click "Explorer" on the top bar
2. Hit the "📁" icon or go to File -> Open Folder...
3. Pick your folder and you’re in

### Image Size in PDF Export

You can control the size of images in the exported PDF by adding a size tag in square brackets at the end of the alt text:

```
![Some image[small]](path/to/image.jpg)

![Another one[medium]](path/to/image.jpg)

![Bigger please[large]](path/to/image.jpg)

![Full width[full]](path/to/image.jpg)
```
Supported **size tags**:
- `[small]` -> 25% width
- `[medium]` → 50% width
- `[large]` → 75% width
- `[full]` → 100% width

If no tag is included, the default size will be used -> 70%.

### Keyboard Shortcuts

- **Alt+(Shift)+M**: Toggle light/dark theme
- **Alt+(Shift)+E**: Show/hide preview
- **Ctrl+N**: New file
- **Ctrl+O**: Open file
- **Ctrl+Shift+O**: Open folder
- **Ctrl+E**: Export as PDF
- **Ctrl+S**: Save file
- **Ctrl+F**: Find text

***
## 🛠️ Things to Improve

Wanna help out? Here’s what still needs love:

- 📂 **Image path handling**  
Right now, image paths are global — would be better if they were relative to the project folder.

- 🔍 **Text search**  
The current search is super basic. It needs smarter matching, maybe even fuzzy search or highlights.

- 🎨 **Custom styling**  
The UI is intentionally minimal, but if you’ve got specific style needs, feel free to tweak it. Themes, fonts, or whatever makes it yours.

***

## 📜 License

Do whatever you want with it.  
If you improve it, fork it. If it helps you, let me know.
