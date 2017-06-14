"use strict";
import * as vscode from "vscode";
import * as XRegExp from "xregexp";
import * as fs from "fs";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
    let markJump = new MarkJump();
    context.subscriptions.push(markJump);
    context.subscriptions.push(new MarkJumpController(markJump));
}

class MarkJumpController {
    private markJump: MarkJump;
    private disposable: vscode.Disposable;
    private lastLine: number = undefined;

    constructor(markJump: MarkJump){
        this.markJump = markJump;

        let subscriptions: vscode.Disposable[] = [];
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToProjectMark", () => {
                this.markJump.jumpToEditorMark();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToMark", () => {
                this.markJump.jumpToMark();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToSection", () => {
                this.markJump.jumpToMark(true, "section");
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToTODO", () => {
                this.markJump.jumpToMark(true, "todo");
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "markJump.jumpToNote", () => {
                this.markJump.jumpToMark(true, "note");
            }
        ));

        this.markJump.createStatusBar();
        vscode.workspace.onDidOpenTextDocument(document => {
            this.markJump.updateStatusBar(false);
        }, this, subscriptions);
        vscode.workspace.onDidCloseTextDocument(document => {
            this.lastLine = undefined;
            this.markJump.updateStatusBar();
        }, this, subscriptions);
        vscode.workspace.onDidChangeConfiguration(() => {
            this.markJump.updateStatusBar();
        }, this, subscriptions);
        vscode.window.onDidChangeTextEditorViewColumn(event => {
            this.lastLine = undefined;
            this.markJump.updateStatusBar();
        }, this, subscriptions);
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.lastLine = undefined;
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

interface MarkQuickPickItem extends vscode.QuickPickItem {
    range: vscode.Range;
    uri: vscode.Uri;
}

interface MarkItem {
    type: "section" | "todo" | "note";
    range: vscode.Range;
    uri: vscode.Uri;
    heading?: string;
    writer?: string;
    description: string;
    lineNumber: number;
}

interface MarkFilter {
    test(lineText: string): boolean;
    getItem(
        uri: vscode.Uri,
        lineNumber: number,
        lineText: string
    ): MarkItem | undefined;
}

class MarkJump {
    lastSelections: vscode.Selection[];
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

    updateStatusBar(withProjectWide: boolean = true){
        let configurations = vscode.workspace.getConfiguration("markJump");
        if(!configurations.get<boolean>("showStatusItem")){
            this.statusItem.hide();
            return;
        }

        let editor = vscode.window.activeTextEditor;
        let marks = this.getMarks(
            editor, withProjectWide
        ).then(marks => {
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

            this.statusItem.tooltip = `${
                editor ? "" : "In this project: "
            }${
                tooltips.join(", ")
            }`;

            this.statusItem.show();
        });
    }

    jumpToMark(withProjectWide: boolean = true, ...filters: string[]){
        this.jumpToEditorMark(
            vscode.window.activeTextEditor, withProjectWide, ...filters
        );
    }

    buildHeading(length: number, headingSymbol: string){
        if (length <= 0 || !headingSymbol) {
            return "";
        }
        let firstSymbol = headingSymbol.substr(0, 1);
        let secondSymbol = headingSymbol.substr(1) || firstSymbol;
        let padding = " ";
        if (firstSymbol === " ") {
            padding = "";
        }
        return `${firstSymbol}${ secondSymbol.repeat(length - 1) }${padding}`;
    }

    jumpToEditorMark(
        editor?: vscode.TextEditor,
        withProjectWide: boolean = true,
        ...filters: string[]
    ){
        let configurations = vscode.workspace.getConfiguration("markJump");
        this.getMarks(editor, withProjectWide, ...filters)
        .then(marks => {
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

            let darkValue = configurations.get<string>(
                "highlightColor.dark"
            );
            let lightValue = configurations.get<string>(
                "highlightColor.light"
            );

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

            let headingSymbol = configurations.get<string>("headingSymbol");

            if(editor){
                this.lastSelections = editor.selections;
            }
            let highlightDecoration = vscode.window.createTextEditorDecorationType(
                options
            );
            let lastEditor: vscode.TextEditor = undefined;
            vscode.window.showQuickPick(marks.map(mark => {
                let item: MarkQuickPickItem = {
                    range: mark.range,
                    uri: mark.uri,
                    label: undefined,
                    description: undefined
                };

                if(mark.type === "note"){
                    item.label = `${
                        this.buildHeading(
                            (mark.heading || "").length, headingSymbol
                        )
                    }$(book) ${
                        editor ? "" : `${path.basename(mark.uri.fsPath)} `
                    }on line ${mark.lineNumber + 1}`;
                    item.description = `NOTE: ${mark.description}` || "";
                    item.detail = (
                        mark.writer ? `by ${mark.writer}` : undefined
                    );
                }else if(mark.type === "todo"){
                    item.label = `${
                        this.buildHeading(
                            (mark.heading || "").length, headingSymbol
                        )
                    }$(pencil) ${
                        editor ? "" : `${path.basename(mark.uri.fsPath)} `
                    }on line ${mark.lineNumber + 1}`;
                    item.description = `TODO: ${mark.description}` || "";
                    item.detail = (
                        mark.writer ? `by ${mark.writer}` : undefined
                    );
                }else if(mark.type === "section"){
                    item.label = `${
                        this.buildHeading(
                            (mark.heading || "").length, headingSymbol
                        )
                    }$(list-unordered) ${mark.description}` || "";
                    item.detail = `${
                        editor ? "" : `${path.basename(mark.uri.fsPath)} `
                    }on line ${mark.lineNumber + 1}`;
                }

                return item;
            }), {
                ignoreFocusOut: false,
                matchOnDescription: true,
                matchOnDetail: true,
                onDidSelectItem: (mark: MarkQuickPickItem) => {
                    if(!editor){
                        if(!configurations.get<boolean>("alwaysOpenDocument")){
                            return;
                        }
                        vscode.workspace.openTextDocument(
                            mark.uri
                        ).then(document => {
                            return vscode.window.showTextDocument(
                                document, {
                                    preserveFocus: true,
                                    preview: true
                                }
                            );
                        }).then(editor => {
                            if(lastEditor){
                                lastEditor.setDecorations(
                                    highlightDecoration, []
                                );
                            }
                            editor.setDecorations(
                                highlightDecoration, [mark.range]
                            );
                            this.revealMark(editor, mark);
                            lastEditor = editor;
                        });
                        return;
                    }
                    editor.setDecorations(highlightDecoration, [mark.range]);
                    this.revealMark(editor, mark);
                }
            }).then(mark => {
                if(lastEditor){
                    lastEditor.setDecorations(
                        highlightDecoration, []
                    );
                }
                if(!editor){
                    if(!mark){
                        return;
                    }
                    vscode.workspace.openTextDocument(
                        mark.uri
                    ).then(document => {
                        return vscode.window.showTextDocument(document);
                    }).then(editor => {
                        this.revealMark(editor, mark);
                    });
                    return;
                }

                this.revealMark(editor, mark);
                editor.setDecorations(highlightDecoration, []);
                highlightDecoration.dispose();
            });
        });
    }

    revealMark(
        editor: vscode.TextEditor,
        mark?: MarkQuickPickItem
    ){
        if(!mark){
            editor.revealRange(
                this.lastSelections[0],
                vscode.TextEditorRevealType.InCenterIfOutsideViewport
            );
            editor.selections = this.lastSelections;
            return;
        }
        editor.revealRange(
            mark.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport
        );
        editor.selection = new vscode.Selection(
            mark.range.end, mark.range.end
        );
    }

    getMarks(
        editor?: vscode.TextEditor,
        withProjectWide: boolean = true,
        ...filterKeys: string[]
    ){
        return new Promise<MarkItem[]>((resolve, reject) => {
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

            if(editor){
                return this.getEditorMarks(editor, ...filters).then(marks => {
                    resolve(marks);
                });
            }else if(
                withProjectWide &&
                configurations.get<boolean>("showProjectMarks")
            ){
                return this.getWorkspaceMarks(...filters).then(marks => {
                    resolve(marks);
                });
            }

            resolve([]);
        });

    }

    getEditorMarks(editor: vscode.TextEditor, ...filters: MarkFilter[]){
        return new Promise<MarkItem[]>((resolve, reject) => {
            let items: MarkItem[] = [];
            let lineCount = editor.document.lineCount;
            for(let lineNumber = 0; lineNumber < lineCount; lineNumber += 1){
                let lineText = editor.document.lineAt(lineNumber).text;
                let filter = filters.find(
                    filter => filter.test(lineText)
                );
                if(!filter){
                    continue;
                }
                let item = filter.getItem(
                    editor.document.uri, lineNumber, lineText
                );
                if(!item){
                    continue;
                }
                items.push(item);
            }

            resolve(items);
        });
    }

    getContentMarks(uri: vscode.Uri, ...filters: MarkFilter[]){
        let items: MarkItem[] = [];
        let data = fs.readFileSync(uri.fsPath);
        let lines = data.toString().split("\n");

        lines.forEach((lineText, lineNumber) => {
            let filter = filters.find(
                filter => filter.test(lineText)
            );
            if(!filter){
                return;
            }
            let item = filter.getItem(
                uri, lineNumber, lineText
            );
            if(!item){
                return;
            }
            items.push(item);
        });

        return items;
    }

    getWorkspaceMarks(...filters: MarkFilter[]){
        return new Promise<MarkItem[]>((resolve, reject) => {
            let configurations = vscode.workspace.getConfiguration("markJump");

            vscode.workspace.findFiles(
                configurations.get<string>("includeFilePattern"),
                configurations.get<string>("excludeFilePattern")
            ).then(urls => {
                if (!urls) {
                    return resolve([]);
                }
                let items: MarkItem[] = [];
                urls.forEach(url => {
                    try{
                        items = items.concat(
                            this.getContentMarks(url, ...filters)
                        );
                    }catch(error){
                        return;
                    }
                });
                resolve(items);
            })
        });
    }
}

class SectionFilter implements MarkFilter {
    patterns: string[];

    constructor(patterns: string[] = []){
        this.patterns = patterns;
    }

    test(lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp.test(lineText, XRegExp(pattern));
        });
    }

    getItem(
        uri: vscode.Uri, lineNumber: number, lineText: string
    ): MarkItem | undefined {
        let item: MarkItem | undefined = undefined;
        this.patterns.forEach(pattern => {
            let matches = XRegExp.exec(lineText, XRegExp(pattern));
            if(!matches){
                return;
            }
            item = {
                uri: uri,
                type: "section",
                range: new vscode.Range(
                    lineNumber, 0, lineNumber, lineText.length
                ),
                heading: matches["heading"],
                description: matches["description"],
                lineNumber: lineNumber
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

    test(lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp.test(lineText, XRegExp(pattern));
        });
    }

    getItem(
        uri: vscode.Uri, lineNumber: number, lineText: string
    ): MarkItem | undefined {
        let item: MarkItem | undefined = undefined;
        this.patterns.forEach(pattern => {
            let matches = XRegExp.exec(lineText, XRegExp(pattern));
            if(!matches){
                return;
            }
            item = {
                uri: uri,
                type: "todo",
                range: new vscode.Range(
                    lineNumber, 0, lineNumber, lineText.length
                ),
                heading: matches["heading"],
                description: matches["description"],
                writer: matches["writer"],
                lineNumber: lineNumber
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

    test(lineText: string): boolean {
        return this.patterns.some(pattern => {
            return XRegExp.test(lineText, XRegExp(pattern));
        });
    }

    getItem(
        uri: vscode.Uri, lineNumber: number, lineText: string
    ): MarkItem | undefined {
        let item: MarkItem | undefined = undefined;
        this.patterns.forEach(pattern => {
            let matches = XRegExp.exec(lineText, XRegExp(pattern));
            if(!matches){
                return;
            }
            item = {
                uri: uri,
                type: "note",
                range: new vscode.Range(
                    lineNumber, 0, lineNumber, lineText.length
                ),
                heading: matches["heading"],
                description: matches["description"],
                writer: matches["writer"],
                lineNumber: lineNumber
            };
        });
        return item;
    }
}
