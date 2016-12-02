"use strict";
import * as vscode from "vscode";
import * as XRegExp from "xregexp";

export function activate(context: vscode.ExtensionContext) {
    let markJump = new MarkJump();
    context.subscriptions.push(markJump);
    context.subscriptions.push(new MarkJumpController(markJump));
}

class MarkJumpController {
    private markJump: MarkJump;
    private disposable: vscode.Disposable;
    private lastLine: number = 0;

    constructor(markJump: MarkJump){
        this.markJump = markJump;

        let subscriptions: vscode.Disposable[] = [];
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToMark", () => {
                this.markJump.jumpToMark();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToSection", () => {
                this.markJump.jumpToMark("section");
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToTODO", () => {
                this.markJump.jumpToMark("todo");
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToNote", () => {
                this.markJump.jumpToMark("note");
            }
        ));

        this.markJump.createStatusBar();
        vscode.workspace.onDidChangeConfiguration(event => {
            this.markJump.updateStatusBar();
        }, this, subscriptions);
        vscode.window.onDidChangeActiveTextEditor(event => {
            this.markJump.updateStatusBar();
        }, this, subscriptions);
        vscode.window.onDidChangeTextEditorSelection(event => {
            if(event.selections.length > 1){
                return;
            }
            if(this.lastLine === event.selections[0].active.line){
                return;
            }
            this.lastLine = event.selections[0].active.line;
            this.markJump.updateStatusBar();
        }, this, subscriptions);

        this.disposable = vscode.Disposable.from(...subscriptions);
    }

    dispose(){
        this.disposable.dispose();
    }
}

interface MarkItem extends vscode.QuickPickItem {
    type: "section" | "todo" | "note";
    range: vscode.Range;
}

interface MarkFilter {
    test(lineNumber: number, lineText: string): boolean;
    getItem(lineNumber: number, lineText: string): MarkItem | undefined;
}

class MarkJump {
    statusItem: vscode.StatusBarItem;

    createStatusBar(){
        if(this.statusItem){
            return;
        }
        this.statusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left, 10
        );
        this.statusItem.command = "markJump.jumpToMark";
        this.statusItem.hide();
        this.updateStatusBar();
    }

    dispose(){
        this.statusItem.dispose();
    }

    updateStatusBar(){
        let editor = vscode.window.activeTextEditor;
        if(!editor){
            return;
        }

        let configurations = vscode.workspace.getConfiguration("markJump");
        if(!configurations.get<boolean>("showStatusItem")){
            this.statusItem.hide();
            return;
        }

        let marks = this.getMarks(editor);

        if(marks.length <= 0){
            this.statusItem.hide();
            return;
        }

        let markCount = {
            section: 0,
            todo: 0,
            note: 0
        };

        marks.forEach(mark => {
            markCount[mark.type] += 1;
        });

        this.statusItem.text = `${
            markCount.section > 0 ?
            `$(list-unordered) ${markCount.section} ` : ""
        }${
            markCount.todo > 0 ?
            `$(pencil) ${markCount.todo} ` : ""
        }${
            markCount.note > 0 ?
            `$(book) ${markCount.note}` : ""
        }`;

        let tooltips: string[] = [];
        if(markCount.section > 0){
            tooltips.push(
                `${markCount.section} Section${
                    markCount.section > 1 ? "s" : ""
                }`
            );
        }
        if(markCount.todo > 0){
            tooltips.push(
                `${markCount.todo} TODO${
                    markCount.todo > 1 ? "s" : ""
                }`
            );
        }
        if(markCount.note > 0){
            tooltips.push(
                `${markCount.note} Note${
                    markCount.note > 1 ? "s" : ""
                }`
            );
        }

        this.statusItem.tooltip = tooltips.join(", ");

        this.statusItem.show();
    }

    jumpToMark(...filters: string[]){
        let editor = vscode.window.activeTextEditor;
        if(!editor){
            return;
        }

        let configurations = vscode.workspace.getConfiguration("markJump");
        let marks = this.getMarks(editor, ...filters);

        if(marks.length <= 0){
            if(filters.length === 1 && filters.indexOf("todo") >= 0){
                vscode.window.showInformationMessage(
                    "No TODO left. Well done!"
                );
            }else{
                vscode.window.showInformationMessage("No mark is set.");
            }
            return;
        }

        let options: vscode.DecorationRenderOptions = {
            isWholeLine: true
        };

        let baseValue = configurations.get<string>(
            "highlightColor"
        );
        let darkValue = configurations.get<string>(
            "highlightColor.dark"
        );
        let lightValue = configurations.get<string>(
            "highlightColor.light"
        );
        if(!baseValue){
            baseValue = darkValue || lightValue;
        }

        options.backgroundColor = baseValue;
        options.overviewRulerColor = baseValue;
        if(darkValue){
            options.dark = {
                backgroundColor: darkValue,
                overviewRulerColor: darkValue
            };
        }
        if(lightValue){
            options.light = {
                backgroundColor: lightValue,
                overviewRulerColor: lightValue
            };
        }

        let highlightDecoration = vscode.window.createTextEditorDecorationType(
            options
        );

        let lastSelection = editor.selection;
        vscode.window.showQuickPick(marks, {
            matchOnDescription: true,
            matchOnDetail: true,
            onDidSelectItem: (mark: MarkItem) => {
                editor.setDecorations(highlightDecoration, [mark.range]);
                editor.revealRange(
                    mark.range, vscode.TextEditorRevealType.InCenter
                );
            }
        }).then(mark => {
            editor.setDecorations(highlightDecoration, []);
            highlightDecoration.dispose();
            if(!mark){
                editor.revealRange(
                    lastSelection, vscode.TextEditorRevealType.InCenter
                );
                return;
            }
            editor.revealRange(
                mark.range, vscode.TextEditorRevealType.InCenter
            );
            editor.selection = new vscode.Selection(
                mark.range.end, mark.range.end
            );
        });
    }

    getMarks(editor: vscode.TextEditor, ...filterKeys: string[]){
        let configurations = vscode.workspace.getConfiguration("markJump");
        let filters: MarkFilter[] = [];

        if(filterKeys.length <= 0 || filterKeys.indexOf("section") >= 0){
            let patterns = configurations.get<string[]>("sectionPatterns").concat(
                configurations.get<string[]>("additionalSectionPatterns")
            );
            filters.push(new SectionFilter(patterns));
        }
        if(filterKeys.length <= 0 || filterKeys.indexOf("todo") >= 0){
            let patterns = configurations.get<string[]>("todoPatterns").concat(
                configurations.get<string[]>("additionalTODOPatterns")
            );
            filters.push(new TODOFilter(patterns));
        }
        if(filterKeys.length <= 0 || filterKeys.indexOf("note") >= 0){
            let patterns = configurations.get<string[]>("notePatterns").concat(
                configurations.get<string[]>("additionalNotePatterns")
            );
            filters.push(new NoteFilter(patterns));
        }
        if(!filters || filters.length <= 0){
            console.log("[Mark Jump] No filter available");
            return [];
        }

        let items: MarkItem[] = [];
        let lineCount = editor.document.lineCount;
        for(let lineNumber = 0; lineNumber < lineCount; lineNumber += 1){
            let lineText = editor.document.lineAt(lineNumber).text;
            let filter = filters.find(
                filter => filter.test(lineNumber, lineText)
            );
            if(!filter){
                continue;
            }
            let item = filter.getItem(
                lineNumber, lineText
            );
            if(!item){
                continue;
            }
            items.push(item);
        }

        return items;
    }
}

class SectionFilter implements MarkFilter {
    patterns: string[];

    constructor(patterns: string[] = []){
        this.patterns = patterns;
    }

    test(lineNumber: number, lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp.test(lineText, XRegExp(pattern));
        });
    }

    getItem(lineNumber: number, lineText: string): MarkItem | undefined {
        let item: MarkItem | undefined = undefined;
        this.patterns.forEach(pattern => {
            let matches = XRegExp.exec(lineText, XRegExp(pattern));
            if(!matches){
                return;
            }
            item = {
                type: "section",
                range: new vscode.Range(
                    lineNumber, 0, lineNumber, lineText.length
                ),
                label: `$(list-unordered) ${matches["description"]}` || "",
                description: "",
                detail: (
                    `on line ${lineNumber}`
                )
            };
        });
        return item;
    }
}

class TODOFilter implements MarkFilter {
    patterns: string[];

    constructor(patterns: string[] = []){
        this.patterns = patterns;
    }

    test(lineNumber: number, lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp.test(lineText, XRegExp(pattern));
        });
    }

    getItem(lineNumber: number, lineText: string): MarkItem | undefined {
        let item: MarkItem | undefined = undefined;
        this.patterns.forEach(pattern => {
            let matches = XRegExp.exec(lineText, XRegExp(pattern));
            if(!matches){
                return;
            }
            item = {
                type: "todo",
                range: new vscode.Range(
                    lineNumber, 0, lineNumber, lineText.length
                ),
                label: `$(pencil) on line ${lineNumber}`,
                description: `TODO: ${matches["description"]}` || "",
                detail: (
                    matches["writer"] ? ` by ${matches["writer"]}` : undefined
                )
            };
        });
        return item;
    }
}

class NoteFilter implements MarkFilter {
    patterns: string[];

    constructor(patterns: string[] = []){
        this.patterns = patterns;
    }

    test(lineNumber: number, lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp.test(lineText, XRegExp(pattern));
        });
    }

    getItem(lineNumber: number, lineText: string): MarkItem | undefined {
        let item: MarkItem | undefined = undefined;
        this.patterns.forEach(pattern => {
            let matches = XRegExp.exec(lineText, XRegExp(pattern));
            if(!matches){
                return;
            }
            item = {
                type: "note",
                range: new vscode.Range(
                    lineNumber, 0, lineNumber, lineText.length
                ),
                label: `$(book) on line ${lineNumber}`,
                description: `NOTE: ${matches["description"]}` || "",
                detail: (
                    matches["writer"] ? ` by ${matches["writer"]}` : undefined
                )
            };
        });
        return item;
    }
}
