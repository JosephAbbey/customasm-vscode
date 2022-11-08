import * as vscode from 'vscode';
import * as fs from 'fs';
import path = require('path');
import cp = require('child_process');

/**
 * @param {string} exe executable name (without extension if on Windows)
 * @return {Promise<string|null>} executable path if found
 * */
async function findExecutable(exe) {
    const envPath = process.env.PATH || '';
    const envExt = process.env.PATHEXT || '';
    const pathDirs = envPath
        .replace(/["]+/g, '')
        .split(path.delimiter)
        .filter(Boolean);
    const extensions = envExt.split(';');
    const candidates = pathDirs.flatMap((d) =>
        extensions.map((ext) => path.join(d, exe + ext))
    );
    try {
        return await Promise.any(candidates.map(checkFileExists));
    } catch (e) {
        return null;
    }

    async function checkFileExists(filePath) {
        if ((await fs.stat(filePath)).isFile()) {
            return filePath;
        }
        throw new Error('Not a file');
    }
}

export function activate(context: vscode.ExtensionContext) {
    let assemble: (
        document: vscode.TextDocument,
        format: string
    ) => string = () => '';
    findExecutable('customasm').then((exe) => {
        if (exe === null) {
            let WASM: WebAssembly.WebAssemblyInstantiatedSource | null = null;

            WebAssembly.instantiate(
                fs.readFileSync(
                    path.join(context.extensionPath, 'media', 'compile.wasm')
                )
            ).then((wasm) => (console.log(wasm), (WASM = wasm)));

            assemble = function (
                document: vscode.TextDocument,
                format: string
            ) {
                const code = document.getText();
                let asmPtr = makeRustString(code);
                let outputPtr = null;
                try {
                    //@ts-expect-error
                    outputPtr = WASM?.instance.exports.wasm_assemble(
                        [
                            'Annotated',
                            'Annotated Bin',
                            'Hex Dump',
                            'Bin Dump',
                            'Hex String',
                            'Hex Line by Line',
                            'Bin String',
                            'Bin Line by Line',
                            'COE',
                            'MIF',
                            'MIF BIN',
                            'Intel HEX',
                            'Comma-separated Dec',
                            'Comma-separated Hex',
                            'C Dec Array',
                            'C Hex Array',
                            'VHDL Bin Array',
                            'VHDL Hex Array',
                            'LogiSim 8-bit',
                            'LogiSim 16-bit',
                        ].indexOf(format),
                        asmPtr
                    );
                } catch (e) {
                    vscode.window.showErrorMessage('Error assembling!\n\n' + e);
                    throw e;
                }

                let output = readRustString(outputPtr);

                //@ts-expect-error
                WASM?.instance.exports.wasm_string_drop(asmPtr);
                //@ts-expect-error
                WASM?.instance.exports.wasm_string_drop(outputPtr);

                output = output.replace(/\n/g, '<br>');
                output = output.replace(
                    / --> asm:\x1b\[0m\x1b\[90m(\d+):(\d+)/g,
                    (_, line, column) =>
                        ` --> asm:<button class="a" onclick="window.goto(${
                            line - 1
                        },${column - 1})">${line}:${column}</button>`
                );
                output = output.replace(
                    /\x1b\[90m/g,
                    "</span><span style='color:var(--vscode-disabledForeground);'>"
                );
                output = output.replace(
                    /\x1b\[91m/g,
                    "</span><span style='color:var(--vscode-errorForeground);'>"
                );
                output = output.replace(
                    /\x1b\[93m/g,
                    "</span><span style='color:#f80;'>"
                );
                output = output.replace(
                    /\x1b\[96m/g,
                    "</span><span style='color:#08f;'>"
                );
                output = output.replace(
                    /\x1b\[97m/g,
                    "</span><span style='color:var(--vscode-foreground);'>"
                );
                output = output.replace(
                    /\x1b\[1m/g,
                    "</span><span style='font-weight:bold;'>"
                );
                output = output.replace(
                    /\x1b\[0m/g,
                    "</span><span style='color:var(--vscode-foreground);'>"
                );

                output =
                    "<span style='color:var(--vscode-foreground);'>" +
                    output +
                    '</span>';

                return output;
            };

            function makeRustString(str: string) {
                let bytes = new TextEncoder().encode(str);

                //@ts-expect-error
                let ptr = WASM?.instance.exports.wasm_string_new(bytes.length);

                for (let i = 0; i < bytes.length; i++) {
                    //@ts-expect-error
                    WASM?.instance.exports.wasm_string_set_byte(
                        ptr,
                        i,
                        bytes[i]
                    );
                }

                return ptr;
            }

            function readRustString(ptr: number) {
                //@ts-expect-error
                let len = WASM?.instance.exports.wasm_string_get_len(ptr);

                let bytes = [];
                for (let i = 0; i < len; i++) {
                    //@ts-expect-error
                    bytes.push(
                        WASM?.instance.exports.wasm_string_get_byte(ptr, i)
                    );
                }

                return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
            }
        } else {
            // If the customasm cli is on the path, use it.
            assemble = (document: vscode.TextDocument, format: string) => {
                document.save();
                // TODO: Fix colourisation
                return cp.execSync(
                    `${exe} ${document.uri.fsPath} -f ${
                        {
                            Annotated: 'annotated',
                            'Annotated Bin': 'annotatedbin',
                            'Hex Dump': 'hexdump',
                            'Bin Dump': 'bindump',
                            'Hex String': 'hexstr',
                            'Hex Line by Line': 'hexline',
                            'Bin String': 'binstr',
                            'Bin Line by Line': 'binline',
                            COE: 'coe',
                            MIF: 'mif',
                            'MIF BIN': 'mifbin',
                            'Intel HEX': 'intelhex',
                            'Comma-separated Dec': 'deccomma',
                            'Comma-separated Hex': 'hexcomma',
                            'C Dec Array': 'decc',
                            'C Hex Array': 'hexc',
                            'VHDL Bin Array': 'binvhdl',
                            'VHDL Hex Array': 'hexvhdl',
                            'LogiSim 8-bit': 'logisim8',
                            'LogiSim 16-bit': 'logisim16',
                        }[format]
                    } -p -q`
                );
            };
        }

        let disposable = vscode.commands.registerTextEditorCommand(
            'customasm.compile',
            (editor) => {
                vscode.window
                    .showQuickPick(
                        [
                            'Annotated',
                            'Annotated Bin',
                            'Hex Dump',
                            'Bin Dump',
                            'Hex String',
                            'Hex Line by Line',
                            'Bin String',
                            'Bin Line by Line',
                            'COE',
                            'MIF',
                            'MIF BIN',
                            'Intel HEX',
                            'Comma-separated Dec',
                            'Comma-separated Hex',
                            'C Dec Array',
                            'C Hex Array',
                            'VHDL Bin Array',
                            'VHDL Hex Array',
                            'LogiSim 8-bit',
                            'LogiSim 16-bit',
                        ],
                        {
                            title: 'Format:',
                        }
                    )
                    .then((format) => {
                        if (!format) {
                            return;
                        }
                        let panel = vscode.window.createWebviewPanel(
                            'customasm',
                            `Customasm - ${format} (${
                                vscode.window.tabGroups.activeTabGroup.activeTab
                                    ?.label || 'None'
                            })`,
                            vscode.ViewColumn.Beside,
                            {
                                enableScripts: true,
                            }
                        );

                        panel.webview.onDidReceiveMessage(
                            (message) => {
                                switch (message.command) {
                                    case 'goto':
                                        let a = message.text.split(' ');
                                        let l = parseInt(a[0]);
                                        let c = parseInt(a[1]);
                                        editor.revealRange(
                                            new vscode.Range(
                                                new vscode.Position(l, c),
                                                new vscode.Position(l, c)
                                            )
                                        );
                                        editor.selection = new vscode.Selection(
                                            l,
                                            0,
                                            l,
                                            999
                                        );
                                        break;
                                }
                            },
                            undefined,
                            context.subscriptions
                        );

                        panel.webview.html = `<!DOCTYPE html>
                            <html lang="en">
                                <head>
                                    <title>customasm</title>
                                    <meta charset="utf-8">
                                    <style>
                                        #output {
                                            width: 100px;
                                            height: 100px;
                                            font-family: Consolas, monospace;
                                            white-space: pre;
                                        }

                                        button.a {
                                            background: none!important;
                                            border: none;
                                            padding: 0!important;
                                            font-family: inherit;
                                            color: var(--vscode-textLink-foreground);
                                            cursor: pointer;
                                        }

                                        button.a:hover {
                                            text-decoration: underline;
                                        }
                                    </style>
                                </head>
                                <body>
                                    <script>
                                        window.vscode = acquireVsCodeApi();
                                        window.goto = (l, c) => window.vscode.postMessage({ command: "goto", text: l+" "+c });
                                    </script>
                                    <div id="output">${assemble(
                                        editor.document,
                                        format
                                    )}</div>
                                </body>
                            </html>`;
                    });
            }
        );

        context.subscriptions.push(disposable);
    });
}

export function deactivate() {}
