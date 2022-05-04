import * as vscode from 'vscode';
import {ProviderResult, TreeItem, TreeItemCollapsibleState} from 'vscode';

export class EventsProvider implements vscode.TreeDataProvider<EventItem> {
    getChildren(element?: EventItem): ProviderResult<EventItem[]> {
        if (element === undefined) {
            return [
                new EventItem("button1", "", TreeItemCollapsibleState.Collapsed),
                new EventItem("hello/world", "Hello World!", TreeItemCollapsibleState.Collapsed)];
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
}

class EventItem extends vscode.TreeItem {
    topic: string;
    payload: string;

    constructor(topic: string, payload: string, treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        let label = topic;
        if (treeItemCollapsibleState !== TreeItemCollapsibleState.None) {
            label = `Event for [${topic}]`;
        }
        super(label, treeItemCollapsibleState);
        this.topic = topic;
        this.payload = payload;
    }
}
