import {FunctionInfo} from "../State/FunctionInfo";
import * as vscode from 'vscode';
import {ProviderResult, ThemeIcon, TreeItem, TreeItemCollapsibleState} from 'vscode';

export class CallbacksProvider implements vscode.TreeDataProvider<CallbackItem> {
    private callbacks: CallbackItem[] = [];

    private _onDidChangeTreeData: vscode.EventEmitter<CallbackItem | undefined | null | void> = new vscode.EventEmitter<CallbackItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CallbackItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getChildren(element?: CallbackItem): ProviderResult<CallbackItem[]> {
        if (element === undefined) {
            return this.callbacks;
        }
        return undefined;
    }

    getTreeItem(element: CallbackItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    setCallbacks(callbacks: FunctionInfo[]) {
        this.callbacks = callbacks.map((primitive: FunctionInfo) => (new CallbackItem(primitive))) ?? [];
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

export class CallbackItem extends vscode.TreeItem {
    private selected: boolean = false;
    public index;

    constructor(primitive: FunctionInfo) {
        super(primitive.name);
        this.iconPath = new ThemeIcon("circle-large-outline");
        this.command = {title: "Toggle callback", command: "warduinodebug.toggleCallback", arguments: [this]};
        this.index = primitive.index;
    }

    isSelected(): boolean {
        return this.selected;
    }

    toggle() {
        this.selected = !this.selected;
        this.iconPath = new ThemeIcon(this.selected ? "pass-filled" : "circle-large-outline");
    }
}
