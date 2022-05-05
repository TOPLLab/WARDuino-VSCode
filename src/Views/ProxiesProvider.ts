import {FunctionInfo} from "../State/FunctionInfo";
import * as vscode from 'vscode';
import {ProviderResult, ThemeIcon, TreeItem, TreeItemCollapsibleState} from 'vscode';

export class ProxiesProvider implements vscode.TreeDataProvider<ProxyItem> {
    private callbacks: ProxyItem[] = [];

    private _onDidChangeTreeData: vscode.EventEmitter<ProxyItem | undefined | null | void> = new vscode.EventEmitter<ProxyItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProxyItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getChildren(element?: ProxyItem): ProviderResult<ProxyItem[]> {
        if (element === undefined) {
            return this.callbacks;
        }
        return undefined;
    }

    getTreeItem(element: ProxyItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    setCallbacks(callbacks: FunctionInfo[]) {
        this.callbacks = callbacks.map((primitive: FunctionInfo) => (new ProxyItem(primitive))) ?? [];
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

export class ProxyItem extends vscode.TreeItem {
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
