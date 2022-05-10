import {FunctionInfo} from "../State/FunctionInfo";
import * as vscode from 'vscode';
import {ProviderResult, ThemeIcon, TreeItem, TreeItemCollapsibleState} from 'vscode';

export class ProxyCallsProvider implements vscode.TreeDataProvider<ProxyCallItem> {
    private callbacks: ProxyCallItem[] = [];

    private _onDidChangeTreeData: vscode.EventEmitter<ProxyCallItem | undefined | null | void> = new vscode.EventEmitter<ProxyCallItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProxyCallItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getChildren(element?: ProxyCallItem): ProviderResult<ProxyCallItem[]> {
        if (element === undefined) {
            return this.callbacks;
        }
        return undefined;
    }

    getTreeItem(element: ProxyCallItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    setCallbacks(callbacks: FunctionInfo[]) {
        this.callbacks = callbacks.map((primitive: FunctionInfo) => (new ProxyCallItem(primitive))) ?? [];
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

export class ProxyCallItem extends vscode.TreeItem {
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
