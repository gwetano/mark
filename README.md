# 🖋️ Mark

**Mark** is a simple, powerful, and 100% local Markdown editor.  

*I didn’t vibe with any of the existing editors — too bloated, not enough control.*

I needed something that could open folders, read. md files, and save. Nothing more. To get a working product as fast as possible, **most of the features in this project were generated with ChatGPT.**  
My job was mostly about keeping it consistent, understanding how stuff worked, and fixing the code.

⚡ It’s vibe-coded.    
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

***

## Installation 

```bash
git clone https://github.com/gwetano/mark.git
cd mark
```

### Linux

```bash
bash lin-install.sh
```

### Windows

```bash
./win-install.bat
```

### macOS

```bash
bash mac-install.sh
```

***

## Preview

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
1. Click"Explorer" on the top bar
2. Hit the"📁" icon or go to File -> Open Folder...
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

* **Ctrl+M**: Toggle light/dark theme
* **Ctrl+E**: Show/hide preview
* **Ctrl+N**: New file
* **Ctrl+O**: Open file
* **Ctrl+Shift+O**: Open folder
* **Ctrl+E**: Export as PDF
* **Ctrl+S**: Save file
* **Ctrl+F**: Find text
* **Ctrl+R**: Show/hide explorer

### Table of Contents

To add a Table of Contents (TOC) to your PDF export, simply add the following comment at the top of your markdown file:

```
<!-- TOC -->
```

This will generate a first page in the PDF with an index of all headings and subheadings, with clickable links that navigate to the respective section in the document.

***

## 🤷‍♂️ New to Markdown? No worries!

You can still get the most out of Mark even if you don’t know Markdown syntax. Here are some handy shortcuts that let you format your text instantly:

* **Ctrl+B**: Bold
* **Ctrl+I**: Italic
* **Ctrl+U**: Underline
* **Ctrl+1**: Heading 1
* **Ctrl+2**: Heading 2
* **Ctrl+3**: Heading 3
* **Ctrl+ H**: Code (inline for selected text, multiline if not selected)
* **Ctrl+L**: Link

Stay focused on writing — Mark will take care of the formatting.

***

## 🛠️ Things to Improve

Wanna help out? Here’s what still needs love:

* 🔍 **Text search**  
The current search is super basic. It needs smarter matching, maybe even fuzzy search or highlights.

* 🎨 **Custom styling**  
The UI is intentionally minimal, but if you’ve got specific style needs, feel free to tweak it. Themes, fonts, or whatever makes it yours.

* 📃 **Synchronized scrolling**    
Editor and preview should scroll together, especially in split view. This needs to be improved.

***

## 🧠 AI Tool (Groq)

Mark includes an integrated AI assistant that can help you:

* Explain selected text  
* Translate content  
* Correct grammar mistakes  

### How to Enable It

To use the AI features, you'll need a **Groq API key**. Here's how to get one:

1. Visit [https://console.groq.com/keys](https://console.groq.com/keys)
2. Sign up or log in  
3. Click **"Generate API Key"**  
4. Copy the key

### 🔐 Secure API Key Handling

To keep your Groq API key private and secure:

1. Create a file called `.env.local` in the root of your project:

```
GROQ_API_KEY=your_actual_groq_key_here
```

2. Make sure `.env.local` is listed in `.gitignore` to prevent committing it:

```
.env.local
```

3. The app will automatically load your key at startup.

**Important:** Never commit your API key to version control.

### 💬 How It Works

* Select any text in the editor
* Right-click and choose AI Tool
* Type your query (e. g. “Explain this concept”)
* The AI will return a helpful answer in seconds

***

## 📜 License

Do whatever you want with it.    
If you improve it, fork it. If it helps you, let me know.