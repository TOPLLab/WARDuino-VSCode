import * as vscode from 'vscode';
import {ProviderResult, TreeItem, TreeItemCollapsibleState} from 'vscode';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { RuntimeState } from '../State/RuntimeState';

export class EventsProvider implements vscode.TreeDataProvider<EventItem>, RuntimeViewRefreshInterface {
    private events: EventItem[] = [];

    private _onDidChangeTreeData: vscode.EventEmitter<EventItem | undefined | null | void> = new vscode.EventEmitter<EventItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<EventItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getChildren(element?: EventItem): ProviderResult<EventItem[]> {
        if (element === undefined) {
            return this.events;
        } else if (element.collapsibleState !== TreeItemCollapsibleState.None) {
            let children = [new EventItem(`topic: ${element.topic}`, "")];
            if (element.payload.length > 0) {
                children.push(new EventItem(`payload: ${element.payload}`, ""));
            }
            return children;
        }
        return undefined;
    }

    getTreeItem(element: EventItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    refreshView(runtimeState: RuntimeState): void {
        this.events = runtimeState.getEvents();
        this._onDidChangeTreeData.fire();
    }
}

export class EventItem extends vscode.TreeItem {
    topic: string;
    payload: string;

    constructor(topic: string, payload: string, treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        const label = treeItemCollapsibleState !== TreeItemCollapsibleState.None ? `Event for [${topic}]` : topic;
        super(label, treeItemCollapsibleState);
        this.topic = topic;
        this.payload = payload;
    }
}
