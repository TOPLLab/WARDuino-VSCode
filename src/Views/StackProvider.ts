import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { VariableInfo } from '../State/VariableInfo';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { RuntimeState } from '../State/RuntimeState';

export class StackProvider implements vscode.TreeDataProvider<StackItem>, RuntimeViewRefreshInterface {
    private stack: StackItem[] = [];

    private _onDidChangeTreeData: vscode.EventEmitter<StackItem | undefined | null | void> = new vscode.EventEmitter<StackItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StackItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getChildren(element?: StackItem): ProviderResult<StackItem[]> {
        if (element === undefined) {
            return this.stack;
        } else if (element.collapsibleState !== TreeItemCollapsibleState.None) {
            const children = this.stack;
            return children;
        }
        return undefined;
    }

    getTreeItem(element: StackItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    refreshView(runtimeState?: RuntimeState): void {
        if (!!runtimeState) {
            this.stack = runtimeState.getValuesStack().map(sv => new StackItem(sv)).reverse();
            this._onDidChangeTreeData.fire();
        }
    }
}

export class StackItem extends vscode.TreeItem {
    private value: VariableInfo;

    constructor(value: VariableInfo, treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        const label = `Value${value.index} (${value.type}): ${value.value}`;
        super(label, treeItemCollapsibleState);
        this.value = value;
    }
}