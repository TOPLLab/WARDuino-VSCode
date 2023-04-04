import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { RuntimeState } from '../State/RuntimeState';
import { DebugBridge } from '../DebugBridges/DebugBridge';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';

export class DebuggingTimelineProvider implements vscode.TreeDataProvider<TimelineItem>, RuntimeViewRefreshInterface {

    private _onDidChangeTreeData: vscode.EventEmitter<TimelineItem | undefined | null | void> = new vscode.EventEmitter<TimelineItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TimelineItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private debugBridge: DebugBridge;

    constructor(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
    }

    getChildren(element?: TimelineItem): ProviderResult<TimelineItem[]> {
        if (element === undefined) {
            const timeline = this.debugBridge.getDebuggingTimeline();
            const items: TimelineItem[] = timeline.getRuntimesChronologically().map((rs: RuntimeState, idx: number) => { return new TimelineItem(rs, idx) }).reverse();
            const activeIndex = timeline.getIndexOfActiveState();
            if (!!activeIndex) {
                items[activeIndex].select();
            }

            return items;
        } else if (element.collapsibleState !== TreeItemCollapsibleState.None) {
            // const children = this.stack;
            console.log("weird case")
            return undefined;
        }
        return undefined;
    }

    getTreeItem(element: TimelineItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    setDebugBridge(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
    }

    refreshView(runtimeState: RuntimeState) {
        this._onDidChangeTreeData.fire();
    }
}

export class TimelineItem extends vscode.TreeItem {
    private runtimeState: RuntimeState;
    private timelineIndex: number;
    private selected: boolean;

    constructor(runtimeState: RuntimeState, timelineIndex: number, treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        super(`Session ${runtimeState.getId()}`, treeItemCollapsibleState);
        this.runtimeState = runtimeState;
        this.timelineIndex = timelineIndex;
        this.selected = false;
    }

    public select() {
        this.selected = true;
    }
}