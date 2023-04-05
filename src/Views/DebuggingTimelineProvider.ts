import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { RuntimeState } from '../State/RuntimeState';
import { DebugBridge } from '../DebugBridges/DebugBridge';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';

export class DebuggingTimelineProvider implements vscode.TreeDataProvider<TimelineItem>, RuntimeViewRefreshInterface {

    private _onDidChangeTreeData: vscode.EventEmitter<TimelineItem | undefined | null | void> = new vscode.EventEmitter<TimelineItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TimelineItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private debugBridge: DebugBridge;
    private items: TimelineItem[];

    constructor(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
        this.items = [];
    }

    getChildren(element?: TimelineItem): ProviderResult<TimelineItem[]> {
        if (element === undefined) {
            const timeline = this.debugBridge.getDebuggingTimeline();
            this.items = timeline.getRuntimesChronologically().map((rs: RuntimeState, idx: number) => { return new TimelineItem(rs, idx) }).reverse();
            const activeIndex = timeline.getIndexOfActiveState();
            if (!!activeIndex) {
                this.items[activeIndex].select();
            }

            return this.items;
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

    showItem(item: TimelineItem) {
        this.items.forEach(i => {
            if (item !== i) {
                i.deSelect();
            }
            else {
                item.select();
            }
        });
    }

    getSelected(): undefined | TimelineItem {
        return this.items.find(item => item.isSelected());
    }
}

export class TimelineItem extends vscode.TreeItem {
    private runtimeState: RuntimeState;
    private timelineIndex: number;
    private selected: boolean;

    constructor(runtimeState: RuntimeState, timelineIndex: number, treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        super(`Session#${timelineIndex} ${runtimeState.getId()}`, treeItemCollapsibleState);
        this.runtimeState = runtimeState;
        this.timelineIndex = timelineIndex;
        this.selected = false;
    }

    public select() {
        this.selected = true;
    }

    public deSelect() {
        this.selected = false;
    }

    public toggle() {
        this.selected = !this.selected;
    }

    public isSelected() {
        return this.selected;
    }

    public getTimelineIndex() {
        return this.timelineIndex;
    }
}