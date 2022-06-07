import {FunctionInfo} from "../State/FunctionInfo";
import * as vscode from 'vscode';
import {ProviderResult, ThemeIcon, TreeItem} from 'vscode';
import {DebugBridge} from "../DebugBridges/DebugBridge";

export class ProxyCallsProvider implements vscode.TreeDataProvider<ProxyCallItem> {
    private debugBridge: DebugBridge;

    private _onDidChangeTreeData: vscode.EventEmitter<ProxyCallItem | undefined | null | void> = new vscode.EventEmitter<ProxyCallItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProxyCallItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
    }

    getChildren(element?: ProxyCallItem): ProviderResult<ProxyCallItem[]> {
        if (element === undefined) {
            return Array.from(this.debugBridge.getSelectedProxies());
        }
        return undefined;
    }

    getTreeItem(element: ProxyCallItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    setDebugBridge(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

export class ProxyCallItem extends vscode.TreeItem {
    private selected: boolean = true;
    public index;

    constructor(primitive: FunctionInfo) {
        super(primitive.name);
        this.iconPath = new ThemeIcon("pass-filled");
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
