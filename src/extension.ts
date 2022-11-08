import * as vscode from 'vscode';
import * as fs from 'fs';
import path = require('path');
import cp = require('child_process');

/**
 * @param {string} exe executable name (without extension if on Windows)
 * @return {Promise<string|null>} executable path if found
 * */
async function findExecutable(exe: string): Promise<string | null> {
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

    async function checkFileExists(filePath: string) {
        if (
            (
                await new Promise<fs.Stats>((resolve, reject) =>
                    fs.stat(filePath, (err, stats) =>
                        err ? reject(err) : resolve(stats)
                    )
                )
            ).isFile()
        ) {
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
                    bytes.push(
                        //@ts-expect-error
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
                let output = cp.execSync(
                    `customasm ${document.uri.fsPath} -f ${
                        {
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            Annotated: 'annotated',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Annotated Bin': 'annotatedbin',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Hex Dump': 'hexdump',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Bin Dump': 'bindump',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Hex String': 'hexstr',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Hex Line by Line': 'hexline',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Bin String': 'binstr',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Bin Line by Line': 'binline',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            COE: 'coe',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            MIF: 'mif',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'MIF BIN': 'mifbin',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Intel HEX': 'intelhex',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Comma-separated Dec': 'deccomma',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Comma-separated Hex': 'hexcomma',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'C Dec Array': 'decc',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'C Hex Array': 'hexc',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'VHDL Bin Array': 'binvhdl',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'VHDL Hex Array': 'hexvhdl',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'LogiSim 8-bit': 'logisim8',
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'LogiSim 16-bit': 'logisim16',
                        }[format]
                    } -p -q`,
                    {
                        encoding: 'utf-8',
                    }
                );
                output = output.replace(
                    / --> asm:\x1b\[0m\x1b\[90m(\d+):(\d+)/g,
                    (_, line, column) =>
                        ` --> asm:<button class="a" onclick="window.goto(${
                            line - 1
                        },${column - 1})">${line}:${column}</button>`
                );

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
