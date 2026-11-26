import * as path from 'path';
import * as vscode from 'vscode';
import { parseImage } from './parsers';
import { buildWebviewPayload, getWebviewContent } from './webview';

class HexViewProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'hexviewer.hexView';

  public openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    const fsPath = document.uri.fsPath;
    const baseName = path.basename(fsPath) || fsPath;
    webviewPanel.title = `${baseName} (hex)`;

    let initialized = false;
    const load = async () => {
      try {
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        const image = parseImage(Buffer.from(bytes), fsPath);
        if (!initialized) {
          initialized = true;
          webviewPanel.webview.html = getWebviewContent(image, baseName);
        } else {
          void webviewPanel.webview.postMessage({
            type: 'update',
            payload: buildWebviewPayload(image, baseName),
          });
        }
      } catch (err) {
        initialized = false;
        webviewPanel.webview.html = `<!DOCTYPE html><body style="font-family:sans-serif;padding:16px;color:#f48771">
          Failed to read file: ${String(err)}</body>`;
      }
    };

    await load();

    const msgSub = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'copy' && typeof msg.text === 'string') {
        await vscode.env.clipboard.writeText(msg.text);
      } else if (msg.type === 'exportBin' && Array.isArray(msg.bytes)) {
        const defaultUri = vscode.Uri.file(
          fsPath.replace(/\.[^.]+$/, '') + (msg.suffix || '.slice.bin')
        );
        const target = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { 'Binary files': ['bin'], 'All files': ['*'] },
        });
        if (target) {
          await vscode.workspace.fs.writeFile(target, Uint8Array.from(msg.bytes));
          void vscode.window.showInformationMessage(`Exported ${msg.bytes.length} bytes to ${target.fsPath}`);
        }
      }
    });

    // Debounced reload on text edits or disk changes (e.g. .bin rebuilt by compiler)
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, 250);
    };
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) scheduleLoad();
    });
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.dirname(fsPath)), baseName)
    );
    watcher.onDidChange(scheduleLoad);
    watcher.onDidCreate(scheduleLoad);

    webviewPanel.onDidDispose(() => {
      if (timer) clearTimeout(timer);
      changeSub.dispose();
      watcher.dispose();
      msgSub.dispose();
    });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(HexViewProvider.viewType, new HexViewProvider(), {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
}

export function deactivate(): void {}
