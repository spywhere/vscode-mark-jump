import * as vscode from "vscode";
import * as XRegExp from "xregexp";

export function activate(context: vscode.ExtensionContext) {
    console.log("[Mark Jump] Starting...");
    context.subscriptions.push(new MarkJumpController(new MarkJump()));
}

class MarkJumpController {
    private markJump: MarkJump;
    private disposable: vscode.Disposable;

    constructor(markJump: MarkJump){
        console.log("[Mark Jump] Activated");
        this.markJump = markJump;

        let subscriptions: vscode.Disposable[] = [];
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToSection", this.markJump.jumpToSection
        ));

        this.disposable = vscode.Disposable.from(...subscriptions);
    }

    dispose(){
        this.disposable.dispose();
    }
}

interface MarkItem extends vscode.QuickPickItem {
    range: vscode.Range;
}

interface Filter {
    test(lineNumber: number, lineText: string): boolean;
    getItem(lineNumber: number, lineText: string): MarkItem | undefined;
}

class MarkJump {
    jumpToSection(){
        let filterKeys: string[] = [];
        let editor = vscode.window.activeTextEditor;
        if(!editor){
            return;
        }
        let configurations = vscode.workspace.getConfiguration("markJump");
        let filters: Filter[] = [];

        if(filterKeys.length <= 0 || "mark" in filterKeys){
            let patterns = configurations.get<string[]>("markPatterns").concat(
                configurations.get<string[]>("additionalMarkPatterns")
            );
            filters.push(new MarkFilter(patterns));
        }
        if(filterKeys.length <= 0 || "todo" in filters){
            let patterns = configurations.get<string[]>("todoPatterns").concat(
                configurations.get<string[]>("additionalTODOPatterns")
            );
            filters.push(new TODOFilter(patterns));
        }
        if(filterKeys.length <= 0 || "note" in filters){
            let patterns = configurations.get<string[]>("notePatterns").concat(
                configurations.get<string[]>("additionalNotePatterns")
            );
            filters.push(new NoteFilter(patterns));
        }
        if(!filters || filters.length <= 0){
            console.log("[Mark Jump] No filter available");
            return;
        }

        let items: MarkItem[] = [];
        let lineCount = editor.document.lineCount;
        for(let lineNumber = 0; lineNumber < lineCount; lineNumber += 1){
            let lineText = editor.document.lineAt(lineNumber).text;
            let item = filters.find(
                filter => filter.test(lineNumber, lineText)
            ).getItem(
                lineNumber, lineText
            );
            if(item){
                items.push(item);
            }
        }
        if(items.length <= 0){
            console.log("[Mark Jump] No item available");
            return;
        }

        let lastSelection = editor.selection;
        vscode.window.showQuickPick(items, {
            onDidSelectItem: (item: MarkItem) => {
                editor.revealRange(
                    item.range, vscode.TextEditorRevealType.InCenter
                );
            }
        }).then(item => {
            if(!item){
                editor.revealRange(
                    lastSelection, vscode.TextEditorRevealType.InCenter
                );
                return;
            }
            editor.revealRange(
                item.range, vscode.TextEditorRevealType.InCenter
            );
        });
    }
}

class MarkFilter implements Filter {
    patterns: string[];

    constructor(patterns: string[] = []){
        this.patterns = patterns;
    }

    test(lineNumber: number, lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp(pattern).test(lineText);
        });
    }

    getItem(lineNumber: number, lineText: string): MarkItem | undefined {
        return undefined;
    }
}

class TODOFilter implements Filter {
    patterns: string[];

    constructor(patterns: string[] = []){
        this.patterns = patterns;
    }

    test(lineNumber: number, lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp(pattern).test(lineText);
        });
    }

    getItem(lineNumber: number, lineText: string): MarkItem | undefined {
        let item: MarkItem | undefined = undefined;
        this.patterns.forEach(pattern => {
            let matches = XRegExp(pattern).exec(lineText);
            item = {
                range: new vscode.Range(lineNumber, 0, lineNumber, 0),
                label: "TODO",
                description: matches["description"] || "Description",
                detail: matches["writer"] || "Detail"
            };
        });
        return item;
    }
}

class NoteFilter implements Filter {
    patterns: string[];

    constructor(patterns: string[] = []){
        this.patterns = patterns;
    }

    test(lineNumber: number, lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp(pattern).test(lineText);
        });
    }

    getItem(lineNumber: number, lineText: string): MarkItem | undefined {
        return undefined;
    }
}
