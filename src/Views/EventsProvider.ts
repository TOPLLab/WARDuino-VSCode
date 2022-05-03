import * as vscode from 'vscode';
import {Event} from "../State/Event";
import {ProviderResult, TreeItem} from "vscode";

export class EventsProvider implements vscode.TreeDataProvider<Event> {
    getChildren(element?: Event): ProviderResult<Event[]> {
        return undefined;
    }

    getTreeItem(element: Event): TreeItem | Thenable<TreeItem> {
        return {};
    }
}
