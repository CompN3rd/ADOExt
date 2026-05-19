Package the extension as a `.vsix` file for manual installation and testing.

Steps:
1. Run `npm run compile` first to ensure the build is current.
2. Run `npx @vscode/vsce package` to generate the `.vsix`.

Report the output filename and size. To install the packaged extension locally: VS Code → Extensions → `...` → "Install from VSIX".
